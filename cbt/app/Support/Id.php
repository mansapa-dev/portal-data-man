<?php
declare(strict_types=1);
namespace Cbt\Support;
final class Id { private const CHARS='0123456789ABCDEFGHJKMNPQRSTVWXYZ'; public static function ulid():string{$time=(int)floor(microtime(true)*1000);$out='';for($i=0;$i<10;$i++){$out=self::CHARS[$time%32].$out;$time=intdiv($time,32);}for($i=0;$i<16;$i++)$out.=self::CHARS[random_int(0,31)];return$out;} }
