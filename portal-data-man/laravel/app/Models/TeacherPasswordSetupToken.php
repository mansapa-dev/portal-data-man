<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\BelongsTo;

class TeacherPasswordSetupToken extends PortalModel
{
    public const UPDATED_AT = null;

    protected $table = 'TeacherPasswordSetupToken';

    protected $hidden = ['id', 'teacherAccountId', 'tokenHash'];

    protected function casts(): array
    {
        return ['expiresAt' => 'datetime', 'usedAt' => 'datetime'];
    }

    public function account(): BelongsTo
    {
        return $this->belongsTo(TeacherAccount::class, 'teacherAccountId');
    }
}
