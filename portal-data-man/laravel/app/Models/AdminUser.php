<?php

namespace App\Models;

use App\Models\Concerns\HasPortalIdentity;
use Illuminate\Auth\Authenticatable;
use Illuminate\Contracts\Auth\Authenticatable as AuthenticatableContract;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

class AdminUser extends Model implements AuthenticatableContract
{
    use Authenticatable, HasPortalIdentity, SoftDeletes;

    protected $table = 'AdminUser';

    protected $guarded = ['id'];

    protected $hidden = ['id', 'passwordHash'];

    public const CREATED_AT = 'createdAt';

    public const UPDATED_AT = 'updatedAt';

    public const DELETED_AT = 'deletedAt';

    protected function casts(): array
    {
        return ['lockedUntil' => 'datetime', 'lastLoginAt' => 'datetime', 'passwordChangedAt' => 'datetime'];
    }

    public function getAuthPasswordName(): string
    {
        return 'passwordHash';
    }

    public function getRouteKeyName(): string
    {
        return 'publicId';
    }

    public function sessions(): HasMany
    {
        return $this->hasMany(AuthSession::class, 'adminUserId');
    }
}
