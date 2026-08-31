<?php

namespace App\Http\Controllers;

use App\Models\SchoolClass;
use App\Services\AuditService;
use App\Services\SpreadsheetExportService;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

class SpreadsheetController extends Controller
{
    public function __construct(private readonly SpreadsheetExportService $exports, private readonly AuditService $audit) {}

    public function students(Request $request): BinaryFileResponse
    {
        [$path, $count] = $this->exports->students($request);
        $this->audit->write($request, 'STUDENTS_EXPORTED', 'Student', null, null, ['totalRows' => $count]);

        return $this->download($path, 'export-siswa-'.now()->format('Y-m-d-His').'.xlsx');
    }

    public function classStudents(Request $request, SchoolClass $schoolClass): BinaryFileResponse
    {
        [$path, $count] = $this->exports->classStudents($schoolClass, $request);
        $this->audit->write($request, 'CLASS_STUDENTS_EXPORTED', 'SchoolClass', $schoolClass->publicId, null, ['totalRows' => $count, 'classCode' => $schoolClass->code]);

        return $this->download($path, 'anggota-kelas-'.preg_replace('/[^A-Za-z0-9._-]/', '_', $schoolClass->code).'-'.now()->format('Y-m-d-His').'.xlsx');
    }

    public function studentTemplate(Request $request): BinaryFileResponse
    {
        $path = $this->exports->studentTemplate();
        $this->audit->write($request, 'TEMPLATE_DOWNLOADED', 'ImportTemplate', null, null, ['type' => 'STUDENT']);

        return $this->download($path, 'template-import-siswa.xlsx');
    }

    public function teacherTemplate(Request $request): BinaryFileResponse
    {
        $path = $this->exports->teacherTemplate();
        $this->audit->write($request, 'TEMPLATE_DOWNLOADED', 'ImportTemplate', null, null, ['type' => 'TEACHER']);

        return $this->download($path, 'template-import-guru.xlsx');
    }

    public function teachers(Request $request): BinaryFileResponse
    {
        [$path, $count] = $this->exports->teachers($request);
        $this->audit->write($request, 'TEACHERS_EXPORTED', 'Teacher', null, null, ['totalRows' => $count]);

        return $this->download($path, 'export-guru-'.now()->format('Y-m-d-His').'.xlsx');
    }

    private function download(string $path, string $filename): BinaryFileResponse
    {
        return response()->download($path, $filename, ['Content-Type' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Cache-Control' => 'private, no-store'])->deleteFileAfterSend();
    }
}
