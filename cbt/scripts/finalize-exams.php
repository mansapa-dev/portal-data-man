<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(403); exit; }
require dirname(__DIR__).'/bootstrap.php';
use Cbt\Core\Database;
use Cbt\Repositories\AttemptRepository;
use Cbt\Services\ScoringService;
// A separate CLI session is not needed during batch processing.
session_write_close();
$database = new Database();
$service = new ScoringService($database, new AttemptRepository($database->pdo()));
$summary = $service->finalizeDue((int)($argv[1] ?? 200));
fwrite(STDOUT, json_encode($summary, JSON_THROW_ON_ERROR).PHP_EOL);
exit($summary['failed'] ? 1 : 0);
