<?php
namespace App\Support;
final class Ulid
{
    private const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    public static function generate(): string
    {
        $time = (int) floor(microtime(true) * 1000); $value = '';
        for ($i = 0; $i < 10; $i++) { $value = self::ALPHABET[$time % 32].$value; $time = intdiv($time, 32); }
        $bits = ''; foreach (str_split(random_bytes(10)) as $byte) $bits .= str_pad(decbin(ord($byte)), 8, '0', STR_PAD_LEFT);
        for ($i = 0; $i < 16; $i++) $value .= self::ALPHABET[bindec(substr($bits, $i * 5, 5))];
        return $value;
    }
}
