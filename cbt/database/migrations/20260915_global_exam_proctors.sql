DELETE newer FROM teacher_exam_assignments newer
JOIN teacher_exam_assignments older
  ON newer.duty_role='PROCTOR' AND older.duty_role='PROCTOR' AND newer.id>older.id
 AND ((newer.teacher_id IS NOT NULL AND newer.teacher_id=older.teacher_id)
   OR (newer.employee_id IS NOT NULL AND newer.employee_id=older.employee_id));

ALTER TABLE teacher_exam_assignments MODIFY exam_id BIGINT UNSIGNED NULL;
UPDATE teacher_exam_assignments SET exam_id=NULL WHERE duty_role='PROCTOR';
