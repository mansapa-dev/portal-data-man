<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class Student extends PortalModel
{
    use SoftDeletes;

    protected $table = 'Student';

    public const DELETED_AT = 'deletedAt';

    public function enrollments(): HasMany
    {
        return $this->hasMany(ClassEnrollment::class, 'studentId');
    }
}
