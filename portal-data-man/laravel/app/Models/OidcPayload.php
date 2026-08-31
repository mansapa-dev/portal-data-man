<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class OidcPayload extends Model
{
    protected $table = 'OidcPayload';

    protected $keyType = 'string';

    public $incrementing = false;

    protected $guarded = [];

    protected $hidden = ['payload'];

    public const CREATED_AT = 'createdAt';

    public const UPDATED_AT = null;

    protected function casts(): array
    {
        return ['payload' => 'array', 'expiresAt' => 'datetime', 'consumedAt' => 'datetime'];
    }
}
