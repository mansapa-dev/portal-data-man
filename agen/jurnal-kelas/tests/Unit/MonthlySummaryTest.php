<?php
namespace Tests\Unit;
use App\Domain\Journal\MonthlySummary;
use PHPUnit\Framework\TestCase;
final class MonthlySummaryTest extends TestCase
{
    public function test_calculates_totals_and_percentage():void{$result=(new MonthlySummary())->calculate([['totalStudents'=>10,'present'=>8,'sick'=>1,'permitted'=>1,'absent'=>0,'notParticipating'=>0,'status'=>'FINAL']]);self::assertSame(1,$result['totalJournals']);self::assertSame(80.0,$result['attendancePercentage']);}
}
