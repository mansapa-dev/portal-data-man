<?php

namespace Tests\Feature;

use App\Services\SpreadsheetExportService;
use App\Services\TeacherImportService;
use App\Services\TeacherImportNormalizer;
use InvalidArgumentException;
use Tests\TestCase;

class TeacherImportTest extends TestCase
{
    public function test_teacher_template_can_be_read_by_importer(): void
    {
        $path = app(SpreadsheetExportService::class)->teacherTemplate();

        try {
            [$rows, $summary] = app(TeacherImportService::class)->parseFile($path);

            $this->assertSame(1, $summary['totalRows']);
            $this->assertSame(0, $summary['failedRows']);
            $this->assertSame('198001012010011001', $rows[0]['normalizedData']['nip']);
            $this->assertSame('Contoh Guru', $rows[0]['normalizedData']['fullName']);
            $this->assertSame('ACTIVE', $rows[0]['normalizedData']['status']);
        } finally {
            @unlink($path);
        }
    }

    public function test_teacher_import_uses_same_fields_as_teacher_crud(): void
    {
        $data = app(TeacherImportNormalizer::class)->normalize([
            'NIP' => ' 198001012010011001 ', 'NUPTK' => '', 'Nomor Pegawai' => 'PEG-001',
            'Nama Lengkap' => '  Budi   Santoso  ', 'Jenis Kelamin' => 'L',
            'Email' => ' BUDI@EXAMPLE.SCH.ID ', 'Telepon' => '0812-3456-7890',
            'Alamat' => 'Palembang', 'Status' => 'Aktif',
        ]);

        $this->assertSame(['nip', 'nuptk', 'employeeNumber', 'fullName', 'gender', 'email', 'phone', 'address', 'status', 'warnings'], array_keys($data));
        $this->assertSame('Budi Santoso', $data['fullName']);
        $this->assertSame('MALE', $data['gender']);
        $this->assertSame('budi@example.sch.id', $data['email']);
        $this->assertSame('081234567890', $data['phone']);
        $this->assertSame('ACTIVE', $data['status']);
    }

    public function test_teacher_import_requires_same_identifier_rule_as_crud(): void
    {
        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('Minimal satu identifier guru wajib diisi.');

        app(TeacherImportNormalizer::class)->normalize(['Nama Lengkap' => 'Guru Tanpa Identifier']);
    }

    public function test_unresolved_excel_formulas_in_optional_contacts_are_ignored(): void
    {
        $data = app(TeacherImportNormalizer::class)->normalize([
            'Nama Lengkap' => 'Guru Formula',
            'NIP' => '198001012010011002',
            'Email' => '=LOWER(A2)&"@example.sch.id"',
            'Telepon' => '="08"&RANDBETWEEN(1000000000,9999999999)',
        ]);

        $this->assertNull($data['email']);
        $this->assertNull($data['phone']);
        $this->assertCount(2, $data['warnings']);
    }
}
