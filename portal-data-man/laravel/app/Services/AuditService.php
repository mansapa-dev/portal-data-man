<?php

namespace App\Services;

use App\Models\AuditLog;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;

class AuditService
{
    public function write(Request $request, string $action, string $entityType, ?string $entityPublicId = null, mixed $oldValues = null, mixed $newValues = null): void
    {
        $actor = $request->user('admin') ?? $request->user('teacher');
        AuditLog::query()->create(['actorType' => $request->user('admin') ? 'ADMIN' : 'TEACHER', 'actorPublicId' => $actor?->publicId, 'action' => $action, 'entityType' => $entityType, 'entityPublicId' => $entityPublicId, 'oldValues' => $this->safe($oldValues), 'newValues' => $this->safe($newValues), 'requestMethod' => $request->method(), 'requestPath' => $request->path(), 'ipAddress' => $request->ip(), 'userAgent' => mb_substr((string) $request->userAgent(), 0, 500)]);
    }

    private function safe(mixed $value): mixed
    {
        if ($value instanceof Model) {
            $value = $value->toArray();
        }
        if (! is_array($value)) {
            return $value;
        }
        $blocked = ['id', 'password', 'passwordHash', 'token', 'tokenHash', 'secret', 'secretHash', 'csrfHash', 'clientSecretHash'];
        $result = [];
        foreach ($value as $key => $item) {
            if (in_array((string) $key, $blocked, true)) {
                continue;
            }$result[$key] = $this->safe($item);
        }

return $result;
    }
}
