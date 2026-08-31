<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\HasMany;

class AcademicYear extends PortalModel
{
    protected $table = 'AcademicYear';

    protected function casts(): array
    {
        return ['startDate' => 'date', 'endDate' => 'date', 'isActive' => 'boolean'];
    }

    public function semesters(): HasMany
    {
        return $this->hasMany(Semester::class, 'academicYearId');
    }

    public function classes(): HasMany
    {
        return $this->hasMany(SchoolClass::class, 'academicYearId');
    }
}
