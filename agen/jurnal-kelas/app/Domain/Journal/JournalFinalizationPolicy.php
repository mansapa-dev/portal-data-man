<?php
namespace App\Domain\Journal;
use InvalidArgumentException;
final class JournalFinalizationPolicy{public function assertCanFinalize(int $documentations):void{if($documentations<1)throw new InvalidArgumentException('Minimal satu dokumentasi diperlukan sebelum finalisasi.');}}
