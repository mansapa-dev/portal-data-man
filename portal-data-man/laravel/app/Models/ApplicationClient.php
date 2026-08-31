<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Relations\HasMany;

class ApplicationClient extends PortalModel
{
    protected $table = 'ApplicationClient';

    protected $hidden = ['id', 'clientSecretHash'];

    protected function casts(): array
    {
        return ['redirectUris' => 'array', 'postLogoutRedirectUris' => 'array', 'allowedOrigins' => 'array', 'allowedScopes' => 'array', 'allowedGrantTypes' => 'array'];
    }

    public function access(): HasMany
    {
        return $this->hasMany(TeacherApplicationAccess::class, 'applicationClientId');
    }
}
