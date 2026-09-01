<?php
namespace Tests\Unit;
use App\Domain\Attendance\AttendanceFinalizationPolicy;
use App\Domain\Journal\JournalFinalizationPolicy;
use InvalidArgumentException;
use PHPUnit\Framework\TestCase;
final class FinalizationPolicyTest extends TestCase
{
    public function test_attendance_without_unmarked_can_finalize():void{(new AttendanceFinalizationPolicy())->assertCanFinalize(0);self::addToAssertionCount(1);}
    public function test_attendance_with_unmarked_is_rejected():void{$this->expectException(InvalidArgumentException::class);(new AttendanceFinalizationPolicy())->assertCanFinalize(1);}
    public function test_journal_requires_documentation():void{$this->expectException(InvalidArgumentException::class);(new JournalFinalizationPolicy())->assertCanFinalize(0);}
}
