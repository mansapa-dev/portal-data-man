<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Semester extends PortalModel
{
    protected $table = 'Semester';

    protected $hidden = ['id', 'academicYearId'];

    protected function casts(): array
    {
        return ['startDate' => 'date', 'endDate' => 'date', 'isActive' => 'boolean'];
    }

    public function academicYear(): BelongsTo
    {
        return $this->belongsTo(AcademicYear::class, 'academicYearId');
    }

    public function enrollments(): HasMany
    {
        return $this->hasMany(ClassEnrollment::class, 'semesterId');
    }
}
