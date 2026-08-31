<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Database\Eloquent\SoftDeletes;

class Teacher extends PortalModel
{
    use SoftDeletes;

    protected $table = 'Teacher';

    public const DELETED_AT = 'deletedAt';

    public function account(): HasOne
    {
        return $this->hasOne(TeacherAccount::class, 'teacherId');
    }

    public function homeroomClasses(): HasMany
    {
        return $this->hasMany(SchoolClass::class, 'homeroomTeacherId');
    }

    public function applicationAccess(): HasMany
    {
        return $this->hasMany(TeacherApplicationAccess::class, 'teacherId');
    }
}
