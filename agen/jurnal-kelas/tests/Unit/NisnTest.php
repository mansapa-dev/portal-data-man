<?php
namespace Tests\Unit;
use App\Domain\Attendance\Nisn;
use InvalidArgumentException;
use PHPUnit\Framework\TestCase;
final class NisnTest extends TestCase
{
    public function test_accepts_ten_digits():void{self::assertSame('0012345678',(string)new Nisn('0012345678'));}
    public function test_rejects_non_digit_or_wrong_length():void{$this->expectException(InvalidArgumentException::class);new Nisn('ABC123');}
}
