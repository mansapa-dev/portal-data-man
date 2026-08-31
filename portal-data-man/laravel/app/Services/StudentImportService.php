<?php

namespace App\Services;

use App\Models\ClassEnrollment;
use App\Models\ImportBatch;
use App\Models\SchoolClass;
use App\Models\Semester;
use App\Models\Student;
use Illuminate\Http\Request;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use InvalidArgumentException;
use OpenSpout\Reader\XLSX\Reader;
use RuntimeException;
use Throwable;

class StudentImportService
{
    public function __construct(private readonly StudentImportNormalizer $normalizer, private readonly AuditService $audit, private readonly SpreadsheetExportService $exports) {}

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
                'type' => 'STUDENT',
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
        if ($batch->failedRows > 0) {
            $errorPath = $this->exports->importErrors($batch);
            Storage::disk('local')->put('import-errors/'.$batch->publicId.'.xlsx', file_get_contents($errorPath));
            @unlink($errorPath);
            $batch->update(['errorFilePath' => 'import-errors/'.$batch->publicId.'.xlsx']);
        }
        $this->audit->write($request, 'IMPORT_VALIDATED', 'ImportBatch', $batch->publicId, null, ['filename' => $batch->originalFilename, ...$summary]);

        return $batch->fresh();
    }

    public function commit(ImportBatch $batch, Request $request): ImportBatch
    {
        abort_unless($batch->status === 'READY', 409, 'Batch sudah atau belum dapat diproses.');
        $semester = Semester::query()->where('isActive', true)->first();
        abort_unless($semester, 409, 'Semester aktif belum tersedia.');
        $claimed = ImportBatch::query()->whereKey($batch->id)->where('status', 'READY')->update(['status' => 'PROCESSING', 'startedAt' => now()]);
        abort_unless($claimed === 1, 409, 'Batch sedang atau sudah diproses.');
        $counts = ['insertedRows' => 0, 'updatedRows' => 0, 'skippedRows' => 0];
        try {
            $batch->rows()->whereNotNull('normalizedData')->orderBy('rowNumber')->chunkById((int) config('imports.chunk_size'), function ($rows) use ($semester, &$counts): void {
                DB::transaction(function () use ($rows, $semester, &$counts): void {
                    foreach ($rows as $row) {
                        $data = $row->normalizedData;
                        $existing = Student::withTrashed()->where('nisn', $data['nisn'])->first();
                        $studentChanged = $existing && collect(['fullName', 'parentPhone', 'address', 'rfidUid', 'status'])->contains(fn ($field) => $existing->{$field} !== $data[$field]);
                        $student = Student::withTrashed()->updateOrCreate(['nisn' => $data['nisn']], collect($data)->only(['fullName', 'parentPhone', 'address', 'rfidUid', 'status'])->merge(['deletedAt' => null])->all());
                        $class = SchoolClass::withTrashed()->updateOrCreate(['academicYearId' => $semester->academicYearId, 'code' => $data['classCode']], ['name' => $data['classCode'], 'gradeLevel' => $data['gradeLevel'], 'status' => 'ACTIVE', 'deletedAt' => null]);
                        $active = ClassEnrollment::query()->where('studentId', $student->id)->where('semesterId', $semester->id)->where('status', 'ACTIVE')->first();
                        if ($active && $active->schoolClassId !== $class->id) {
                            $active->update(['status' => 'MOVED', 'leftAt' => now(), 'activeEnrollmentKey' => null]);
                        }
                        if (! $active || $active->schoolClassId !== $class->id) {
                            ClassEnrollment::query()->create(['studentId' => $student->id, 'schoolClassId' => $class->id, 'academicYearId' => $semester->academicYearId, 'semesterId' => $semester->id, 'activeEnrollmentKey' => "{$student->id}:{$semester->id}", 'status' => 'ACTIVE']);
                        }
                        $status = ! $existing ? 'INSERTED' : (! $studentChanged && $active?->schoolClassId === $class->id ? 'SKIPPED' : 'UPDATED');
                        $counts[strtolower($status).'Rows']++;
                        $row->update(['status' => $status]);
                    }
                });
            });
            $batch->update([
                'status' => $batch->warningRows || $batch->failedRows ? 'COMPLETED_WITH_WARNINGS' : 'COMPLETED',
                ...$counts,
                'completedAt' => now(),
            ]);
        } catch (Throwable $error) {
            $batch->update(['status' => 'FAILED', 'completedAt' => now()]);
            throw $error;
        }
        $this->audit->write($request, 'IMPORT_COMMITTED', 'ImportBatch', $batch->publicId, null, ['filename' => $batch->originalFilename, ...$counts, 'warningRows' => $batch->warningRows, 'failedRows' => $batch->failedRows]);

        return $batch->fresh();
    }

    public function parseFile(string $path): array
    {
        $reader = new Reader;
        $rows = [];
        $headers = null;
        try {
            $reader->open($path);
            foreach ($reader->getSheetIterator() as $sheet) {
                foreach ($sheet->getRowIterator() as $number => $row) {
                    $values = array_map(fn ($cell) => $cell->getValue(), $row->getCells());
                    if ($headers === null) {
                        $headers = array_map(fn ($value) => trim((string) $value), $values);
                        if (array_slice($headers, 0, count(StudentImportNormalizer::HEADERS)) !== StudentImportNormalizer::HEADERS) {
                            throw new InvalidArgumentException('Header Excel tidak sesuai template.');
                        }

                        continue;
                    }
                    if (count(array_filter($values, fn ($value) => $value !== null && $value !== '')) === 0) {
                        continue;
                    }
                    $original = array_combine(StudentImportNormalizer::HEADERS, array_pad(array_slice($values, 0, count(StudentImportNormalizer::HEADERS)), count(StudentImportNormalizer::HEADERS), null));
                    try {
                        $normalized = $this->normalizer->normalize($original);
                        $rows[] = ['rowNumber' => $number, 'identifier' => $normalized['nisn'], 'status' => $normalized['warnings'] ? 'WARNING' : 'VALID', 'messages' => $normalized['warnings'], 'originalData' => $original, 'normalizedData' => $normalized];
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
}
