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
    public function visibleForStudent(array $student): array
    {
        $hasTargets=$this->hasStudentTargets();
        $studentTarget=$hasTargets?'student_target.student_id IS NOT NULL':'0=1';
        $regularTarget=$hasTargets?"({$studentTarget} OR (NOT EXISTS(SELECT 1 FROM exam_target_students ts0 WHERE ts0.exam_id=e.id) AND (NOT EXISTS(SELECT 1 FROM exam_target_classes x WHERE x.exam_id=e.id) OR class_target.exam_id IS NOT NULL)))":"(NOT EXISTS(SELECT 1 FROM exam_target_classes x WHERE x.exam_id=e.id) OR class_target.exam_id IS NOT NULL)";
        $specialEligible=$hasTargets?$studentTarget:'0=1';
        $sql="SELECT e.*,m.type follow_up_type,
              CASE WHEN e.status='ACTIVE' AND UTC_TIMESTAMP(3) BETWEEN e.starts_at AND e.ends_at
                AND (CASE WHEN m.exam_id IS NULL THEN {$regularTarget} ELSE {$specialEligible} END)
              THEN 1 ELSE 0 END can_start,
              CASE
                WHEN m.exam_id IS NOT NULL AND NOT ({$specialEligible}) THEN 'NOT_SCHEDULED'
                WHEN e.status<>'ACTIVE' THEN 'INACTIVE'
                WHEN UTC_TIMESTAMP(3)<e.starts_at THEN 'UPCOMING'
                WHEN UTC_TIMESTAMP(3)>e.ends_at THEN 'ENDED'
                WHEN NOT ({$regularTarget}) THEN 'NOT_ELIGIBLE'
                ELSE 'AVAILABLE'
              END availability_reason
              FROM exams e
              LEFT JOIN exam_attempts visible_attempt ON visible_attempt.exam_id=e.id AND visible_attempt.student_id=:attempt_student
              LEFT JOIN exam_follow_up_meta m ON m.exam_id=e.id
              LEFT JOIN exam_target_classes class_target ON class_target.exam_id=e.id AND class_target.portal_class_id=:class_id
              ".($hasTargets?'LEFT JOIN exam_target_students student_target ON student_target.exam_id=e.id AND student_target.student_id=:student_id':'')."
              WHERE e.grade=:grade
                AND (visible_attempt.id IS NOT NULL OR m.exam_id IS NOT NULL OR (e.status='ACTIVE' AND UTC_TIMESTAMP(3) BETWEEN e.starts_at AND e.ends_at AND {$regularTarget}))
              ORDER BY (m.exam_id IS NOT NULL) DESC,e.starts_at DESC";
        $statement=$this->db->prepare($sql);
        $params=['grade'=>$student['grade_snapshot'],'class_id'=>$student['portal_class_id'],'attempt_student'=>$student['id']];
        if($hasTargets)$params['student_id']=$student['id'];
        $statement->execute($params);
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
        if ($lock) $sql .= ' LOCK IN SHARE MODE';
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
