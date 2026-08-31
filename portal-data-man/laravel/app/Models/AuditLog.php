<?php

namespace App\Models;

class AuditLog extends PortalModel
{
    public const UPDATED_AT = null;

    protected $table = 'AuditLog';

    // Change snapshots are intentionally exposed on the protected detail endpoint;
    // AuditService already removes credentials and token-like fields before storage.
    protected $hidden = ['id'];

    protected function casts(): array
    {
        return ['oldValues' => 'array', 'newValues' => 'array'];
    }
}
