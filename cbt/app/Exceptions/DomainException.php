<?php
declare(strict_types=1);
namespace Cbt\Exceptions;
final class DomainException extends \RuntimeException { public function __construct(string$message,public readonly int$status=422){parent::__construct($message);} }
