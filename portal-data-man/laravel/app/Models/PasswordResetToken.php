<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class PasswordResetToken extends Model
{
    protected $table = 'PasswordResetToken';

    protected $guarded = ['id'];

    protected $hidden = ['id', 'tokenHash'];

    public const CREATED_AT = 'createdAt';

    public const UPDATED_AT = null;

    protected function casts(): array
    {
        return ['expiresAt' => 'datetime', 'consumedAt' => 'datetime'];
    }
}
