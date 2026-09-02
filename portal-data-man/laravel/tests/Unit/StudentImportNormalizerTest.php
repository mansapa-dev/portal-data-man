<?php

namespace Tests\Unit;

use App\Services\StudentImportNormalizer;
use InvalidArgumentException;
use PHPUnit\Framework\TestCase;

class StudentImportNormalizerTest extends TestCase
{
    public function test_it_accepts_grade_ten_class_format_from_student_workbook(): void
    {
        $result = (new StudentImportNormalizer)->normalize([
            'NISN' => '0118111502',
            'Nama Siswa' => 'ADZKIYA RAMADHANI',
            'Kelas' => '10 - X.10',
            'Status' => 'Aktif',
        ]);

        $this->assertSame('X.10', $result['classCode']);
        $this->assertSame(10, $result['gradeLevel']);
    }

    public function test_numeric_and_roman_grade_must_match(): void
    {
        $this->expectException(InvalidArgumentException::class);
        $this->expectExceptionMessage('Format kelas tidak valid.');

        (new StudentImportNormalizer)->normalize([
            'NISN' => '0118111502',
            'Nama Siswa' => 'Siswa Uji',
            'Kelas' => '10 - XII.1',
        ]);
    }
}
