<?php

namespace App\Services;

use App\Models\SchoolClass;
use App\Models\Student;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use OpenSpout\Common\Entity\Row;
use OpenSpout\Common\Entity\Style\Color;
use OpenSpout\Common\Entity\Style\Style;
use OpenSpout\Writer\XLSX\Writer;

class SpreadsheetExportService
{
    public const STUDENT_HEADERS = ['NISN', 'Nama Siswa', 'Kelas Aktif', 'Tahun Ajaran', 'Semester', 'Nomor Absen', 'No. Telepon Orang Tua', 'Alamat', 'RFID UID', 'Status'];

    public function students(Request $request): array
    {
        $filters = $request->validate(['search' => ['nullable', 'string'], 'status' => ['nullable', 'in:ACTIVE,INACTIVE,GRADUATED,TRANSFERRED,DROPPED_OUT'], 'classPublicId' => ['nullable', 'string', 'size:26'], 'academicYearPublicId' => ['nullable', 'string', 'size:26'], 'semesterPublicId' => ['nullable', 'string', 'size:26']]);
        $enrollment = fn ($query) => $query->where('status', 'ACTIVE')
            ->when($filters['classPublicId'] ?? null, fn ($query, $id) => $query->whereHas('schoolClass', fn ($class) => $class->where('publicId', $id)))
            ->when($filters['academicYearPublicId'] ?? null, fn ($query, $id) => $query->whereHas('academicYear', fn ($year) => $year->where('publicId', $id)))
            ->when($filters['semesterPublicId'] ?? null, fn ($query, $id) => $query->whereHas('semester', fn ($semester) => $semester->where('publicId', $id)));
        $hasPeriod = isset($filters['classPublicId']) || isset($filters['academicYearPublicId']) || isset($filters['semesterPublicId']);
        $query = Student::query()->with(['enrollments' => fn ($query) => $enrollment($query)->with(['schoolClass', 'academicYear', 'semester'])->latest('enrolledAt')->limit(1)])
            ->when($filters['status'] ?? null, fn ($query, $value) => $query->where('status', $value))
            ->when($filters['search'] ?? null, fn ($query, $value) => $query->where(fn ($nested) => $nested->where('fullName', 'like', "%{$value}%")->orWhere('nisn', 'like', "%{$value}%")))
            ->when($hasPeriod, fn ($query) => $query->whereHas('enrollments', $enrollment))
            ->orderBy('fullName');
        $rows = $query->limit(config('exports.max_rows') + 1)->get();
        abort_if($rows->count() > config('exports.max_rows'), 422, 'Jumlah data melebihi batas export. Persempit filter.');

        return [$this->write('Siswa', self::STUDENT_HEADERS, $rows->map(function (Student $student): array {
            $active = $student->enrollments->first();

            return [$student->nisn, $student->fullName, $active?->schoolClass?->code ?? '', $active?->academicYear?->name ?? '', $active?->semester?->type ?? '', $active?->attendanceNumber ?? '', $student->parentPhone ?? '', $student->address ?? '', $student->rfidUid ?? '', $student->status];
        })), $rows->count()];
    }

    public function classStudents(SchoolClass $schoolClass, Request $request): array
    {
        $filters = $request->validate(['semesterPublicId' => ['nullable', 'string', 'size:26'], 'academicYearPublicId' => ['nullable', 'string', 'size:26']]);
        $rows = $schoolClass->enrollments()->with('student')
            ->when($filters['semesterPublicId'] ?? null, fn ($query, $id) => $query->whereHas('semester', fn ($semester) => $semester->where('publicId', $id)))
            ->when($filters['academicYearPublicId'] ?? null, fn ($query, $id) => $query->whereHas('academicYear', fn ($year) => $year->where('publicId', $id)))
            ->orderBy('attendanceNumber')->limit(config('exports.max_rows') + 1)->get();
        abort_if($rows->count() > config('exports.max_rows'), 422, 'Jumlah data melebihi batas export.');
        $data = $rows->map(fn ($row) => [$row->attendanceNumber ?? '', $row->student->nisn, $row->student->fullName, $row->status, $row->enrolledAt, $row->leftAt ?? '']);

        return [$this->write('Anggota Kelas', ['Nomor Absen', 'NISN', 'Nama Siswa', 'Status Enrollment', 'Tanggal Masuk', 'Tanggal Keluar'], $data), $rows->count()];
    }

    public function studentTemplate(): string
    {
        return $this->write('Data Siswa', StudentImportNormalizer::HEADERS, collect([[1, '0012345678', 'Contoh Siswa', '12 - XII.1', '081234567890', 'Alamat contoh', 'A1B2C3D4', 'Aktif']]));
    }

    private function write(string $sheetName, array $headers, Collection $rows): string
    {
        $path = tempnam(sys_get_temp_dir(), 'portal-export-');
        $writer = new Writer;
        $writer->openToFile($path);
        $writer->getCurrentSheet()->setName($sheetName);
        $headerStyle = (new Style)->setFontBold()->setFontColor(Color::WHITE)->setBackgroundColor('166534');
        $writer->addRow(Row::fromValues($headers, $headerStyle));
        foreach ($rows as $values) {
            $writer->addRow(Row::fromValues(array_map(fn ($value) => $value instanceof \DateTimeInterface ? $value->format('Y-m-d H:i:s') : $value, $values)));
        }
        $writer->close();

        return $path;
    }
}
