<?php

namespace App\Services;

use App\Models\ImportBatch;
use App\Models\Teacher;
use App\Models\TeacherAccount;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Str;
use InvalidArgumentException;
use OpenSpout\Reader\XLSX\Reader;
use RuntimeException;
use Throwable;

class TeacherImportService
{
    public function __construct(private readonly TeacherImportNormalizer $normalizer, private readonly AuditService $audit, private readonly SpreadsheetExportService $exports) {}

    public function validate(UploadedFile $file, Request $request): ImportBatch
    {
        abort_unless(strtolower($file->getClientOriginalExtension()) === 'xlsx', 422, 'Ekstensi file harus .xlsx.');
        $signature = file_get_contents($file->getRealPath(), false, null, 0, 4);
        abort_unless(str_starts_with((string) $signature, 'PK'), 422, 'Signature file XLSX tidak valid.');

        try {
            [$rows, $summary] = $this->parseFile($file->getRealPath());
        } catch (InvalidArgumentException|RuntimeException $error) {
            abort(422, $error->getMessage());
        }

        $batch = DB::transaction(function () use ($file, $request, $rows, $summary): ImportBatch {
            $batch = ImportBatch::query()->create([
                'type' => 'TEACHER',
                'originalFilename' => basename($file->getClientOriginalName()),
                'storedFilename' => 'pending.xlsx',
                'fileHash' => hash_file('sha256', $file->getRealPath()),
                'status' => $summary['validRows'] + $summary['warningRows'] > 0 ? 'READY' : 'FAILED',
                ...$summary,
                'createdBy' => $request->user('admin')->publicId,
                'summary' => $summary,
            ]);

            $batch->update(['storedFilename' => $batch->publicId.'.xlsx']);
            foreach (array_chunk($rows, 250) as $chunk) {
                $batch->rows()->createMany($chunk);
            }

            return $batch;
        });

        \Illuminate\Support\Facades\Storage::disk('local')->putFileAs('imports', $file, $batch->storedFilename);
        if ($batch->failedRows > 0) {
            $errorPath = $this->exports->importErrors($batch);
            \Illuminate\Support\Facades\Storage::disk('local')->put('import-errors/'.$batch->publicId.'.xlsx', file_get_contents($errorPath));
            @unlink($errorPath);
            $batch->update(['errorFilePath' => 'import-errors/'.$batch->publicId.'.xlsx']);
        }

        $this->audit->write($request, 'IMPORT_VALIDATED', 'ImportBatch', $batch->publicId, null, ['filename' => $batch->originalFilename, ...$summary]);

        return $batch->fresh();
    }

    public function commit(ImportBatch $batch, Request $request): ImportBatch
    {
        abort_unless($batch->status === 'READY', 409, 'Batch sudah atau belum dapat diproses.');
        $claimed = ImportBatch::query()->whereKey($batch->id)->where('status', 'READY')->update(['status' => 'PROCESSING', 'startedAt' => now()]);
        abort_unless($claimed === 1, 409, 'Batch sedang atau sudah diproses.');
        $counts = ['insertedRows' => 0, 'updatedRows' => 0, 'skippedRows' => 0, 'commitFailedRows' => 0, 'accountsCreated' => 0];

        try {
            $batch->rows()->whereNotNull('normalizedData')->orderBy('rowNumber')->chunkById((int) config('imports.chunk_size'), function ($rows) use (&$counts): void {
                foreach ($rows as $row) {
                    try {
                        DB::transaction(function () use ($row, &$counts): void {
                            $data = $row->normalizedData;
                            $identifiers = collect(['nip' => $data['nip'], 'nuptk' => $data['nuptk'], 'employeeNumber' => $data['employeeNumber'], 'email' => $data['email']])->filter(fn ($value) => filled($value));
                            $matches = Teacher::withTrashed()->where(function ($query) use ($identifiers): void {
                                foreach ($identifiers as $field => $value) {
                                    $query->orWhere($field, $value);
                                }
                            })->get();
                            if ($matches->count() > 1) {
                                throw new InvalidArgumentException('Identifier pada baris ini dimiliki oleh lebih dari satu guru. Perbaiki data master terlebih dahulu.');
                            }

                            $existing = $matches->first();
                            $values = collect($data)->only(['fullName', 'nip', 'nuptk', 'employeeNumber', 'email', 'phone', 'address', 'gender', 'status'])->all();
                            $changed = $existing && collect(array_keys($values))->contains(fn ($field) => $existing->{$field} !== $values[$field]);
                            if ($existing) {
                                $existing->fill($values);
                                $existing->deletedAt = null;
                                $existing->save();
                                if ($existing->trashed()) {
                                    $existing->restore();
                                }
                                $status = $changed ? 'UPDATED' : 'SKIPPED';
                            } else {
                                $existing = Teacher::query()->create($values);
                                $status = 'INSERTED';
                            }
                            if ($existing->status === 'ACTIVE' && ! $existing->account()->exists()) {
                                $this->provisionAccount($existing);
                                $counts['accountsCreated']++;
                            }
                            $counts[strtolower($status).'Rows']++;
                            $row->update(['status' => $status, 'identifier' => $identifiers->first()]);
                        });
                    } catch (Throwable $error) {
                        $counts['commitFailedRows']++;
                        $row->update(['status' => 'FAILED', 'messages' => ['Gagal commit: '.$this->safeCommitMessage($error)], 'normalizedData' => null]);
                    }
                }
            });

            $batch->update([
                'status' => $batch->warningRows || $batch->failedRows || $counts['commitFailedRows'] ? 'COMPLETED_WITH_WARNINGS' : 'COMPLETED',
                'insertedRows' => $counts['insertedRows'], 'updatedRows' => $counts['updatedRows'], 'skippedRows' => $counts['skippedRows'],
                'failedRows' => $batch->failedRows + $counts['commitFailedRows'],
                'completedAt' => now(),
                'summary' => [...($batch->summary ?? []), 'accountsCreated' => $counts['accountsCreated']],
            ]);
            $batch->refresh();
            if ($batch->failedRows > 0) {
                $errorPath = $this->exports->importErrors($batch);
                \Illuminate\Support\Facades\Storage::disk('local')->put('import-errors/'.$batch->publicId.'.xlsx', file_get_contents($errorPath));
                @unlink($errorPath);
                $batch->update(['errorFilePath' => 'import-errors/'.$batch->publicId.'.xlsx']);
            }
        } catch (Throwable $error) {
            $batch->update(['status' => 'FAILED', 'completedAt' => now()]);
            throw $error;
        }

        $this->audit->write($request, 'IMPORT_COMMITTED', 'ImportBatch', $batch->publicId, null, ['filename' => $batch->originalFilename, ...$counts, 'warningRows' => $batch->warningRows, 'failedRows' => $batch->failedRows]);

        return $batch->fresh();
    }

    private function safeCommitMessage(Throwable $error): string
    {
        if ($error instanceof InvalidArgumentException) {
            return $error->getMessage();
        }
        if ($error instanceof \Illuminate\Database\QueryException && (string) $error->getCode() === '23000') {
            return 'NIP, NUPTK, nomor pegawai, atau email sudah digunakan guru lain.';
        }

        report($error);

        return 'Data guru tidak dapat disimpan.';
    }

    public function parseFile(string $path): array
    {
        $reader = new Reader;
        $rows = [];
        $headers = null;
        $seenIdentifiers = [];

        try {
            $reader->open($path);
            foreach ($reader->getSheetIterator() as $sheet) {
                foreach ($sheet->getRowIterator() as $number => $row) {
                    $values = array_map(fn ($cell) => $cell->getValue(), $row->getCells());
                    if ($headers === null) {
                        $headers = array_map(fn ($value) => trim((string) $value), $values);
                        if (array_slice($headers, 0, count(TeacherImportNormalizer::HEADERS)) !== TeacherImportNormalizer::HEADERS) {
                            throw new InvalidArgumentException('Header Excel tidak sesuai template.');
                        }

                        continue;
                    }

                    if (count(array_filter($values, fn ($value) => $value !== null && $value !== '')) === 0) {
                        continue;
                    }

                    $original = array_combine(TeacherImportNormalizer::HEADERS, array_pad(array_slice($values, 0, count(TeacherImportNormalizer::HEADERS)), count(TeacherImportNormalizer::HEADERS), null));
                    try {
                        $normalized = $this->normalizer->normalize($original);
                        foreach (['nip', 'nuptk', 'employeeNumber', 'email'] as $field) {
                            $value = $normalized[$field];
                            if (! filled($value)) {
                                continue;
                            }
                            if (isset($seenIdentifiers[$field][$value])) {
                                $normalized[$field] = null;
                                $normalized['warnings'][] = strtoupper($field).' duplikat dengan baris '.$seenIdentifiers[$field][$value].' dan diabaikan pada baris ini.';
                            } else {
                                $seenIdentifiers[$field][$value] = $number;
                            }
                        }
                        if (! collect(['nip', 'nuptk', 'employeeNumber', 'email'])->contains(fn ($field) => filled($normalized[$field]))) {
                            throw new InvalidArgumentException('Semua identifier merupakan duplikat baris sebelumnya.');
                        }
                        $rows[] = ['rowNumber' => $number, 'identifier' => collect([$normalized['nip'], $normalized['nuptk'], $normalized['employeeNumber'], $normalized['email']])->filter()->first() ?? null, 'status' => $normalized['warnings'] ? 'WARNING' : 'VALID', 'messages' => $normalized['warnings'], 'originalData' => $original, 'normalizedData' => $normalized];
                    } catch (InvalidArgumentException $error) {
                        $rows[] = ['rowNumber' => $number, 'identifier' => null, 'status' => 'FAILED', 'messages' => [$error->getMessage()], 'originalData' => $original, 'normalizedData' => null];
                    }

                    abort_if(count($rows) > (int) config('imports.max_rows'), 422, 'Jumlah baris melebihi batas import.');
                }
                break;
            }
        } catch (InvalidArgumentException $error) {
            throw $error;
        } catch (Throwable) {
            throw new RuntimeException('File tidak dapat dibaca sebagai workbook XLSX yang valid.');
        } finally {
            $reader->close();
        }

        abort_if($headers === null, 422, 'Worksheet tidak ditemukan.');
        $summary = ['totalRows' => count($rows), 'validRows' => count(array_filter($rows, fn ($row) => $row['status'] === 'VALID')), 'warningRows' => count(array_filter($rows, fn ($row) => $row['status'] === 'WARNING')), 'failedRows' => count(array_filter($rows, fn ($row) => $row['status'] === 'FAILED'))];

        return [$rows, $summary];
    }

    private function provisionAccount(Teacher $teacher): TeacherAccount
    {
        $username = collect([$teacher->nip, $teacher->nuptk, $teacher->employeeNumber])
            ->map(fn ($value) => strtolower(trim((string) $value)))
            ->first(fn ($value) => $value !== '' && ! TeacherAccount::query()->where('username', $value)->exists());
        if (! $username) {
            throw new InvalidArgumentException('Username akun tidak tersedia untuk guru ini.');
        }
        $password = 'Guru#'.Str::upper(Str::random(8)).random_int(10, 99);

        return $teacher->account()->create(['username' => $username, 'email' => $teacher->email, 'passwordHash' => Hash::make($password), 'initialPassword' => $password, 'status' => 'ACTIVE', 'mustChangePassword' => true, 'activatedAt' => now()]);
    }
}
