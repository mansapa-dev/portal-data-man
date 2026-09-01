<?php
declare(strict_types=1);
use App\Infrastructure\Database\Connection;
$container = require dirname(__DIR__).'/bootstrap/app.php';
$pdo = $container->get(Connection::class)->pdo();
$pdo->exec('CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(100) PRIMARY KEY, applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)) ENGINE=InnoDB');
$exists = $pdo->prepare('SELECT COUNT(*) FROM schema_migrations WHERE version = :version');
$insert = $pdo->prepare('INSERT INTO schema_migrations(version) VALUES(:version)');
$applied = 0;
$exists->execute(['version' => '001_initial_schema']);
if ((int) $exists->fetchColumn() === 0) {
    $sql = file_get_contents(__DIR__.'/schema.sql');
    if ($sql === false) throw new RuntimeException('Schema tidak dapat dibaca.');
    $pdo->exec($sql); $insert->execute(['version' => '001_initial_schema']); $applied++;
}
foreach (glob(__DIR__.'/migrations/[0-9][0-9][0-9]_*.sql') ?: [] as $file) {
    $version = pathinfo($file, PATHINFO_FILENAME); $exists->execute(['version' => $version]);
    if ($version === '001_initial_schema') continue;
    if ((int) $exists->fetchColumn() > 0) continue;
    $sql = file_get_contents($file); if ($sql === false) throw new RuntimeException("Migration {$version} tidak dapat dibaca.");
    $pdo->exec($sql); $insert->execute(['version' => $version]); $applied++;
}
fwrite(STDOUT, $applied ? "{$applied} migration berhasil diterapkan.\n" : "Tidak ada migration baru.\n");
