<?php

namespace Tests\Feature;

use App\Services\EmployeeImportNormalizer;
use App\Services\EmployeeImportService;
use App\Services\SpreadsheetExportService;
use InvalidArgumentException;
use Tests\TestCase;

class EmployeeImportTest extends TestCase
{
    public function test_employee_template_can_be_read_by_importer(): void
    {
        $path = app(SpreadsheetExportService::class)->employeeTemplate();

        try {
            [$rows, $summary] = app(EmployeeImportService::class)->parseFile($path);

            $this->assertSame(2, $summary['totalRows']);
            $this->assertSame(0, $summary['failedRows']);
            $this->assertSame('PPPK', $rows[0]['normalizedData']['employmentType']);
            $this->assertSame('HONORER', $rows[1]['normalizedData']['employmentType']);
            $this->assertNull($rows[1]['normalizedData']['nuptk']);
            $this->assertNull($rows[1]['normalizedData']['rank']);
        } finally {
            @unlink($path);
        }
    }

    public function test_honorary_employee_accepts_blank_nuptk_and_rank(): void
    {
        $data = app(EmployeeImportNormalizer::class)->normalize([
            'Jenis Pegawai' => 'Honor',
            'Nama' => '  Siti   Aminah ',
            'NIP' => 'HON-002',
            'NUPTK' => '',
            'Jabatan' => 'Tenaga Administrasi',
            'Golongan' => '',
            'Jenis Kelamin' => 'P',
            'Pendidikan' => 'SMA',
            'Grade' => '4',
        ]);

        $this->assertSame('HONORER', $data['employmentType']);
        $this->assertSame('Siti Aminah', $data['fullName']);
        $this->assertNull($data['nuptk']);
        $this->assertNull($data['rank']);
        $this->assertSame('FEMALE', $data['gender']);
    }

    public function test_employee_type_must_be_pppk_or_honorary(): void
    {
        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('Jenis pegawai wajib PPPK atau HONORER.');

        app(EmployeeImportNormalizer::class)->normalize([
            'Jenis Pegawai' => 'PNS',
            'Nama' => 'Pegawai Uji',
            'Jabatan' => 'Staf',
        ]);
    }
}
