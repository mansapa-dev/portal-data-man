<?php
declare(strict_types=1);
namespace Cbt\Core;

/** Opt-in sampling, bounded fields, no SQL, identity, mutation or answer data. */
final class TransactionProfile
{
    private int $started;
    private array $timings = [];
    private function __construct(private string $operation) { $this->started = hrtime(true); }

    public static function sample(string $operation): ?self
    {
        $rate = max(0.0, min(1.0, (float)Config::get('CBT_PROFILE_SAMPLE_RATE', 0)));
        if ($rate <= 0 || ($rate < 1 && mt_rand() / mt_getrandmax() >= $rate)) return null;
        return new self($operation);
    }

    public function measure(string $phase, callable $action): mixed
    {
        $start = hrtime(true);
        try { return $action(); }
        finally { $this->add($phase, (hrtime(true) - $start) / 1e6); }
    }

    public function add(string $phase, float $milliseconds): void
    {
        $this->timings[$phase] = ($this->timings[$phase] ?? 0.0) + $milliseconds;
    }

    public function finish(string $outcome): void
    {
        // Called only after COMMIT/ROLLBACK. Logging cannot turn a committed save
        // into an error response, even when an application error handler throws.
        try {
            error_log('CBT_PROFILE '.json_encode(['operation'=>$this->operation,'outcome'=>$outcome,
                'total_ms'=>(hrtime(true)-$this->started)/1e6] + $this->timings, JSON_THROW_ON_ERROR));
        } catch (\Throwable) {}
    }
}
