import { readFile } from 'node:fs/promises';
import mysql from 'mysql2/promise';

const url=process.env.DATABASE_URL;
if(!url || !['127.0.0.1','localhost','::1'].includes(new URL(url).hostname))throw new Error('Migrasi otomatis hanya untuk DB lokal');
const connection=await mysql.createConnection({uri:url,multipleStatements:true});
try{
  const [rows]=await connection.execute("SELECT TABLE_NAME FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN ('exam_waiting_settings','exam_waiting_claims')");
  if(rows.length===2)console.log('Migrasi waiting room sudah tersedia.');
  else if(rows.length)throw new Error('Migrasi waiting room tidak lengkap. Periksa schema sebelum melanjutkan.');
  else{await connection.query(await readFile(new URL('../database/migrations/012_waiting_room.sql',import.meta.url),'utf8'));console.log('Applied 012_waiting_room.sql');}
}finally{await connection.end();}
