<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class SchoolClass extends PortalModel
{
    use SoftDeletes;

    protected $table = 'SchoolClass';

    protected $hidden = ['id', 'academicYearId', 'homeroomTeacherId'];

    public const DELETED_AT = 'deletedAt';

    public function academicYear(): BelongsTo
    {
        return $this->belongsTo(AcademicYear::class, 'academicYearId');
    }

    public function homeroomTeacher(): BelongsTo
    {
        return $this->belongsTo(Teacher::class, 'homeroomTeacherId');
    }

    public function enrollments(): HasMany
    {
        return $this->hasMany(ClassEnrollment::class, 'schoolClassId');
    }
}
