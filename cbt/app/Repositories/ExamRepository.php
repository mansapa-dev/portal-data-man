<?php
declare(strict_types=1);
namespace Cbt\Repositories;
use PDO;
final class ExamRepository
{
    public function __construct(private PDO $db) {}
    public function eligibleForStudent(array $student): array
    {
        $hasTargets=$this->hasStudentTargets();
        $targetRule=$hasTargets?"(EXISTS(SELECT 1 FROM exam_target_students ts WHERE ts.exam_id=e.id AND ts.student_id=:student_id)
                     OR (NOT EXISTS(SELECT 1 FROM exam_target_students ts WHERE ts.exam_id=e.id)
                         AND (NOT EXISTS(SELECT 1 FROM exam_target_classes x WHERE x.exam_id=e.id)
                              OR EXISTS(SELECT 1 FROM exam_target_classes x WHERE x.exam_id=e.id AND x.portal_class_id=:class_id))))":"(NOT EXISTS(SELECT 1 FROM exam_target_classes x WHERE x.exam_id=e.id) OR EXISTS(SELECT 1 FROM exam_target_classes x WHERE x.exam_id=e.id AND x.portal_class_id=:class_id))";
        $sql = "SELECT e.* FROM exams e WHERE e.status='ACTIVE' AND e.grade=:grade
                AND UTC_TIMESTAMP(3) BETWEEN e.starts_at AND e.ends_at
                AND {$targetRule}
                ORDER BY e.starts_at";
        $statement = $this->db->prepare($sql);
        $params=['grade' => $student['grade_snapshot'], 'class_id' => $student['portal_class_id']];if($hasTargets)$params['student_id']=$student['id'];$statement->execute($params);
        return $statement->fetchAll();
    }
    public function findEligible(int $examId, array $student, bool $lock = false): ?array
    {
        $hasTargets=$this->hasStudentTargets();
        $targetRule=$hasTargets?"(EXISTS(SELECT 1 FROM exam_target_students ts WHERE ts.exam_id=e.id AND ts.student_id=:student_id)
                     OR (NOT EXISTS(SELECT 1 FROM exam_target_students ts WHERE ts.exam_id=e.id)
                         AND (NOT EXISTS(SELECT 1 FROM exam_target_classes x WHERE x.exam_id=e.id)
                              OR EXISTS(SELECT 1 FROM exam_target_classes x WHERE x.exam_id=e.id AND x.portal_class_id=:class_id))))":"(NOT EXISTS(SELECT 1 FROM exam_target_classes x WHERE x.exam_id=e.id) OR EXISTS(SELECT 1 FROM exam_target_classes x WHERE x.exam_id=e.id AND x.portal_class_id=:class_id))";
        $sql = "SELECT e.* FROM exams e WHERE e.id=:id AND e.status='ACTIVE' AND e.grade=:grade
                AND UTC_TIMESTAMP(3) BETWEEN e.starts_at AND e.ends_at
                AND {$targetRule} LIMIT 1";
        if ($lock) $sql .= ' FOR UPDATE';
        $statement = $this->db->prepare($sql);
        $params=['id' => $examId, 'grade' => $student['grade_snapshot'], 'class_id' => $student['portal_class_id']];if($hasTargets)$params['student_id']=$student['id'];$statement->execute($params);
        return $statement->fetch() ?: null;
    }
    private function hasStudentTargets():bool{try{$s=$this->db->query("SHOW TABLES LIKE 'exam_target_students'");return(bool)$s->fetchColumn();}catch(\PDOException){return false;}}
    public function questions(int $examId, bool $includeAnswers = false): array
    {
        $columns = 'id, public_id, question_text, option_a, option_b, option_c, option_d, option_e, points';
        if ($includeAnswers) $columns .= ', correct_answer';
        $statement = $this->db->prepare("SELECT {$columns} FROM questions WHERE exam_id=:exam_id AND status='ACTIVE'");
        $statement->execute(['exam_id' => $examId]);
        return $statement->fetchAll();
    }
}
