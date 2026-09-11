<?php
declare(strict_types=1);
namespace Cbt\Services;

use Cbt\Core\Database;
use Cbt\Exceptions\DomainException;
use Cbt\Repositories\AttemptRepository;

final class AttemptResetService
{
    public function __construct(private Database $db) {}

    public function reset(int $studentId, int $examId, int $actor, string $reason): array
    {
        if ($examId < 1 || trim($reason) === '') throw new DomainException('Pilih ujian dan isi alasan reset.', 422);
        return $this->db->transaction(function () use ($studentId, $examId, $actor, $reason) {
            $pdo = $this->db->pdo();
            $staff = $pdo->prepare("SELECT id,role,teacher_id FROM users WHERE id=? AND status='ACTIVE'");
            $staff->execute([$actor]);$staff=$staff->fetch();
            if(!$staff)throw new DomainException('Akun petugas tidak aktif.',403);
            $authorized=$staff['role']==='ADMIN';
            if(!$authorized&&$staff['role']==='TEACHER'&&(int)$staff['teacher_id']>0){$assignment=$pdo->prepare("SELECT id FROM teacher_exam_assignments WHERE teacher_id=? AND exam_id=? AND duty_role='PROCTOR'");$assignment->execute([(int)$staff['teacher_id'],$examId]);$authorized=(bool)$assignment->fetchColumn();}
            if(!$authorized)throw new DomainException('Reset CBT hanya dapat dilakukan petugas piket yang ditugaskan pada ujian ini.',403);
            $attempts = new AttemptRepository($pdo);
            $attempt = $attempts->find($studentId, $examId, true);
            if (!$attempt || $attempt['status'] !== 'TERMINATED' || (int)$attempt['violation_count'] < 3) {
                throw new DomainException('Reset hanya untuk ujian yang dihentikan karena tiga pelanggaran.', 409);
            }
            $exam = $pdo->prepare("SELECT e.id FROM exams e JOIN students s ON s.id=? WHERE e.id=? AND s.is_active=1 AND s.cbt_status='ACTIVE' LOCK IN SHARE MODE");
            $exam->execute([$studentId, $examId]);
            if (!$exam->fetchColumn()) throw new DomainException('Siswa harus aktif untuk melanjutkan ujian.', 409);
            $last = $pdo->prepare('SELECT MAX(occurred_at) FROM violations WHERE attempt_id=?');
            $last->execute([$attempt['id']]);
            $stoppedAt = $last->fetchColumn();
            $remaining = $stoppedAt ? max(0, strtotime($attempt['expires_at'].' UTC') - strtotime($stoppedAt.' UTC')) : 0;
            $expires = time() + $remaining;
            if ($expires <= time()) throw new DomainException('Sisa waktu ujian sudah habis.', 409);
            $after = ['status'=>'IN_PROGRESS', 'violation_count'=>0, 'expires_at'=>gmdate('Y-m-d H:i:s', $expires), 'reason'=>mb_substr(trim($reason), 0, 1000)];
            // Preserve the previous locked score in the same transaction as reopening.
            $before = ['status'=>$attempt['status'], 'violation_count'=>$attempt['violation_count'], 'expires_at'=>$attempt['expires_at'], 'result'=>$attempts->result((int)$attempt['id'])];
            $pdo->prepare("INSERT INTO audit_logs(actor_user_id,actor_role,action,entity_type,entity_id,before_data,after_data) VALUES(?,?,'CBT_ATTEMPT_RESUMED','ExamAttempt',?,?,?)")
                ->execute([$actor,$staff['role'],$attempt['public_id'],json_encode($before,JSON_THROW_ON_ERROR),json_encode($after,JSON_THROW_ON_ERROR)]);
            $pdo->prepare('DELETE FROM exam_results WHERE attempt_id=?')->execute([$attempt['id']]);
            $pdo->prepare("UPDATE exam_attempts SET status='IN_PROGRESS',violation_count=0,completed_at=NULL,expires_at=? WHERE id=?")
                ->execute([$after['expires_at'], $attempt['id']]);
            return ['attempt_id'=>$attempt['public_id'], 'expires_at'=>$after['expires_at'].'Z'];
        });
    }
}
