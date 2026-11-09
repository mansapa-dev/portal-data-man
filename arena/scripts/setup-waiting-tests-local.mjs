import { readFile } from 'node:fs/promises';
import mysql from 'mysql2/promise';

const value=process.env.WAITING_TEST_DATABASE_URL;
if(!value)throw new Error('Atur WAITING_TEST_DATABASE_URL ke database uji lokal baru');
const url=new URL(value),database=url.pathname.slice(1);
if(!['127.0.0.1','localhost','::1'].includes(url.hostname) || !/^arena_waiting_test_[a-zA-Z0-9_]+$/.test(database))throw new Error('Hanya database arena_waiting_test_* pada loopback yang diizinkan');
url.pathname='/';
const connection=await mysql.createConnection({uri:url.toString(),multipleStatements:true});
try{
  await connection.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await connection.query(`USE \`${database}\``);
  const [rows]=await connection.query("SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE()");
  if(rows.length){
    const names=new Set(rows.map(row=>String(row.TABLE_NAME ?? row.table_name)));
    if(!names.has('exam_waiting_settings') || !names.has('exam_waiting_claims'))throw new Error('DB uji tidak kosong tetapi migrasi waiting room belum lengkap');
    console.log('Schema uji sudah tersedia; data tidak dihapus.');
  }else{
    const files=['001_core.sql','002_staff_admin.sql','003_exam_retake_candidates.sql','004_exam_lookup_indexes.sql','006_exam_integrity_signals.sql','007_student_pin_ciphertext.sql','008_perf_indexes.sql','009_violation_threshold.sql','010_violation_anti_copy.sql','011_teacher_proctor_combined.sql','012_waiting_room.sql'];
    for(const file of files)await connection.query(await readFile(new URL(`../database/migrations/${file}`,import.meta.url),'utf8'));
    console.log(`Schema uji dibuat: ${database}. Tidak ada migrasi penghapusan yang dijalankan.`);
  }
}finally{await connection.end();}
