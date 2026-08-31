<?php

namespace App\Models;

use App\Models\Concerns\HasPortalIdentity;
use Illuminate\Database\Eloquent\Model;

abstract class PortalModel extends Model
{
    use HasPortalIdentity;

    /** Preserve the camelCase relation names used by the existing API contract. */
    public static $snakeAttributes = false;

    public const CREATED_AT = 'createdAt';

    public const UPDATED_AT = 'updatedAt';

    protected $guarded = ['id'];

    protected $hidden = ['id'];
}
