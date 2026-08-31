<?php

namespace App\Models;

class AuditLog extends PortalModel
{
    public const UPDATED_AT = null;

    protected $table = 'AuditLog';

    protected $hidden = ['id', 'oldValues', 'newValues'];

    protected function casts(): array
    {
        return ['oldValues' => 'array', 'newValues' => 'array'];
    }
}
