<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Database\Eloquent\SoftDeletes;

class Employee extends PortalModel
{
    use SoftDeletes;

    protected $table = 'Employee';

    public const DELETED_AT = 'deletedAt';

    public function account(): HasOne
    {
        return $this->hasOne(TeacherAccount::class, 'employeeId');
    }

    public function applicationAccess(): HasMany
    {
        return $this->hasMany(TeacherApplicationAccess::class, 'employeeId');
    }
}
