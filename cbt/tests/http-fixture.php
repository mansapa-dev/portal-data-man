<?php
declare(strict_types=1);
if(PHP_SAPI!=='cli'||getenv('CBT_TEST_ISOLATED')!=='1')exit("Isolated test server required.\n");
$pdo=new PDO('mysql:host=127.0.0.1;port=13317;dbname=mysql;charset=utf8mb4','root','',[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION]);
$name='cbt_http_mass_test';
if(($argv[1]??'')==='cleanup'){$pdo->exec('DROP DATABASE IF EXISTS `'.$name.'`');exit;}
// Never overwrite an existing fixture: clean it explicitly after the previous run.
$pdo->exec('CREATE DATABASE `'.$name.'`');$pdo->exec('USE `'.$name.'`');
$pdo->exec((string)file_get_contents(dirname(__DIR__).'/database/schema.sql'));
$pdo->exec("INSERT INTO users(username,password_hash,name,role) VALUES('test-admin','unused','Test','ADMIN')");
$pdo->exec("INSERT INTO exams(public_id,name,grade,duration_minutes,starts_at,ends_at,academic_year,semester,status,created_by) VALUES('test-exam','Test Exam','X',60,UTC_TIMESTAMP()-INTERVAL 1 MINUTE,UTC_TIMESTAMP()+INTERVAL 1 HOUR,'2026','ODD','ACTIVE',1)");
$question=$pdo->prepare("INSERT INTO questions(public_id,exam_id,question_text,option_a,option_b,option_c,option_d,correct_answer) VALUES(?,1,'Question','A','B','C','D','B')");
for($i=1;$i<=5;$i++)$question->execute(['question-'.$i]);
$insert=$pdo->prepare("INSERT INTO students(portal_student_id,nisn,name_snapshot,grade_snapshot,pin_hash) VALUES(?,?,?,'X',?)");
$hash=password_hash('123456',PASSWORD_DEFAULT);
for($i=1;$i<=100;$i++)$insert->execute(['student-'.$i,str_pad((string)$i,10,'0',STR_PAD_LEFT),'Test Student '.$i,$hash]);
echo "Isolated fixture ready: {$name}\n";
