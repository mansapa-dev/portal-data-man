<?php
namespace App\Domain\Attendance;
use InvalidArgumentException;
final class Nisn
{
    public function __construct(public readonly string $value){if(!preg_match('/^\d{10}$/',$value))throw new InvalidArgumentException('NISN harus terdiri dari 10 digit.');}
    public function __toString():string{return $this->value;}
}
