import type { Pool, RowDataPacket } from 'mysql2/promise';

export async function resetTerminatedAttempt(pool:Pool,studentId:number,examId:number,actorId:number,role:string,reason:string){
  const connection=await pool.getConnection();
  try{
    await connection.beginTransaction();
    if(role!=='ADMIN'){
      const[permission]=await connection.execute<RowDataPacket[]>("SELECT EXISTS(SELECT 1 FROM teacher_exam_assignments WHERE duty_role='PROCTOR' AND exam_id IS NULL AND ((teacher_id=(SELECT teacher_id FROM users WHERE id=?)) OR (employee_id=(SELECT employee_id FROM users WHERE id=?)))) allowed",[actorId,actorId]);
      if(!permission[0]?.allowed)throw Object.assign(new Error('Reset hanya tersedia bagi petugas piket'),{statusCode:403});
    }
    const[rows]=await connection.execute<RowDataPacket[]>('SELECT a.*,s.is_active,s.cbt_status FROM exam_attempts a JOIN students s ON s.id=a.student_id WHERE a.student_id=? AND a.exam_id=? FOR UPDATE',[studentId,examId]);
    const attempt=rows[0];
    if(!attempt||attempt.status!=='TERMINATED'||Number(attempt.violation_count)<3)throw Object.assign(new Error('Reset hanya tersedia untuk attempt yang dihentikan setelah tiga pelanggaran'),{statusCode:409});
    if(!attempt.is_active||attempt.cbt_status!=='ACTIVE')throw Object.assign(new Error('Akun siswa tidak aktif'),{statusCode:409});
    const[lastRows]=await connection.execute<RowDataPacket[]>('SELECT MAX(occurred_at) stopped_at FROM violations WHERE attempt_id=?',[attempt.id]);
    const stoppedAt=lastRows[0]?.stopped_at?new Date(lastRows[0].stopped_at).getTime():Date.now();
    const remaining=Math.max(0,new Date(attempt.expires_at).getTime()-stoppedAt);
    if(remaining<=0)throw Object.assign(new Error('Sisa waktu ujian sudah habis'),{statusCode:409});
    const expiresAt=new Date(Date.now()+remaining).toISOString().slice(0,19).replace('T',' ');
    const before={status:attempt.status,violation_count:Number(attempt.violation_count),expires_at:attempt.expires_at};
    await connection.execute('DELETE FROM exam_results WHERE attempt_id=?',[attempt.id]);
    await connection.execute("UPDATE exam_attempts SET status='IN_PROGRESS',violation_count=0,completed_at=NULL,expires_at=? WHERE id=?",[expiresAt,attempt.id]);
    await connection.execute("INSERT INTO audit_logs(actor_user_id,actor_role,action,entity_type,entity_id,before_data,after_data) VALUES(?,?,'CBT_ATTEMPT_RESUMED','ExamAttempt',?,?,?)",[actorId,role,attempt.public_id,JSON.stringify(before),JSON.stringify({status:'IN_PROGRESS',violation_count:0,expires_at:expiresAt,reason:reason.trim().slice(0,1000)})]);
    await connection.commit();
    return{attempt_id:attempt.public_id,expires_at:`${expiresAt}Z`};
  }catch(error){try{await connection.rollback();}catch{/* transaction may already be closed */}throw error;}
  finally{connection.release();}
}
