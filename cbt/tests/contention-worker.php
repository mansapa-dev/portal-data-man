<?php
declare(strict_types=1);
// A persistent CLI connection for deterministic multi-connection tests and a
// bounded-worker service benchmark. Never reads .env or application sessions.
if (PHP_SAPI !== 'cli' || getenv('CBT_TEST_ISOLATED') !== '1') exit(2);
spl_autoload_register(function ($class) {
    if (!str_starts_with($class, 'Cbt\\')) return;
    $relative = str_replace('\\', '/', substr($class, 4));
    $baseline = getenv('CBT_CONTENTION_BASELINE');
    if ($baseline && in_array($relative, ['Core/Database', 'Services/AnswerService'], true)) {
        require $baseline.'/'.basename($relative).'.php';
    } else require dirname(__DIR__).'/app/'.$relative.'.php';
});
$_ENV = array_merge($_ENV, ['DB_HOST'=>'127.0.0.1','DB_PORT'=>'13317',
    'DB_DATABASE'=>'cbt_contention_test','DB_USERNAME'=>'root','DB_PASSWORD'=>'', 'REDIS_ENABLED'=>'false']);
use Cbt\Core\Database;
use Cbt\Repositories\AttemptRepository;
use Cbt\Services\{AnswerService,ScoringService,ViolationService};
$db = new Database(); $pdo = $db->pdo(); $repo = new AttemptRepository($pdo);
$answer = new AnswerService($db, $repo);
echo json_encode(['ready'=>true,'connection'=>(int)$pdo->query('SELECT CONNECTION_ID()')->fetchColumn()])."\n";
while (($line = fgets(STDIN)) !== false) {
    $job = json_decode($line, true, 512, JSON_THROW_ON_ERROR);
    $started = hrtime(true);
    try {
        $student = (int)($job['student'] ?? 1);
        if ($job['action']==='hold') {
            $pdo->beginTransaction(); $repo->lockForAnswer($student,1);
            if (!empty($job['change'])) {
                $pdo->exec("UPDATE student_answers SET answer='B' WHERE attempt_id=1 AND question_id=1");
                $pdo->exec("UPDATE answer_write_versions SET revision=revision+1,mutation_id='held-mutation-0000000000000000000' WHERE attempt_id=1 AND question_id=1");
            }
            echo "{\"ok\":true}\n"; continue;
        }
        if ($job['action']==='release') { $pdo->commit(); echo "{\"ok\":true}\n"; continue; }
        if (!empty($job['timeout'])) $pdo->exec('SET SESSION innodb_lock_wait_timeout=1');
        $result = match ($job['action']) {
            'save' => $answer->save($student, 1, (int)($job['question'] ?? 1), $job['answer'] ?? null,
                (bool)($job['flagged'] ?? false), $job['attempt'] ?? ('attempt-'.$student),
                (int)($job['revision'] ?? 0), $job['mutation']),
            'submit' => (new ScoringService($db, $repo))->submit($student, 1),
            'violation' => (new ViolationService($db, $repo))->record($student, 1, $job['event'], 'TAB_HIDDEN', null, '127.0.0.1', 'test'),
            'resume' => (new Cbt\Services\ExamSessionService($db,new Cbt\Repositories\StudentRepository($pdo),new Cbt\Repositories\ExamRepository($pdo),$repo))->start($student,str_pad((string)$student,10,'0',STR_PAD_LEFT),1),
            default => throw new RuntimeException('Unknown action'),
        };
        echo json_encode(['ok'=>true,'result'=>$result,'service_ms'=>(hrtime(true)-$started)/1e6])."\n";
    } catch (Throwable $error) {
        echo json_encode(['ok'=>false,'status'=>$error instanceof Cbt\Exceptions\DomainException ? $error->status : 500,
            'error'=>$error->getMessage(),'service_ms'=>(hrtime(true)-$started)/1e6])."\n";
    } finally {
        if (!empty($job['timeout'])) $pdo->exec('SET SESSION innodb_lock_wait_timeout=DEFAULT');
    }
}
