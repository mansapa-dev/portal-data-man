<?php

namespace App\Services;

use App\Models\AcademicYear;
use App\Models\AuditLog;
use App\Models\ClassEnrollment;
use App\Models\Semester;
use Illuminate\Support\Facades\DB;

class SemesterRosterSyncService
{
    /**
     * Copies active class memberships from one semester to the other semester
     * in the same academic year. Existing memberships are never overwritten.
     */
    public function synchronize(AcademicYear $year, Semester $source, Semester $target, bool $apply = false): array
    {
        abort_unless($source->academicYearId === $year->id && $target->academicYearId === $year->id, 422, 'Semester harus berada pada tahun ajaran yang dipilih.');
        abort_unless($source->id !== $target->id, 422, 'Semester sumber dan tujuan harus berbeda.');

        $summary = ['sourceSemester' => $source->type, 'targetSemester' => $target->type, 'candidates' => 0, 'created' => 0, 'alreadyPresent' => 0, 'conflicts' => 0, 'attendanceNumberConflicts' => 0, 'details' => []];
        $sourceRows = ClassEnrollment::query()
            ->with(['student', 'schoolClass'])
            ->where('academicYearId', $year->id)
            ->where('semesterId', $source->id)
            ->where('status', 'ACTIVE')
            ->whereHas('student', fn ($query) => $query->where('status', 'ACTIVE'))
            ->whereHas('schoolClass', fn ($query) => $query->where('status', 'ACTIVE'))
            ->orderBy('schoolClassId')
            ->orderBy('attendanceNumber')
            ->get();

        foreach ($sourceRows as $sourceRow) {
            $summary['candidates']++;
            $targetRow = ClassEnrollment::query()
                ->where('studentId', $sourceRow->studentId)
                ->where('semesterId', $target->id)
                ->where('status', 'ACTIVE')
                ->first();

            if ($targetRow) {
                if ($targetRow->schoolClassId === $sourceRow->schoolClassId) {
                    $summary['alreadyPresent']++;
                } else {
                    $summary['conflicts']++;
                    $summary['details'][] = ['student' => $sourceRow->student->fullName, 'class' => $sourceRow->schoolClass->code, 'reason' => 'Siswa sudah aktif di kelas lain pada semester tujuan.'];
                }

                continue;
            }

            $attendanceNumber = $sourceRow->attendanceNumber;
            if ($attendanceNumber !== null && ClassEnrollment::query()->where('schoolClassId', $sourceRow->schoolClassId)->where('semesterId', $target->id)->where('attendanceNumber', $attendanceNumber)->exists()) {
                $attendanceNumber = null;
                $summary['attendanceNumberConflicts']++;
            }

            if ($apply) {
                DB::transaction(function () use ($sourceRow, $target, $attendanceNumber): void {
                    ClassEnrollment::query()->create([
                        'studentId' => $sourceRow->studentId,
                        'schoolClassId' => $sourceRow->schoolClassId,
                        'academicYearId' => $sourceRow->academicYearId,
                        'semesterId' => $target->id,
                        'attendanceNumber' => $attendanceNumber,
                        'activeEnrollmentKey' => "{$sourceRow->studentId}:{$target->id}",
                        'status' => 'ACTIVE',
                    ]);
                });
            }
            $summary['created']++;
        }

        if ($apply) {
            AuditLog::query()->create([
                'actorType' => 'SYSTEM',
                'action' => 'SYNC_SEMESTER_ROSTER',
                'entityType' => 'AcademicYear',
                'entityPublicId' => $year->publicId,
                'newValues' => collect($summary)->except('details')->all(),
                'requestMethod' => 'COMMAND',
                'requestPath' => 'portal:sync-semester-roster',
            ]);
        }

        return $summary;
    }
}
