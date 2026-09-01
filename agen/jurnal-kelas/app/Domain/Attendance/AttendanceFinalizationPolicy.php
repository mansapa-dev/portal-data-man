<?php
namespace App\Domain\Attendance;
use InvalidArgumentException;
final class AttendanceFinalizationPolicy{public function assertCanFinalize(int $unmarked):void{if($unmarked>0)throw new InvalidArgumentException('Semua siswa harus ditandai sebelum finalisasi.');}}
