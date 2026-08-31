<?php

namespace App\Http\Controllers;

use App\Models\AcademicYear;
use App\Models\AuditLog;
use App\Models\ImportBatch;
use App\Models\SchoolClass;
use App\Models\Semester;
use App\Models\Student;
use App\Models\Teacher;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\DB;

class DashboardController extends Controller
{
    public function summary(): JsonResponse
    {
        $grades = SchoolClass::query()->where('status', 'ACTIVE')->select('gradeLevel', DB::raw('COUNT(*) as total'))->groupBy('gradeLevel')->orderBy('gradeLevel')->get();

        return ApiResponse::success([
            'students' => Student::query()->where('status', 'ACTIVE')->count(),
            'teachers' => Teacher::query()->where('status', 'ACTIVE')->count(),
            'classes' => SchoolClass::query()->where('status', 'ACTIVE')->count(),
            'activeAcademicYear' => AcademicYear::query()->where('isActive', true)->first(),
            'activeSemester' => Semester::query()->where('isActive', true)->first(),
            'classesByGrade' => $grades->map(fn ($row) => ['gradeLevel' => $row->gradeLevel, '_count' => (int) $row->total]),
        ], 'Ringkasan dashboard berhasil diambil.');
    }

    public function recentActivities(): JsonResponse
    {
        return ApiResponse::success(AuditLog::query()->latest('createdAt')->limit(10)->get(), 'Aktivitas terbaru berhasil diambil.');
    }

    public function dataQuality(): JsonResponse
    {
        return ApiResponse::success([
            'studentsWithoutEnrollment' => Student::query()->where('status', 'ACTIVE')->whereDoesntHave('enrollments', fn ($query) => $query->where('status', 'ACTIVE'))->count(),
            'studentsWithoutValidPhone' => Student::query()->where('status', 'ACTIVE')->whereNull('parentPhone')->count(),
            'studentsWithoutRfid' => Student::query()->where('status', 'ACTIVE')->whereNull('rfidUid')->count(),
            'lastImport' => ImportBatch::query()->latest('createdAt')->first(),
        ], 'Kualitas data berhasil diambil.');
    }
}
