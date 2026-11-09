import mysql from 'mysql2/promise';
import { hashSync } from 'bcryptjs';
import { randomBytes } from 'node:crypto';
import { mkdir,writeFile } from 'node:fs/promises';
import { issueToken } from '../apps/api/dist/lib/auth.js';

const url=process.env.DATABASE_URL,count=Number(process.env.WAITING_LOAD_STUDENTS ?? 5000);
if(!url || !['127.0.0.1','localhost','::1'].includes(new URL(url).hostname) || process.env.NODE_ENV==='production')throw new Error('Seed hanya boleh memakai database lokal non-production');
if(!process.env.AUTH_TOKEN_SECRET || process.env.AUTH_TOKEN_SECRET.length<32)throw new Error('Atur secret dummy lokal minimal 32 karakter');
if(!Number.isSafeInteger(count) || count<1000 || count>10000)throw new Error('Jumlah siswa dummy harus 1000–10000');
const pool=mysql.createPool({uri:url,connectionLimit:4,timezone:'Z'});
const run=randomBytes(6).toString('hex'),pin=hashSync('1234',10),stamp=String(Date.now()).slice(-8);
try{
  const values=Array.from({length:count},(_,i)=>[`waiting-load-${run}-${i}`,`99${stamp}${String(i).padStart(5,'0')}`,`Siswa Dummy FIFO ${i+1}`,'X Simulasi','X',pin,'ACTIVE',1]);
  for(let i=0;i<count;i+=500)await pool.query('INSERT INTO students(portal_student_id,nisn,name_snapshot,class_snapshot,grade_snapshot,pin_hash,cbt_status,is_active) VALUES ?',[values.slice(i,i+500)]);
  const [exam]=await pool.execute("INSERT INTO exams(public_id,name,grade,duration_minutes,session_number,starts_at,ends_at,academic_year,semester,status) VALUES(?,'Simulasi FIFO lokal','X',30,1,?,?,?,'ODD','ACTIVE')",[`WL${randomBytes(12).toString('hex')}`,new Date(Date.now()-60000),new Date(Date.now()+7200000),`LOAD-${run}`]);
  const questions=Array.from({length:40},(_,i)=>[`WQ${randomBytes(12).toString('hex')}`,exam.insertId,'MULTIPLE_CHOICE',`Soal dummy ${i+1}`,'Pilihan A','Pilihan B','Pilihan C','Pilihan D','A',1]);
  await pool.query('INSERT INTO questions(public_id,exam_id,question_type,question_text,option_a,option_b,option_c,option_d,correct_answer,points) VALUES ?',[questions]);
  const [rows]=await pool.query('SELECT id FROM students WHERE portal_student_id LIKE ? ORDER BY id',[`waiting-load-${run}-%`]);
  const users=rows.map(row=>{const csrf=randomBytes(32).toString('hex');return {student_id:Number(row.id),csrf,token:issueToken({sub:Number(row.id),role:'STUDENT',csrf,exp:Math.floor(Date.now()/1000)+43200})};});
  await mkdir(new URL('../tmp/',import.meta.url),{recursive:true});
  await writeFile(new URL('../tmp/waiting-load-tokens.json',import.meta.url),JSON.stringify({exam_id:exam.insertId,duration_minutes:30,users}),{mode:0o600});
  console.log(`Seed dummy selesai: exam_id=${exam.insertId}, siswa=${users.length}, soal=40. Token: tmp/waiting-load-tokens.json`);
}finally{await pool.end();}
