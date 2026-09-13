<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(403); exit; }
require dirname(__DIR__).'/bootstrap.php';
session_write_close();

use Cbt\Core\{Config, Database};
use Cbt\Integrations\PortalData\HttpPortalDataClient;
use Cbt\Services\PortalDataSyncService;

$db = new Database();
$lock = $db->pdo()->query("SELECT GET_LOCK('cbt:portal-worker',0)")->fetchColumn();
if ((int)$lock !== 1) exit("Worker sinkronisasi sudah berjalan.\n");
$portal = new HttpPortalDataClient();
$sync = new PortalDataSyncService($db, $portal);
$interval = max(5, (int)Config::get('PORTAL_DATA_SYNC_INTERVAL', 5));
$once = in_array('--once', $argv, true);
$versions = []; $lastFull = 0; $failures = 0;
try {
    do {
        try {
            $current = $portal->revisions();
            $full = time() - $lastFull >= 300;
            foreach (['ACADEMIC_YEARS', 'SEMESTERS', 'CLASSES', 'TEACHERS', 'STUDENTS'] as $type) {
                if (!isset($current[$type]) || !is_string($current[$type]) || !preg_match('/^[a-f0-9]{64}$/', $current[$type])) {
                    throw new RuntimeException('Versi Portal Data tidak valid: '.$type);
                }
                if ($full || ($versions[$type] ?? null) !== $current[$type]) {
                    $result = $sync->sync($type, null);
                    $versions[$type] = $current[$type];
                    fwrite(STDOUT, gmdate(DATE_ATOM).' '.$type.' '.json_encode($result).PHP_EOL);
                }
            }
            if ($full) $lastFull = time();
            $failures = 0;
        } catch (Throwable $error) {
            fwrite(STDERR, gmdate(DATE_ATOM).' Sync gagal: '.$error->getMessage().PHP_EOL);
            if ($error instanceof PDOException) throw $error; // Supervisor reconnects after database failure.
            $failures++;
            if ($once) exit(1);
        }
        if (!$once) sleep(min(60, $interval * (2 ** min($failures, 3))));
    } while (!$once);
} finally {
    $db->pdo()->query("SELECT RELEASE_LOCK('cbt:portal-worker')");
}
