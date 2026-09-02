<?php
declare(strict_types=1);
namespace Cbt\Repositories;
use PDO;
final class ExamRepository
{
    public function __construct(private PDO $db) {}
    public function eligibleForStudent(array $student): array
    {
        $sql = "SELECT e.* FROM exams e WHERE e.status='ACTIVE' AND e.grade=:grade
                AND UTC_TIMESTAMP(3) BETWEEN e.starts_at AND e.ends_at
                AND (NOT EXISTS(SELECT 1 FROM exam_target_classes x WHERE x.exam_id=e.id)
                     OR EXISTS(SELECT 1 FROM exam_target_classes x WHERE x.exam_id=e.id AND x.portal_class_id=:class_id))
                ORDER BY e.starts_at";
        $statement = $this->db->prepare($sql);
        $statement->execute(['grade' => $student['grade_snapshot'], 'class_id' => $student['portal_class_id']]);
        return $statement->fetchAll();
    }
    public function findEligible(int $examId, array $student, bool $lock = false): ?array
    {
        $sql = "SELECT e.* FROM exams e WHERE e.id=:id AND e.status='ACTIVE' AND e.grade=:grade
                AND UTC_TIMESTAMP(3) BETWEEN e.starts_at AND e.ends_at
                AND (NOT EXISTS(SELECT 1 FROM exam_target_classes x WHERE x.exam_id=e.id)
                     OR EXISTS(SELECT 1 FROM exam_target_classes x WHERE x.exam_id=e.id AND x.portal_class_id=:class_id)) LIMIT 1";
        if ($lock) $sql .= ' FOR UPDATE';
        $statement = $this->db->prepare($sql);
        $statement->execute(['id' => $examId, 'grade' => $student['grade_snapshot'], 'class_id' => $student['portal_class_id']]);
        return $statement->fetch() ?: null;
    }
    public function questions(int $examId, bool $includeAnswers = false): array
    {
        $columns = 'id, public_id, question_text, option_a, option_b, option_c, option_d, option_e, points';
        if ($includeAnswers) $columns .= ', correct_answer';
        $statement = $this->db->prepare("SELECT {$columns} FROM questions WHERE exam_id=:exam_id AND status='ACTIVE'");
        $statement->execute(['exam_id' => $examId]);
        return $statement->fetchAll();
    }
}
