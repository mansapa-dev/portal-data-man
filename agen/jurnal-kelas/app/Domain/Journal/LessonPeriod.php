<?php
namespace App\Domain\Journal;

use InvalidArgumentException;

final class LessonPeriod
{
    public function __construct(public int $start, public int $end)
    {
        if ($start < 1 || $start > 11 || $end < $start || $end > 11) throw new InvalidArgumentException('Jam pelajaran harus berurutan antara 1 sampai 11.');
    }
    public function label(): string { return $this->start === $this->end ? (string) $this->start : $this->start.'–'.$this->end; }
}
