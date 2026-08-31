<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;

class AuthSession extends PortalModel
{
    public const UPDATED_AT = null;

    protected $table = 'AuthSession';

    protected $hidden = ['id', 'adminUserId', 'teacherAccountId', 'secretHash', 'csrfHash'];

    protected function casts(): array
    {
        return ['expiresAt' => 'datetime', 'revokedAt' => 'datetime', 'lastUsedAt' => 'datetime'];
    }

    public function admin(): BelongsTo
    {
        return $this->belongsTo(AdminUser::class, 'adminUserId');
    }

    public function teacherAccount(): BelongsTo
    {
        return $this->belongsTo(TeacherAccount::class, 'teacherAccountId');
    }
}
