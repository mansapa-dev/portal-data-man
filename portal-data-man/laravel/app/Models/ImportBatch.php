<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\HasMany;

class ImportBatch extends PortalModel
{
    protected $table = 'ImportBatch';

    protected $hidden = ['id', 'storedFilename', 'fileHash', 'errorFilePath'];

    protected function casts(): array
    {
        return ['summary' => 'array', 'startedAt' => 'datetime', 'completedAt' => 'datetime'];
    }

    public function rows(): HasMany
    {
        return $this->hasMany(ImportRowResult::class, 'importBatchId');
    }
}
