<?php
declare(strict_types=1);
if (PHP_SAPI !== 'cli' || getenv('CBT_TEST_ISOLATED') !== '1') exit(2);
$pdo = new PDO('mysql:host=127.0.0.1;port=13317;charset=utf8mb4', 'root', '', [PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);
$action = $argv[1] ?? 'create';
if ($action === 'create') {
    $pdo->exec('CREATE DATABASE cbt_contention_test');
    $pdo->exec('USE cbt_contention_test');
    $pdo->exec(file_get_contents(dirname(__DIR__).'/database/schema.sql'));
    $pdo->exec("INSERT INTO users(username,password_hash,name,role) VALUES('test','unused','Test','ADMIN')");
    $pdo->exec("INSERT INTO exams(public_id,name,grade,duration_minutes,starts_at,ends_at,academic_year,semester,status,created_by) VALUES('exam','Test','X',60,UTC_TIMESTAMP()-INTERVAL 1 MINUTE,UTC_TIMESTAMP()+INTERVAL 2 HOUR,'2026','ODD','ACTIVE',1)");
    $pdo->exec("INSERT INTO questions(public_id,exam_id,question_type,question_text,option_a,option_b,correct_answer) VALUES('q1',1,'MULTIPLE_CHOICE','Question','A','B','B'),('q2',1,'SHORT_ANSWER','Question',NULL,NULL,'hello'),('q3',1,'MULTIPLE_RESPONSE','Question','A','B','A,B')");
    // Representative large option payload, without transferring it to PHP on save.
    $pdo->exec("UPDATE questions SET option_a=REPEAT('a',16000),option_b=REPEAT('b',16000) WHERE id IN (1,3)");
    $student=$pdo->prepare("INSERT INTO students(portal_student_id,nisn,name_snapshot,grade_snapshot) VALUES(?,?,?,'X')");
    $attempt=$pdo->prepare("INSERT INTO exam_attempts(public_id,student_id,exam_id,status,started_at,expires_at,random_seed,question_order,option_mapping,nisn_snapshot,name_snapshot,grade_snapshot) VALUES(?,?,1,'IN_PROGRESS',UTC_TIMESTAMP(),UTC_TIMESTAMP()+INTERVAL 2 HOUR,'seed','[1,2,3]','{\"1\":[\"A\",\"B\"],\"2\":[],\"3\":[\"A\",\"B\"]}',?,'Test','X')");
    $pdo->beginTransaction();
    for ($i=1;$i<=1200;$i++) {
        $nisn=str_pad((string)$i,10,'0',STR_PAD_LEFT);
        $student->execute(['s'.$i,$nisn,'Student '.$i]); $attempt->execute(['attempt-'.$i,$i,$nisn]);
    }
    $pdo->exec('INSERT INTO attempt_questions(attempt_id,question_id,question_type,question_text,option_a,option_b,correct_answer,points) SELECT a.id,q.id,q.question_type,q.question_text,q.option_a,q.option_b,q.correct_answer,q.points FROM exam_attempts a CROSS JOIN questions q');
    $pdo->commit();
} elseif ($action === 'cleanup') {
    $pdo->exec('DROP DATABASE cbt_contention_test');
} elseif ($action === 'stats') {
    $status=$pdo->query("SHOW GLOBAL STATUS WHERE Variable_name IN ('Threads_connected','Threads_running','Connections','Innodb_row_lock_waits','Innodb_row_lock_time','Innodb_log_waits')")->fetchAll(PDO::FETCH_KEY_PAIR);
    $commit=$pdo->query("SELECT COUNT_STAR count,SUM_TIMER_WAIT/1000000000 total_ms FROM performance_schema.events_statements_summary_global_by_event_name WHERE EVENT_NAME='statement/sql/commit'")->fetch();
    echo json_encode(['status'=>$status,'commit'=>$commit,'version'=>$pdo->query('SELECT VERSION()')->fetchColumn()]);
} elseif ($action === 'reset') {
    $pdo->exec('USE cbt_contention_test');
    $pdo->exec('DELETE FROM exam_results'); $pdo->exec('DELETE FROM answer_write_versions');
    $pdo->exec('DELETE FROM student_answers'); $pdo->exec('DELETE FROM violations');
    $pdo->exec("UPDATE exam_attempts SET status='IN_PROGRESS',violation_count=0,completed_at=NULL,expires_at=UTC_TIMESTAMP()+INTERVAL 2 HOUR");
} elseif ($action === 'waits') {
    echo $pdo->query("SELECT COUNT(*) FROM performance_schema.data_lock_waits w JOIN performance_schema.data_locks l ON l.ENGINE_LOCK_ID=w.REQUESTING_ENGINE_LOCK_ID AND l.ENGINE=w.ENGINE WHERE l.OBJECT_SCHEMA='cbt_contention_test'")->fetchColumn();
} elseif ($action === 'inspect') {
    $pdo->exec('USE cbt_contention_test');
    echo json_encode($pdo->query('SELECT a.student_id,a.status,s.question_id,s.answer,s.is_flagged,v.revision,r.score FROM exam_attempts a LEFT JOIN student_answers s ON s.attempt_id=a.id LEFT JOIN answer_write_versions v ON v.attempt_id=s.attempt_id AND v.question_id=s.question_id LEFT JOIN exam_results r ON r.attempt_id=a.id WHERE a.student_id<=3 ORDER BY a.student_id,s.question_id')->fetchAll());
} elseif ($action === 'expire') {
    $pdo->exec("UPDATE cbt_contention_test.exam_attempts SET expires_at=UTC_TIMESTAMP()-INTERVAL 1 MINUTE WHERE student_id=1");
} elseif ($action === 'terminate') {
    $pdo->exec("UPDATE cbt_contention_test.exam_attempts SET status='TERMINATED' WHERE student_id=1");
} elseif ($action === 'explain') {
    $pdo->exec('USE cbt_contention_test');
    foreach (["SELECT id,public_id,status,expires_at FROM exam_attempts WHERE student_id=1 AND exam_id=1 LIMIT 1 FOR UPDATE",
        'SELECT q.question_type,v.revision,v.mutation_id,a.id,a.answer,a.is_flagged FROM attempt_questions q LEFT JOIN answer_write_versions v ON v.attempt_id=q.attempt_id AND v.question_id=q.question_id LEFT JOIN student_answers a ON a.attempt_id=q.attempt_id AND a.question_id=q.question_id WHERE q.attempt_id=1 AND q.question_id=1',
        'SELECT t.id,t.public_id,q.question_type,(q.option_a IS NOT NULL AND q.option_a<>\'\') option_a_available,v.revision,v.mutation_id,a.answer,a.is_flagged FROM exam_attempts t LEFT JOIN attempt_questions q ON q.attempt_id=t.id AND q.question_id=1 LEFT JOIN answer_write_versions v ON v.attempt_id=q.attempt_id AND v.question_id=q.question_id LEFT JOIN student_answers a ON a.attempt_id=q.attempt_id AND a.question_id=q.question_id WHERE t.student_id=1 AND t.exam_id=1'] as $sql) {
        echo json_encode(['sql'=>$sql,'plan'=>$pdo->query('EXPLAIN '.$sql)->fetchAll()])."\n";
    }
} else exit(2);
