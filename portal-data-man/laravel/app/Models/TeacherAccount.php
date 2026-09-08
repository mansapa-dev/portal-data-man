<?php

namespace App\Models;

use App\Models\Concerns\HasPortalIdentity;
use Illuminate\Auth\Authenticatable;
use Illuminate\Contracts\Auth\Authenticatable as AuthenticatableContract;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class TeacherAccount extends Model implements AuthenticatableContract
{
    use Authenticatable, HasPortalIdentity;

    protected $table = 'TeacherAccount';

    protected $guarded = ['id'];

    protected $hidden = ['id', 'teacherId', 'employeeId', 'passwordHash', 'initialPassword'];

    public const CREATED_AT = 'createdAt';

    public const UPDATED_AT = 'updatedAt';

    protected function casts(): array
    {
        return ['mustChangePassword' => 'boolean', 'initialPassword' => 'encrypted', 'lockedUntil' => 'datetime', 'lastLoginAt' => 'datetime', 'passwordChangedAt' => 'datetime', 'activatedAt' => 'datetime', 'disabledAt' => 'datetime'];
    }

    public function getAuthPasswordName(): string
    {
        return 'passwordHash';
    }

    public function teacher(): BelongsTo
    {
        return $this->belongsTo(Teacher::class, 'teacherId');
    }

    public function employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class, 'employeeId');
    }

    public function person(): Teacher|Employee|null
    {
        return $this->teacher ?? $this->employee;
    }

    public function accountType(): string
    {
        return $this->employeeId ? 'EMPLOYEE' : 'TEACHER';
    }

    public function sessions(): HasMany
    {
        return $this->hasMany(AuthSession::class, 'teacherAccountId');
    }
}
