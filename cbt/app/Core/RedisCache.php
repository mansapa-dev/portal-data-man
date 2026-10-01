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
                $redis = null;
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

    /**
     * Atomically consume one fixed-window rate-limit token.
     *
     * Returning null means Redis is unavailable and the caller must use its
     * correctness-preserving database fallback. Keeping the counter in Redis
     * prevents a shared school NAT address from turning one MySQL row lock
     * into a login bottleneck for every participant.
     *
     * @return array{allowed:bool,retry_after:int,attempts:int}|null
     */
    public static function consumeRateLimit(string $key, int $maximum, int $windowSeconds): ?array
    {
        $redis = self::connection();
        if ($redis === null) return null;
        try {
            $script = <<<'LUA'
local attempts = redis.call('INCR', KEYS[1])
if attempts == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('TTL', KEYS[1])
if ttl < 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {attempts, ttl}
LUA;
            $result = $redis->eval($script, [$key, max(1, $windowSeconds)], 1);
            if (!is_array($result) || count($result) < 2) return null;
            $attempts = (int) $result[0];
            return [
                'allowed' => $attempts <= max(1, $maximum),
                'retry_after' => max(1, (int) $result[1]),
                'attempts' => $attempts,
            ];
        } catch (\Throwable) {
            self::$connection = null;
            return null;
        }
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
            $redis->setOption(\Redis::OPT_READ_TIMEOUT, $timeout);
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
