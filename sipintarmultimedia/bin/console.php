<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') { http_response_code(404); exit; }
require dirname(__DIR__).'/app/bootstrap.php';
try {
    $identity = sip_identity();
    switch ($argv[1] ?? '') {
        case 'migrate':
            $identity->db->exec(file_get_contents(dirname(__DIR__).'/database/identity.sql'));
            foreach (['pegawai'=>['borrowings.create'], 'petugas'=>\Sipintar\Identity::PERMISSIONS, 'pemantau'=>['borrowings.read']] as $name=>$permissions) {
                if (!$identity->query('SELECT id FROM roles WHERE name=?',[$name])->fetchColumn()) $identity->saveRole($name,$permissions);
            }
            $imported = $identity->importLegacyUsers();
            echo "Skema identitas siap. $imported akun lama diimpor.\n"; break;
        case 'superadmin':
            $password = getenv('SIPINTARMULTIMEDIA_ADMIN_PASSWORD') ?: '';
            if (strlen($password)<12 || empty($argv[2])) throw new RuntimeException('Isi SIPINTARMULTIMEDIA_ADMIN_PASSWORD (minimal 12 karakter) dan argumen username.');
            $identity->query('INSERT INTO accounts (username,password_hash,name,superadmin_slot) VALUES (?,?,?,1)',[$argv[2],password_hash($password,PASSWORD_DEFAULT),'Superadmin']);
            echo "Superadmin dibuat. Constraint database menolak superadmin kedua.\n"; break;
        case 'sync-employees':
            $rows = (new \Sipintar\PortalClient(sip_config()['portal']))->employees();
            echo \Sipintar\PortalClient::sync($identity,$rows)." pegawai disinkronkan.\n"; break;
        case 'migrate-business':
            $db = sip_db('multimedia');
            foreach (['borrowings'=>['idx_borrowings_date'=>'date,time','idx_borrowings_returned'=>'returned,date']] as $table=>$indexes) foreach ($indexes as $name=>$columns) {
                if (!$db->query("SHOW INDEX FROM `$table` WHERE Key_name='$name'")->num_rows) $db->query("CREATE INDEX `$name` ON `$table` ($columns)");
            }
            echo "Migrasi SIPINTAR Multimedia selesai.\n"; break;
        default: echo "migrate | superadmin <username> | sync-employees | migrate-business\n";
    }
} catch (Throwable $e) { fwrite(STDERR,$e->getMessage()."\n"); exit(1); }
