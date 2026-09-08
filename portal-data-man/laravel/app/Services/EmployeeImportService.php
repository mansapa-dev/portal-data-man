<?php

namespace App\Services;

use App\Models\Employee;
use App\Models\ImportBatch;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use InvalidArgumentException;
use OpenSpout\Reader\XLSX\Reader;
use RuntimeException;
use Throwable;

class EmployeeImportService
{
    public function __construct(
        private readonly EmployeeImportNormalizer $normalizer,
        private readonly AuditService $audit,
        private readonly SpreadsheetExportService $exports,
    ) {}

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
                'type' => 'EMPLOYEE',
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

        Storage::disk('local')->putFileAs('imports', $file, $batch->storedFilename);
        $this->refreshErrorFile($batch);
        $this->audit->write($request, 'IMPORT_VALIDATED', 'ImportBatch', $batch->publicId, null, ['filename' => $batch->originalFilename, ...$summary]);

        return $batch->fresh();
    }

    public function commit(ImportBatch $batch, Request $request): ImportBatch
    {
        abort_unless($batch->status === 'READY', 409, 'Batch sudah atau belum dapat diproses.');
        $claimed = ImportBatch::query()->whereKey($batch->id)->where('status', 'READY')->update(['status' => 'PROCESSING', 'startedAt' => now()]);
        abort_unless($claimed === 1, 409, 'Batch sedang atau sudah diproses.');
        $counts = ['insertedRows' => 0, 'updatedRows' => 0, 'skippedRows' => 0, 'commitFailedRows' => 0];

        try {
            $batch->rows()->whereNotNull('normalizedData')->orderBy('rowNumber')->chunkById((int) config('imports.chunk_size'), function ($rows) use (&$counts): void {
                foreach ($rows as $row) {
                    try {
                        DB::transaction(function () use ($row, &$counts): void {
                            $data = $row->normalizedData;
                            $matches = $this->matches($data);
                            if ($matches->count() > 1) {
                                throw new InvalidArgumentException('Identifier pada baris ini dimiliki lebih dari satu pegawai.');
                            }

                            $values = collect($data)->only(['employmentType', 'fullName', 'nip', 'nuptk', 'position', 'rank', 'gender', 'education', 'grade', 'status'])->all();
                            $employee = $matches->first();
                            $changed = $employee && collect(array_keys($values))->contains(fn ($field) => $employee->{$field} !== $values[$field]);
                            if ($employee) {
                                $employee->fill($values);
                                $employee->deletedAt = null;
                                $employee->save();
                                $status = $changed ? 'UPDATED' : 'SKIPPED';
                            } else {
                                $employee = Employee::query()->create($values);
                                $status = 'INSERTED';
                            }

                            $counts[strtolower($status).'Rows']++;
                            $row->update(['status' => $status, 'identifier' => $data['nip'] ?? $data['nuptk'] ?? $data['fullName']]);
                        });
                    } catch (Throwable $error) {
                        $counts['commitFailedRows']++;
                        $row->update(['status' => 'FAILED', 'messages' => ['Gagal commit: '.$this->safeMessage($error)], 'normalizedData' => null]);
                    }
                }
            });

            $batch->update([
                'status' => $batch->warningRows || $batch->failedRows || $counts['commitFailedRows'] ? 'COMPLETED_WITH_WARNINGS' : 'COMPLETED',
                'insertedRows' => $counts['insertedRows'],
                'updatedRows' => $counts['updatedRows'],
                'skippedRows' => $counts['skippedRows'],
                'failedRows' => $batch->failedRows + $counts['commitFailedRows'],
                'completedAt' => now(),
            ]);
            $batch->refresh();
            $this->refreshErrorFile($batch);
        } catch (Throwable $error) {
            $batch->update(['status' => 'FAILED', 'completedAt' => now()]);
            throw $error;
        }

        $this->audit->write($request, 'IMPORT_COMMITTED', 'ImportBatch', $batch->publicId, null, ['filename' => $batch->originalFilename, ...$counts]);

        return $batch->fresh();
    }

    public function parseFile(string $path): array
    {
        $reader = new Reader;
        $rows = [];
        $headers = null;
        $seen = ['nip' => [], 'nuptk' => []];

        try {
            $reader->open($path);
            foreach ($reader->getSheetIterator() as $sheet) {
                foreach ($sheet->getRowIterator() as $number => $row) {
                    $values = array_map(fn ($cell) => $cell->getValue(), $row->getCells());
                    if ($headers === null) {
                        $headers = array_map(fn ($value) => trim((string) $value), $values);
                        if (array_slice($headers, 0, count(EmployeeImportNormalizer::HEADERS)) !== EmployeeImportNormalizer::HEADERS) {
                            throw new InvalidArgumentException('Header Excel tidak sesuai template pegawai.');
                        }

                        continue;
                    }
                    if (count(array_filter($values, fn ($value) => $value !== null && $value !== '')) === 0) {
                        continue;
                    }

                    $original = array_combine(EmployeeImportNormalizer::HEADERS, array_pad(array_slice($values, 0, count(EmployeeImportNormalizer::HEADERS)), count(EmployeeImportNormalizer::HEADERS), null));
                    try {
                        $normalized = $this->normalizer->normalize($original);
                        foreach (['nip', 'nuptk'] as $field) {
                            $value = $normalized[$field];
                            if (! $value) {
                                continue;
                            }
                            if (isset($seen[$field][$value])) {
                                if ($field === 'nip') {
                                    throw new InvalidArgumentException('NIP duplikat dengan baris '.$seen[$field][$value].'.');
                                }
                                $normalized[$field] = null;
                                $normalized['warnings'][] = strtoupper($field).' duplikat dengan baris '.$seen[$field][$value].' dan diabaikan.';
                            } else {
                                $seen[$field][$value] = $number;
                            }
                        }
                        $rows[] = ['rowNumber' => $number, 'identifier' => $normalized['nip'] ?? $normalized['nuptk'] ?? $normalized['fullName'], 'status' => $normalized['warnings'] ? 'WARNING' : 'VALID', 'messages' => $normalized['warnings'], 'originalData' => $original, 'normalizedData' => $normalized];
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
        $summary = [
            'totalRows' => count($rows),
            'validRows' => count(array_filter($rows, fn ($row) => $row['status'] === 'VALID')),
            'warningRows' => count(array_filter($rows, fn ($row) => $row['status'] === 'WARNING')),
            'failedRows' => count(array_filter($rows, fn ($row) => $row['status'] === 'FAILED')),
        ];

        return [$rows, $summary];
    }

    private function matches(array $data)
    {
        $query = Employee::withTrashed();
        if ($data['nip'] || $data['nuptk']) {
            return $query->where(function ($nested) use ($data): void {
                if ($data['nip']) {
                    $nested->orWhere('nip', $data['nip']);
                }
                if ($data['nuptk']) {
                    $nested->orWhere('nuptk', $data['nuptk']);
                }
            })->get();
        }

        return $query->where('employmentType', $data['employmentType'])->where('fullName', $data['fullName'])->get();
    }

    private function safeMessage(Throwable $error): string
    {
        if ($error instanceof InvalidArgumentException) {
            return $error->getMessage();
        }
        if ($error instanceof QueryException && (string) $error->getCode() === '23000') {
            return 'NIP atau NUPTK sudah digunakan pegawai lain.';
        }
        report($error);

        return 'Data pegawai tidak dapat disimpan.';
    }

    private function refreshErrorFile(ImportBatch $batch): void
    {
        if ($batch->failedRows < 1) {
            return;
        }
        $path = $this->exports->importErrors($batch);
        Storage::disk('local')->put('import-errors/'.$batch->publicId.'.xlsx', file_get_contents($path));
        @unlink($path);
        $batch->update(['errorFilePath' => 'import-errors/'.$batch->publicId.'.xlsx']);
    }
}
