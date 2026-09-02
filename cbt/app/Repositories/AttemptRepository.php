<?php
declare(strict_types=1);
namespace Cbt\Repositories;
use Cbt\Support\Id;
use PDO;
final class AttemptRepository
{
    public function __construct(private PDO $db) {}
    public function find(int $studentId, int $examId, bool $lock = false): ?array
    {
        $sql = 'SELECT * FROM exam_attempts WHERE student_id=:student_id AND exam_id=:exam_id LIMIT 1'.($lock ? ' FOR UPDATE' : '');
        $statement = $this->db->prepare($sql); $statement->execute(['student_id'=>$studentId,'exam_id'=>$examId]);
        return $statement->fetch() ?: null;
    }
    public function create(array $student, array $exam, array $questionOrder, array $optionMapping, string $seed): array
    {
        $expires = min(strtotime($exam['ends_at'].' UTC'), time() + ((int)$exam['duration_minutes'] * 60));
        $sql = 'INSERT INTO exam_attempts(public_id,student_id,exam_id,status,started_at,expires_at,random_seed,question_order,option_mapping,nisn_snapshot,name_snapshot,class_snapshot,grade_snapshot,academic_year_snapshot)
                VALUES(:public_id,:student_id,:exam_id,\'IN_PROGRESS\',UTC_TIMESTAMP(3),:expires_at,:seed,:question_order,:option_mapping,:nisn,:name,:class_name,:grade,:academic_year)';
        $statement = $this->db->prepare($sql);
        $statement->execute(['public_id'=>Id::ulid(),'student_id'=>$student['id'],'exam_id'=>$exam['id'],'expires_at'=>gmdate('Y-m-d H:i:s',$expires),'seed'=>$seed,'question_order'=>json_encode($questionOrder,JSON_THROW_ON_ERROR),'option_mapping'=>json_encode($optionMapping,JSON_THROW_ON_ERROR),'nisn'=>$student['nisn'],'name'=>$student['name_snapshot'],'class_name'=>$student['class_snapshot'],'grade'=>$student['grade_snapshot'],'academic_year'=>$student['academic_year_snapshot']]);
        return $this->find((int)$student['id'], (int)$exam['id'], true) ?? throw new \RuntimeException('Attempt gagal dibuat.');
    }
    public function answers(int $attemptId): array
    {
        $statement=$this->db->prepare('SELECT question_id,answer,is_flagged FROM student_answers WHERE attempt_id=:id');$statement->execute(['id'=>$attemptId]);
        return $statement->fetchAll();
    }
    public function result(int $attemptId): ?array
    {
        $statement=$this->db->prepare('SELECT * FROM exam_results WHERE attempt_id=:id');$statement->execute(['id'=>$attemptId]);return$statement->fetch()?:null;
    }
}
