<?php
namespace Tests\Unit;
use App\Domain\Journal\LessonPeriod;
use InvalidArgumentException;
use PHPUnit\Framework\TestCase;
final class LessonPeriodTest extends TestCase
{
    public function test_accepts_consecutive_period(): void { self::assertSame('3–4', (new LessonPeriod(3,4))->label()); }
    public function test_rejects_reversed_period(): void { $this->expectException(InvalidArgumentException::class); new LessonPeriod(5,3); }
}
