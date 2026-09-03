<?php

namespace App\Http\Controllers;

use App\Models\AcademicYear;
use App\Models\ApplicationClient;
use App\Models\SchoolClass;
use App\Models\Semester;
use App\Models\TeacherAccount;
use App\Models\TeacherApplicationAccess;
use App\Services\OidcTokenService;
use App\Support\ApiResponse;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class IntegrationReferenceController extends Controller
{
    public function __construct(private readonly OidcTokenService $tokens) {}

    public function periods(Request $request): JsonResponse
    {
        $this->authorizeToken($request);
        $years = AcademicYear::query()->with(['semesters' => fn ($query) => $query->orderBy('startDate')])->orderByDesc('startDate')->get();

        return ApiResponse::success($years, 'Periode akademik Portal Data berhasil diambil.');
    }

    public function classes(Request $request): JsonResponse
    {
        $this->authorizeToken($request);
        $classes = SchoolClass::query()->with('academicYear')->where('status', 'ACTIVE')->whereHas('academicYear', fn ($query) => $query->where('isActive', true))->orderBy('gradeLevel')->orderBy('code')->get();

        return ApiResponse::success($classes, 'Kelas aktif Portal Data berhasil diambil.');
    }

    public function classStudents(Request $request, SchoolClass $schoolClass): JsonResponse
    {
        $this->authorizeToken($request);
        abort_unless($schoolClass->status === 'ACTIVE', 404, 'Kelas aktif tidak ditemukan.');
        $schoolClass->load('academicYear');
        $semesterId = $request->query('semesterPublicId');
        $semester = $semesterId
            ? Semester::query()->where('publicId', $semesterId)->firstOrFail()
            : Semester::query()->where('isActive', true)->firstOrFail();
        abort_unless($semester->academicYearId === $schoolClass->academicYearId, 422, 'Semester tidak sesuai dengan tahun ajaran kelas.');
        $enrollments = $schoolClass->enrollments()->with('student')
            ->where('semesterId', $semester->id)
            ->where('status', 'ACTIVE')
            ->whereHas('student', fn ($query) => $query->where('status', 'ACTIVE'))
            ->orderBy('attendanceNumber')
            ->get();

        // Keanggotaan kelas hasil impor lama tidak selalu dibuat ulang ketika
        // semester berganti. Jika semester yang dipilih belum memiliki roster,
        // gunakan roster aktif terakhir pada kelas dan tahun ajaran yang sama.
        if ($enrollments->isEmpty()) {
            $enrollments = $schoolClass->enrollments()->with('student')
                ->where('academicYearId', $schoolClass->academicYearId)
                ->where('status', 'ACTIVE')
                ->whereHas('student', fn ($query) => $query->where('status', 'ACTIVE'))
                ->orderByDesc('semesterId')
                ->orderBy('attendanceNumber')
                ->get()
                ->unique('studentId')
                ->sortBy(fn ($row) => [$row->attendanceNumber ?? PHP_INT_MAX, $row->student->fullName])
                ->values();
        }

        $rows = $enrollments->map(fn ($row) => [
            'publicId' => $row->student->publicId,
            'nisn' => $row->student->nisn,
            'fullName' => $row->student->fullName,
            'attendanceNumber' => $row->attendanceNumber,
            'status' => $row->student->status,
        ]);

        return ApiResponse::success(['class' => ['publicId' => $schoolClass->publicId, 'code' => $schoolClass->code, 'name' => $schoolClass->name], 'academicYear' => ['publicId' => $schoolClass->academicYear->publicId, 'name' => $schoolClass->academicYear->name], 'semester' => ['publicId' => $semester->publicId, 'type' => $semester->type], 'students' => $rows], 'Anggota kelas aktif berhasil diambil.');
    }

    private function authorizeToken(Request $request): array
    {
        $raw = $request->bearerToken();
        $claims = $raw ? $this->tokens->verify($raw) : null;
        $scopes = explode(' ', (string) ($claims['scope'] ?? ''));
        abort_unless($claims && ($claims['token_use'] ?? null) === 'access' && is_string($claims['aud'] ?? null) && in_array('portal_data.read', $scopes, true), 401, 'Access token tidak valid atau scope referensi tidak tersedia.');
        $client = ApplicationClient::query()->where('clientId', $claims['aud'])->where('status', 'ACTIVE')->first();
        $account = TeacherAccount::query()->where('publicId', $claims['sub'] ?? '')->where('status', 'ACTIVE')->first();
        $access = $client && $account ? TeacherApplicationAccess::query()->where('applicationClientId', $client->id)->where('teacherId', $account->teacherId)->where('status', 'ACTIVE')->exists() : false;
        abort_unless($client && $account && $access, 403, 'Aplikasi atau akses guru tidak aktif.');

        return $claims;
    }
}
