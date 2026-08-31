<?php

namespace App\Models\Concerns;

use Illuminate\Support\Str;

trait HasPortalIdentity
{
    protected static function bootHasPortalIdentity(): void
    {
        static::creating(function ($model): void {
            if (blank($model->publicId)) {
                $model->publicId = (string) Str::ulid();
            }
        });
    }

    public function getRouteKeyName(): string
    {
        return 'publicId';
    }
}
