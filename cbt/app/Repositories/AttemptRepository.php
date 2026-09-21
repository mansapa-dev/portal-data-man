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
    public function create(array $student, array $exam, array $questionOrder, array $optionMapping, string $seed, array $questions): array
    {
        $expires = min(strtotime($exam['ends_at'].' UTC'), time() + ((int)$exam['duration_minutes'] * 60));
        $sql = 'INSERT INTO exam_attempts(public_id,student_id,exam_id,status,started_at,expires_at,random_seed,question_order,option_mapping,nisn_snapshot,name_snapshot,class_snapshot,grade_snapshot,academic_year_snapshot)
                VALUES(:public_id,:student_id,:exam_id,\'IN_PROGRESS\',UTC_TIMESTAMP(3),:expires_at,:seed,:question_order,:option_mapping,:nisn,:name,:class_name,:grade,:academic_year)';
        $statement = $this->db->prepare($sql);
        $statement->execute(['public_id'=>Id::ulid(),'student_id'=>$student['id'],'exam_id'=>$exam['id'],'expires_at'=>gmdate('Y-m-d H:i:s',$expires),'seed'=>$seed,'question_order'=>json_encode($questionOrder,JSON_THROW_ON_ERROR),'option_mapping'=>json_encode($optionMapping,JSON_THROW_ON_ERROR),'nisn'=>$student['nisn'],'name'=>$student['name_snapshot'],'class_name'=>$student['class_snapshot'],'grade'=>$student['grade_snapshot'],'academic_year'=>$student['academic_year_snapshot']]);
        $attempt = $this->find((int)$student['id'], (int)$exam['id'], true) ?? throw new \RuntimeException('Attempt gagal dibuat.');
        // Batch snapshots to avoid one database round trip per question at mass start.
        foreach (array_chunk($questions, 100) as $batch) {
            $values = [];
            foreach ($batch as $q) array_push($values, $attempt['id'], $q['id'], $q['question_text'], $q['option_a'], $q['option_b'], $q['option_c'], $q['option_d'], $q['option_e'], $q['correct_answer'], $q['points']);
            $sql = 'INSERT INTO attempt_questions(attempt_id,question_id,question_text,option_a,option_b,option_c,option_d,option_e,correct_answer,points) VALUES '.implode(',', array_fill(0, count($batch), '(?,?,?,?,?,?,?,?,?,?)'));
            $this->db->prepare($sql)->execute($values);
        }
        return $attempt;
    }
    public function questions(int $attemptId): array
    {
        $statement = $this->db->prepare('SELECT question_id id,question_text,option_a,option_b,option_c,option_d,option_e,points FROM attempt_questions WHERE attempt_id=:id');
        $statement->execute(['id'=>$attemptId]);
        return $statement->fetchAll();
    }
    public function answers(int $attemptId): array
    {
        $statement=$this->db->prepare('SELECT a.question_id,a.answer,a.is_flagged,COALESCE(v.revision,0) revision,v.mutation_id FROM student_answers a LEFT JOIN answer_write_versions v ON v.attempt_id=a.attempt_id AND v.question_id=a.question_id WHERE a.attempt_id=:id');$statement->execute(['id'=>$attemptId]);
        return $statement->fetchAll();
    }
    public function result(int $attemptId): ?array
    {
        $statement=$this->db->prepare('SELECT * FROM exam_results WHERE attempt_id=:id');$statement->execute(['id'=>$attemptId]);return$statement->fetch()?:null;
    }
}
