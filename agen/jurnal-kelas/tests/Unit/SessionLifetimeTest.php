<?php

namespace Tests\Unit;

use PHPUnit\Framework\TestCase;

final class SessionLifetimeTest extends TestCase
{
    public function test_auth_session_lifetime_is_configured_for_long_term_persistence(): void
    {
        $config = require __DIR__ . '/../../config/auth.php';

        self::assertArrayHasKey('session_lifetime', $config);
        // Minimal 30 hari (2592000 detik), default kita adalah 1 tahun (31536000 detik)
        self::assertGreaterThanOrEqual(2592000, $config['session_lifetime']);
    }
}
