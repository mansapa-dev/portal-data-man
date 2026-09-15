<?php
declare(strict_types=1);

if (PHP_SAPI !== 'cli') { http_response_code(403); exit; }

require dirname(__DIR__).'/bootstrap.php';

use Cbt\Core\Database;

session_write_close();
try {
    $pdo=(new Database())->pdo();
    $roleColumn=$pdo->query("SHOW COLUMNS FROM users LIKE 'role'")->fetch();
    $ready=(bool)$pdo->query("SHOW TABLES LIKE 'employees'")->fetchColumn()
        &&(bool)$pdo->query("SHOW COLUMNS FROM users LIKE 'employee_id'")->fetchColumn()
        &&(bool)$pdo->query("SHOW COLUMNS FROM teachers LIKE 'proctor_eligible'")->fetchColumn()
        &&(bool)$pdo->query("SHOW COLUMNS FROM teacher_exam_assignments LIKE 'employee_id'")->fetchColumn()
        &&is_array($roleColumn)&&str_contains((string)($roleColumn['Type']??''),'EMPLOYEE');
    $files=$ready?['20260915_global_exam_proctors.sql']:['20260915_separate_exam_proctors.sql','20260915_global_exam_proctors.sql'];
    foreach ($files as $file) {
        $sql=file_get_contents(dirname(__DIR__).'/database/migrations/'.$file);
        if($sql===false)throw new RuntimeException('Migration piket ujian tidak ditemukan: '.$file);
        $pdo->exec($sql);
    }
    fwrite(STDOUT, "Pemisahan guru mapel dan petugas piket berhasil diterapkan.\n");
} catch (Throwable $error) {
    fwrite(STDERR, "Upgrade piket gagal: {$error->getMessage()}\n");
    exit(1);
}
