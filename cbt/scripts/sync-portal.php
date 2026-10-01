<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(403); exit; }
require dirname(__DIR__).'/bootstrap.php';
session_write_close();

use Cbt\Core\{Config, Database};
use Cbt\Integrations\PortalData\HttpPortalDataClient;
use Cbt\Services\PortalDataSyncService;
use Cbt\Support\PortalSyncSchedule;

$db = new Database();
$lock = $db->pdo()->query("SELECT GET_LOCK('cbt:portal-worker',0)")->fetchColumn();
if ((int)$lock !== 1) exit("Worker sinkronisasi sudah berjalan.\n");
$portal = new HttpPortalDataClient();
$sync = new PortalDataSyncService($db, $portal);
$interval = max(5, (int)Config::get('PORTAL_DATA_SYNC_INTERVAL', 60));
$fullInterval = max(300, (int)Config::get('PORTAL_DATA_SYNC_FULL_INTERVAL', 3600));
$employeeInterval = max(60, (int)Config::get('PORTAL_DATA_SYNC_EMPLOYEE_INTERVAL', 300));
$once = in_array('--once', $argv, true);
$versions = []; $lastSuccess = []; $lastFull = 0; $failures = 0;
try {
    do {
        try {
            $current = $portal->revisions();
            $full = time() - $lastFull >= $fullInterval;
            // Employees are independent from teacher reconciliation. Run them
            // first so a duplicate teacher identifier cannot hide proctor data.
            foreach (['ACADEMIC_YEARS', 'SEMESTERS', 'CLASSES', 'EMPLOYEES', 'TEACHERS', 'STUDENTS'] as $type) {
                $revision = PortalSyncSchedule::revision($current[$type] ?? null);
                if ($type !== 'EMPLOYEES' && $revision === null) {
                    throw new RuntimeException('Versi Portal Data tidak valid: '.$type);
                }
                if (PortalSyncSchedule::due($revision, $versions[$type] ?? null, $lastSuccess[$type] ?? null, time(), $full, $employeeInterval)) {
                    $result = $sync->sync($type, null);
                    $versions[$type] = $revision;
                    $lastSuccess[$type] = time();
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
        if (!$once) sleep(min(3600, $interval * (2 ** min($failures, 3))));
    } while (!$once);
} finally {
    $db->pdo()->query("SELECT RELEASE_LOCK('cbt:portal-worker')");
}
