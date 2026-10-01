<?php
declare(strict_types=1);
namespace Cbt\Support;

/** Pure scheduling policy; only successful syncs advance the worker state. */
final class PortalSyncSchedule
{
 public static function revision(mixed $value): ?string
 {
  return is_string($value) && preg_match('/^[a-f0-9]{64}$/D', $value) === 1 ? $value : null;
 }

 public static function due(?string $revision, ?string $previous, ?int $lastSuccess, int $now, bool $full, int $fallbackSeconds): bool
 {
  if ($full || $lastSuccess === null) return true;
  if ($revision !== null) return $revision !== $previous;
  return $now - $lastSuccess >= max(60, $fallbackSeconds);
 }
}
