<?php
namespace App\Domain\Shared;

use InvalidArgumentException;

final class PublicId
{
    public function __construct(public string $value)
    {
        if (!preg_match('/^[0-9A-HJKMNP-TV-Z]{26}$/', $value)) throw new InvalidArgumentException('Public ID harus berupa ULID yang valid.');
    }
    public function __toString(): string { return $this->value; }
}
