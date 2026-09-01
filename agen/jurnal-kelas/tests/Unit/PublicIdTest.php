<?php
namespace Tests\Unit;
use App\Domain\Shared\PublicId;
use InvalidArgumentException;
use PHPUnit\Framework\TestCase;
final class PublicIdTest extends TestCase
{
    public function test_accepts_ulid(): void { self::assertSame('01J6A1BCDEFGHJKMNPQRSTVWXY', (string) new PublicId('01J6A1BCDEFGHJKMNPQRSTVWXY')); }
    public function test_rejects_numeric_database_id(): void { $this->expectException(InvalidArgumentException::class); new PublicId('12'); }
}
