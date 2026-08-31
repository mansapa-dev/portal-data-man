<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ImportRowResult extends Model
{
    protected $table = 'ImportRowResult';

    protected $hidden = ['id', 'importBatchId'];

    protected $guarded = ['id'];

    public const CREATED_AT = 'createdAt';

    public const UPDATED_AT = null;

    protected function casts(): array
    {
        return ['messages' => 'array', 'originalData' => 'array', 'normalizedData' => 'array'];
    }

    public function batch(): BelongsTo
    {
        return $this->belongsTo(ImportBatch::class, 'importBatchId');
    }
}
