import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, enabled } from './helpers/waiting-fixture.mjs';
import { StudentExamService } from '../dist/services/student-exam.js';
import { ScoringService, invalidateViolationThresholdCache } from '../dist/services/scoring.js';

test('real MySQL terminates on exactly the third violation and persists LOCK', {skip:!enabled}, async()=>{
  const f=await fixture(1);
  const student=f.students[0];
  const keys=['violation_termination_threshold','violation_action'];
  const [previous]=await f.pool.query('SELECT key_name,value FROM cbt_settings WHERE key_name IN (?,?)',keys);
  try {
    await f.pool.query("INSERT INTO cbt_settings(key_name,value) VALUES ('violation_termination_threshold','3'),('violation_action','LOCK') ON DUPLICATE KEY UPDATE value=VALUES(value)");
    invalidateViolationThresholdCache();
    await f.service.join(f.examId,student);await f.service.release(f.examId,true,0);
    const admitted=await f.service.status(f.examId,student);
    const exams=new StudentExamService(f.pool);
    await f.service.claim(f.examId,student,admitted.admit_token,receipt=>exams.start(student,f.examId,0,receipt));
    const scoring=new ScoringService(f.pool);
    for(let i=1;i<=3;i++){
      const result=await scoring.recordViolation(student,f.examId,`mysql-violation-${i}`,'TAB_HIDDEN');
      const [[row]]=await f.pool.execute('SELECT status,violation_count,termination_action FROM exam_attempts WHERE student_id=? AND exam_id=?',[student,f.examId]);
      assert.equal(Number(row.violation_count),i);
      assert.equal(row.status,i===3?'TERMINATED':'IN_PROGRESS');
      assert.equal(result.terminated,i===3);
      if(i===3)assert.equal(row.termination_action,'LOCK');
    }
    // Later global policy changes must not retroactively publish a LOCKed result.
    await f.pool.execute("UPDATE cbt_settings SET value='AUTO_SUBMIT' WHERE key_name='violation_action'");
    invalidateViolationThresholdCache();
    await assert.rejects(scoring.submit(student,f.examId),{statusCode:409});
    await assert.rejects(scoring.submit(student,f.examId,true),{statusCode:409});
    const [[row]]=await f.pool.execute('SELECT COUNT(*) n FROM exam_results r JOIN exam_attempts a ON a.id=r.attempt_id WHERE a.exam_id=?',[f.examId]);
    assert.equal(Number(row.n),0);
  } finally {
    await f.pool.query('DELETE FROM cbt_settings WHERE key_name IN (?,?)',keys);
    if(previous.length)await f.pool.query('INSERT INTO cbt_settings(key_name,value) VALUES ?',[previous.map(row=>[row.key_name,row.value])]);
    invalidateViolationThresholdCache();await f.close();
  }
});
