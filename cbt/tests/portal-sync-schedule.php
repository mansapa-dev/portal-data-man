<?php
declare(strict_types=1);
require dirname(__DIR__).'/app/Support/PortalSyncSchedule.php';
use Cbt\Support\PortalSyncSchedule as Schedule;
$revision = str_repeat('a', 64);
$checks = [
 'first sync runs' => Schedule::due($revision, null, null, 1000, false, 300),
 'unchanged revision skips writes' => !Schedule::due($revision, $revision, 900, 1000, false, 300),
 'changed revision runs immediately' => Schedule::due(str_repeat('b', 64), $revision, 999, 1000, false, 300),
 'employee fallback does not run every poll' => !Schedule::due(null, null, 995, 1000, false, 300),
 'employee fallback eventually runs' => Schedule::due(null, null, 700, 1000, false, 300),
 'full sync still reconciles unchanged data' => Schedule::due($revision, $revision, 999, 1000, true, 300),
 'newly available revision is used' => Schedule::due($revision, null, 999, 1000, false, 300),
 'invalid revisions use fallback' => Schedule::revision('invalid') === null && Schedule::revision([]) === null,
 'valid revision accepted' => Schedule::revision($revision) === $revision,
];
foreach ($checks as $label => $ok) {
 if (!$ok) throw new RuntimeException($label);
 echo 'PASS '.$label.PHP_EOL;
}
