import mysql from 'mysql2/promise';
import { Redis } from 'ioredis';
import { randomBytes } from 'node:crypto';
import { WaitingRoomService } from '../../dist/services/waiting-room.js';

export const enabled=Boolean(process.env.WAITING_TEST_DATABASE_URL && process.env.REDIS_TEST_URL);
export async function fixture(count=8,settings={}){
  const url=new URL(process.env.WAITING_TEST_DATABASE_URL);
  if(!['127.0.0.1','localhost','::1'].includes(url.hostname) || !/^\/arena_waiting_test_/.test(url.pathname))throw new Error('Tests require an isolated local arena_waiting_test_* database');
  const redisUrl=new URL(process.env.REDIS_TEST_URL);
  if(!['127.0.0.1','localhost','::1'].includes(redisUrl.hostname))throw new Error('Tests require local Redis');
  const pool=mysql.createPool({uri:url.toString(),connectionLimit:12,timezone:'Z'});
  const redis=new Redis(redisUrl.toString(),{maxRetriesPerRequest:1});await redis.ping();
  const prefix=randomBytes(7).toString('hex');
  const [admin]=await pool.execute("INSERT INTO users(username,password_hash,name,role,status) VALUES(?,'not-used-by-test','Dummy Admin','ADMIN','ACTIVE')",[`wr-${prefix}`]);
  const studentRows=Array.from({length:count},(_,i)=>[`wr-${prefix}-${i}`,`${prefix}${String(i).padStart(5,'0')}`,`Dummy ${i}`,'X Test','X','ACTIVE',1]);
  for(let i=0;i<count;i+=500)await pool.query('INSERT INTO students(portal_student_id,nisn,name_snapshot,class_snapshot,grade_snapshot,cbt_status,is_active) VALUES ?',[studentRows.slice(i,i+500)]);
  const [students]=await pool.query('SELECT id FROM students WHERE portal_student_id LIKE ? ORDER BY id',[`wr-${prefix}-%`]);
  const now=Date.now();
  const [exam]=await pool.execute("INSERT INTO exams(public_id,name,grade,duration_minutes,session_number,starts_at,ends_at,academic_year,semester,status) VALUES(?,'Dummy FIFO','X',30,1,?,?,?,'ODD','ACTIVE')",[`WR${randomBytes(12).toString('hex')}`,new Date(now-60000),new Date(now+3600000),`TEST-${prefix}`]);
  const examId=exam.insertId;
  const questionRows=Array.from({length:3},(_,i)=>[`WQ${randomBytes(12).toString('hex')}`,examId,'MULTIPLE_CHOICE',`Dummy ${i}`,'A','B','C','D','A',1]);
  await pool.query('INSERT INTO questions(public_id,exam_id,question_type,question_text,option_a,option_b,option_c,option_d,correct_answer,points) VALUES ?',[questionRows]);
  const service=new WaitingRoomService(redis,pool,{secret:'waiting-test-secret-12345678901234567890',...settings});
  await service.configure(examId);
  return {pool,redis,service,examId,adminId:admin.insertId,students:students.map(row=>Number(row.id)),async close(){await redis.quit();await pool.end();}};
}
