<?php

namespace App\Models;

use Illuminate\Database\Eloquent\SoftDeletes;

class Employee extends PortalModel
{
    use SoftDeletes;

    protected $table = 'Employee';

    public const DELETED_AT = 'deletedAt';
}
