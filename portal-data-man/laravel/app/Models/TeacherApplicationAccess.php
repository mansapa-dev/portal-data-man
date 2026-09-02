<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class TeacherApplicationAccess extends Model
{
    protected $table = 'TeacherApplicationAccess';

    protected $hidden = ['id', 'teacherId', 'applicationClientId'];

    protected $guarded = ['id'];

    public const CREATED_AT = 'createdAt';

    public const UPDATED_AT = 'updatedAt';

    protected function casts(): array
    {
        return ['grantedAt' => 'datetime'];
    }

    public function teacher(): BelongsTo
    {
        return $this->belongsTo(Teacher::class, 'teacherId')->withTrashed();
    }

    public function application(): BelongsTo
    {
        return $this->belongsTo(ApplicationClient::class, 'applicationClientId');
    }
}
