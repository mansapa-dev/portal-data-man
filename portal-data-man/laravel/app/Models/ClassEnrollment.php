<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ClassEnrollment extends PortalModel
{
    protected $table = 'ClassEnrollment';

    protected $hidden = ['id', 'studentId', 'schoolClassId', 'academicYearId', 'semesterId', 'activeEnrollmentKey'];

    protected function casts(): array
    {
        return ['enrolledAt' => 'datetime', 'leftAt' => 'datetime'];
    }

    public function student(): BelongsTo
    {
        return $this->belongsTo(Student::class, 'studentId')->withTrashed();
    }

    public function schoolClass(): BelongsTo
    {
        return $this->belongsTo(SchoolClass::class, 'schoolClassId');
    }

    public function academicYear(): BelongsTo
    {
        return $this->belongsTo(AcademicYear::class, 'academicYearId');
    }

    public function semester(): BelongsTo
    {
        return $this->belongsTo(Semester::class, 'semesterId');
    }
}
