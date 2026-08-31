<?php

namespace Tests\Feature;

use App\Services\SpreadsheetExportService;
use App\Services\StudentImportService;
use Tests\TestCase;

class StudentImportActualFileTest extends TestCase
{
    private array $rows;

    private array $summary;

    protected function setUp(): void
    {
        parent::setUp();
        $path = dirname(base_path()).'/storage/imports/data-siswa-2026-08-29-185845.xlsx';
        $this->assertFileExists($path);
        [$this->rows, $this->summary] = app(StudentImportService::class)->parseFile($path);
    }

    public function test_actual_workbook_has_expected_dataset_shape(): void
    {
        $normalized = $this->normalizedRows();
        $nisn = array_column($normalized, 'nisn');
        $classes = array_unique(array_column($normalized, 'classCode'));

        $this->assertSame(690, $this->summary['totalRows']);
        $this->assertSame(0, $this->summary['failedRows']);
        $this->assertCount(690, array_unique($nisn));
        $this->assertCount(690, array_filter($nisn, fn ($value) => preg_match('/^\d{10}$/', $value)));
        $this->assertNotEmpty(array_filter($nisn, fn ($value) => str_starts_with($value, '0')));
        $this->assertCount(20, $classes);
        $this->assertContains('XII.9', $classes);
        $this->assertContains('XII.10', $classes);
    }

    public function test_actual_workbook_preserves_duplicate_names_with_distinct_nisn(): void
    {
        $byName = [];
        foreach ($this->normalizedRows() as $row) {
            $byName[$row['fullName']][] = $row['nisn'];
        }
        $duplicates = array_filter($byName, fn ($nisn) => count(array_unique($nisn)) > 1);

        $this->assertNotEmpty($duplicates, 'Dataset aktual harus memuat nama sama dengan NISN berbeda.');
    }

    public function test_actual_workbook_normalizes_bad_optional_values_as_warnings(): void
    {
        $messages = array_merge(...array_column($this->rows, 'messages'));
        $this->assertContains('Nomor telepon kurang dari 10 digit dan diabaikan.', $messages);
        $this->assertContains('RFID UID bukan hexadecimal dan diabaikan.', $messages);
        $this->assertSame(28, $this->summary['warningRows']);

        $romanTypoRows = array_filter($this->rows, fn ($row) => str_contains((string) ($row['originalData']['Kelas'] ?? ''), 'XlI'));
        $this->assertNotEmpty($romanTypoRows);
        foreach ($romanTypoRows as $row) {
            $this->assertStringStartsWith('XII.', $row['normalizedData']['classCode']);
        }
    }

    public function test_generated_student_template_can_be_read_by_importer(): void
    {
        $path = app(SpreadsheetExportService::class)->studentTemplate();
        try {
            [$rows, $summary] = app(StudentImportService::class)->parseFile($path);
            $this->assertSame(1, $summary['totalRows']);
            $this->assertSame(0, $summary['failedRows']);
            $this->assertSame('0012345678', $rows[0]['normalizedData']['nisn']);
            $this->assertSame('XII.1', $rows[0]['normalizedData']['classCode']);
        } finally {
            @unlink($path);
        }
    }

    private function normalizedRows(): array
    {
        return array_values(array_filter(array_column($this->rows, 'normalizedData')));
    }
}
