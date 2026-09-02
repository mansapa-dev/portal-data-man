<?php
declare(strict_types=1);
require dirname(__DIR__).'/bootstrap.php';
use Cbt\Support\{Id,SecretCipher};
$passed=0;$failed=0;
$test=function(string$name,callable$callback)use(&$passed,&$failed):void{try{$callback();echo"PASS {$name}\n";$passed++;}catch(Throwable$e){echo"FAIL {$name}: {$e->getMessage()}\n";$failed++;}};
$assert=function(bool$condition,string$message='Assertion failed'):void{if(!$condition)throw new RuntimeException($message);};
$test('ULID has stable safe format',function()use($assert){$id=Id::ulid();$assert((bool)preg_match('/^[0-9A-HJKMNP-TV-Z]{26}$/',$id));});
$test('Password hash never equals plaintext',function()use($assert){$plain='TeacherPassword#2026';$hash=password_hash($plain,defined('PASSWORD_ARGON2ID')?PASSWORD_ARGON2ID:PASSWORD_DEFAULT);$assert($hash!==$plain);$assert(password_verify($plain,$hash));$assert(!password_verify('wrong',$hash));});
$test('PIN encryption round trip',function()use($assert){putenv('APP_KEY=test-only-key-which-is-longer-than-32-characters');$_ENV['APP_KEY']='test-only-key-which-is-longer-than-32-characters';$cipher=new SecretCipher();$encrypted=$cipher->encrypt('012345');$assert($encrypted!=='012345');$assert($cipher->decrypt($encrypted)==='012345');});
$test('Schema protects NISN and answer/result uniqueness',function()use($assert){$schema=file_get_contents(dirname(__DIR__).'/database/schema.sql')?:'';$assert(str_contains($schema,'UNIQUE KEY uq_students_nisn (nisn)'));$assert(str_contains($schema,'UNIQUE KEY uq_answer_attempt_question (attempt_id,question_id)'));$assert(str_contains($schema,'UNIQUE KEY uq_results_attempt (attempt_id)'));$assert(!preg_match('/\bnomor_ujian\b/i',$schema));});
$test('Portal secret absent from browser JavaScript',function()use($assert){$files=new RecursiveIteratorIterator(new RecursiveDirectoryIterator(dirname(__DIR__).'/public/assets/js'));foreach($files as$file){if($file->getExtension()==='js')$assert(!str_contains((string)file_get_contents($file->getPathname()),'PORTAL_DATA_API_KEY'),'Portal API key referenced by browser asset');}});
echo"\n{$passed} passed, {$failed} failed.\n";exit($failed===0?0:1);
