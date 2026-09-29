<?php
declare(strict_types=1);
require dirname(__DIR__).'/bootstrap.php';
use Cbt\Core\Database;
if(PHP_SAPI!=='cli'){http_response_code(403);exit("CLI only\n");}
$schema=file_get_contents(__DIR__.'/schema.sql');if($schema===false)throw new RuntimeException('schema.sql tidak ditemukan.');
$db=(new Database())->pdo();$db->exec($schema);
$migrations=glob(__DIR__.'/migrations/*.sql')?:[];sort($migrations);
$safeDuplicateErrors=[1060,1061,1091,1826];
foreach($migrations as$file){
 $sql=file_get_contents($file);if($sql===false)throw new RuntimeException("Migration {$file} tidak dapat dibaca.");
 // Older MySQL releases do not understand ADD/DROP COLUMN IF [NOT] EXISTS.
 // Execute statements individually and treat an already-applied named schema
 // change as success, while still surfacing data and syntax failures.
 $sql=preg_replace('/\bADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\b/i','ADD COLUMN',$sql);
 $sql=preg_replace('/\bDROP\s+COLUMN\s+IF\s+EXISTS\b/i','DROP COLUMN',$sql);
 foreach(array_filter(array_map('trim',preg_split('/;\s*(?:\R|$)/',$sql)?:[]))as$statement){
  try{$db->exec($statement);}
  catch(\PDOException$error){$driverCode=(int)($error->errorInfo[1]??0);if(!in_array($driverCode,$safeDuplicateErrors,true))throw$error;}
 }
 fwrite(STDOUT,'Migration '.basename($file)." diterapkan.\n");
}
fwrite(STDOUT,"Schema CBT berhasil diterapkan.\n");
