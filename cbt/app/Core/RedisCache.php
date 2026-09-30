<?php
declare(strict_types=1);
namespace Cbt\Core;

/** Small optional Redis cache. Every caller must remain correct on cache miss/failure. */
final class RedisCache
{
    private static ?\Redis $connection = null;
    private static bool $resolved = false;

    public static function remember(string $key, int $ttl, callable $loader, bool $sensitive = false): mixed
    {
        $cipher = $sensitive ? new \Cbt\Support\SecretCipher() : null;
        if ($sensitive && Config::get('APP_KEY') === null) return $loader();
        $redis = self::connection();
        if ($redis !== null) {
            try {
                $cached = $redis->get($key);
                if (is_string($cached)) {
                    $serialized = $sensitive ? $cipher?->decrypt($cached) : $cached;
                    $value = is_string($serialized) ? unserialize($serialized, ['allowed_classes' => false]) : false;
                    if ($value !== false || $cached === serialize(false)) return $value;
                }
            } catch (\Throwable) {
                self::$connection = null;
            }
        }

        $value = $loader();
        if ($redis !== null && self::$connection !== null) {
            try {
                $serialized = serialize($value);
                $stored = $sensitive ? $cipher?->encrypt($serialized) : $serialized;
                if (is_string($stored)) $redis->setex($key, max(1, $ttl), $stored);
            }
            catch (\Throwable) { self::$connection = null; }
        }
        return $value;
    }

    public static function forget(string $key): void
    {
        $redis = self::connection();
        if ($redis === null) return;
        try { $redis->del($key); } catch (\Throwable) { self::$connection = null; }
    }

    private static function connection(): ?\Redis
    {
        if (self::$resolved) return self::$connection;
        self::$resolved = true;
        if (!class_exists(\Redis::class) || !Config::bool('REDIS_ENABLED', false)) return null;
        try {
            $redis = new \Redis();
            $host = (string) Config::get('REDIS_HOST', '127.0.0.1');
            $port = (int) Config::get('REDIS_PORT', 6379);
            $timeout = max(0.05, (float) Config::get('REDIS_TIMEOUT', 0.15));
            if (!$redis->connect($host, $port, $timeout)) return null;
            $password = Config::get('REDIS_PASSWORD');
            if ($password !== null && !$redis->auth((string) $password)) return null;
            $database = max(0, (int) Config::get('REDIS_DATABASE', 0));
            if ($database > 0 && !$redis->select($database)) return null;
            $redis->setOption(\Redis::OPT_PREFIX, (string) Config::get('REDIS_PREFIX', 'cbt:'));
            self::$connection = $redis;
        } catch (\Throwable) { self::$connection = null; }
        return self::$connection;
    }
}
