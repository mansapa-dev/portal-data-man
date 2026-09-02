<?php
declare(strict_types=1);
namespace Cbt\Services;
use Cbt\Core\Database;
use Cbt\Integrations\PortalData\PortalDataClientInterface;
final class PortalDataSyncService
{
 public function __construct(private Database$db,private PortalDataClientInterface$portal){}
 public function sync(string$type,?int$actor):array
 {
  $type=strtoupper($type);if(!in_array($type,['STUDENTS','TEACHERS','CLASSES','ACADEMIC_YEARS','SEMESTERS'],true))throw new \InvalidArgumentException('Jenis sinkronisasi tidak valid.');
  $statement=$this->db->pdo()->prepare("INSERT INTO portal_sync_logs(sync_type,started_at,status,initiated_by) VALUES(:type,UTC_TIMESTAMP(3),'RUNNING',:actor)");$statement->execute(['type'=>$type,'actor'=>$actor]);$log=(int)$this->db->pdo()->lastInsertId();$summary=['total'=>0,'inserted'=>0,'updated'=>0,'unchanged'=>0,'failed'=>0];
  try{$firstErr=null;for($page=1;;$page++){$result=match($type){'STUDENTS'=>$this->portal->students($page,100),'TEACHERS'=>$this->portal->teachers($page,100),'CLASSES'=>$this->portal->classes($page,100),'ACADEMIC_YEARS'=>$this->portal->academicYears(),'SEMESTERS'=>$this->portal->semesters()};foreach($result['items']as$item){$summary['total']++;try{$changed=$this->upsert($type,$item);$summary[$changed]++;}catch(\Throwable$itemErr){$summary['failed']++;if($firstErr===null)$firstErr=$itemErr->getMessage();}}if(!$result['has_more'])break;}$status=$summary['failed']?'PARTIAL':'SUCCESS';if($status==='SUCCESS')$summary['deactivated']=$this->deactivateStale($type,$log);$this->finish($log,$status,$summary,$firstErr);if($status==='PARTIAL'&&$firstErr!==null)throw new \UnexpectedValueException("Sinkronisasi {$type} parsial ({$summary['failed']} gagal dari {$summary['total']}): {$firstErr}");return$summary+['status'=>$status];}catch(\Throwable$e){$this->finish($log,'FAILED',$summary,$e->getMessage());throw$e;}
 }
 public function status(int$limit=20):array
 {
  $limit=max(1,min($limit,100));
  $statement=$this->db->pdo()->prepare('SELECT id,sync_type,started_at,finished_at,status,total,inserted_count inserted,updated_count updated,unchanged_count unchanged,failed_count failed,error_summary FROM portal_sync_logs ORDER BY id DESC LIMIT :limit');
  $statement->bindValue('limit',$limit,\PDO::PARAM_INT);$statement->execute();return$statement->fetchAll();
 }
 private function upsert(string$type,array$d):string{return match($type){'STUDENTS'=>$this->student($d),'TEACHERS'=>$this->teacher($d),'CLASSES'=>$this->schoolClass($d),'ACADEMIC_YEARS'=>$this->academicYear($d),'SEMESTERS'=>$this->semester($d)};}
 private function student(array$d):string
 {
  $portal=(string)($d['id']??$d['student_id']??'');$nisn=trim((string)($d['nisn']??''));$name=trim((string)($d['name']??$d['nama']??''));if($portal===''||!preg_match('/^\d{8,20}$/',$nisn)||$name==='')throw new \UnexpectedValueException('Data siswa invalid.');
  $existing=$this->row('students','portal_student_id',$portal);$values=['portal'=>$portal,'portal_class'=>$d['class']['id']??$d['class_id']??null,'nisn'=>$nisn,'name'=>$name,'class'=>$d['class']['name']??$d['kelas']??$d['rombel']??null,'grade'=>$this->normalizeGrade($d['grade']??$d['tingkat']??null),'year'=>$d['academic_year']??$d['tahun_ajaran']??null,'active'=>(int)($d['is_active']??strtoupper((string)($d['status']??'ACTIVE'))==='ACTIVE')];
  if($existing&&$this->same($existing,['portal_class_id'=>$values['portal_class'],'nisn'=>$values['nisn'],'name_snapshot'=>$values['name'],'class_snapshot'=>$values['class'],'grade_snapshot'=>$values['grade'],'academic_year_snapshot'=>$values['year'],'is_active'=>$values['active']])){$this->touch('students',(int)$existing['id']);return'unchanged';}
  // Gunakan INSERT terpisah lalu UPDATE untuk menghindari ON DUPLICATE KEY yang menimpa record siswa berbeda saat NISN collision.
  if(!$existing){
   try{
    $sql='INSERT INTO students(portal_student_id,portal_class_id,nisn,name_snapshot,class_snapshot,grade_snapshot,academic_year_snapshot,is_active,last_synced_at) VALUES(:portal,:portal_class,:nisn,:name,:class,:grade,:year,:active,UTC_TIMESTAMP(3))';
    $this->db->pdo()->prepare($sql)->execute($values);
    return'inserted';
   }catch(\PDOException$e){
    // NISN collision: ada siswa lain dengan NISN yang sama — update berdasarkan portal_student_id saja.
    if((string)($e->getCode()??'')==='23000'||str_contains($e->getMessage(),'Duplicate')){
     $existing=$this->row('students','nisn',$nisn);
     // Jika portal_student_id di DB berbeda, ini data duplikat NISN di Portal — tidak timpa, lempar.
     if($existing&&(string)$existing['portal_student_id']!==$portal)throw new \UnexpectedValueException('NISN '.$nisn.' sudah terdaftar untuk siswa lain (portal_id='.$existing['portal_student_id'].').');
     // Jika sama (race condition), lanjutkan ke UPDATE di bawah.
     $existing=$existing??$this->row('students','portal_student_id',$portal);
    }else{throw$e;}
   }
  }
  $sql='UPDATE students SET portal_class_id=:portal_class,nisn=:nisn,name_snapshot=:name,class_snapshot=:class,grade_snapshot=:grade,academic_year_snapshot=:year,is_active=:active,last_synced_at=UTC_TIMESTAMP(3) WHERE portal_student_id=:portal';
  $this->db->pdo()->prepare($sql)->execute($values);
  return'updated';
 }
 private function teacher(array$d):string{
  $portal=(string)($d['id']??$d['teacher_id']??'');$name=trim((string)($d['name']??$d['nama']??''));if($portal===''||$name==='')throw new \UnexpectedValueException('Data guru invalid.');
  $existing=$this->row('teachers','portal_teacher_id',$portal);
  $v=['portal'=>$portal,'nip'=>$d['nip']??null,'nuptk'=>$d['nuptk']??null,'name'=>$name,'status'=>(($d['is_active']??true)?'ACTIVE':'INACTIVE')];
  if($existing&&$this->same($existing,['nip'=>$v['nip'],'nuptk'=>$v['nuptk'],'name_snapshot'=>$v['name'],'status'=>$v['status']])){$this->touch('teachers',(int)$existing['id']);return'unchanged';}
  // Gunakan INSERT terpisah lalu UPDATE untuk menghindari ON DUPLICATE KEY yang menimpa guru lain saat NIP/NUPTK collision.
  if(!$existing){
   try{
    $sql='INSERT INTO teachers(portal_teacher_id,nip,nuptk,name_snapshot,status,last_synced_at) VALUES(:portal,:nip,:nuptk,:name,:status,UTC_TIMESTAMP(3))';
    $this->db->pdo()->prepare($sql)->execute($v);
    return'inserted';
   }catch(\PDOException$e){
    // NIP atau NUPTK collision: ada guru lain dengan NIP/NUPTK yang sama.
    if((string)($e->getCode()??'')==='23000'||str_contains($e->getMessage(),'Duplicate')){
     // Temukan record yang conflict berdasarkan NIP/NUPTK dan verifikasi bukan guru yang sama.
     $byNip=$v['nip']?$this->row('teachers','nip',(string)$v['nip']):null;
     $byNuptk=$v['nuptk']?$this->row('teachers','nuptk',(string)$v['nuptk']):null;
     $conflict=$byNip??$byNuptk;
     if($conflict&&(string)$conflict['portal_teacher_id']!==$portal)throw new \UnexpectedValueException('NIP/NUPTK guru sudah terdaftar untuk guru lain (portal_id='.$conflict['portal_teacher_id'].').');
     $existing=$this->row('teachers','portal_teacher_id',$portal);
    }else{throw$e;}
   }
  }
  $sql='UPDATE teachers SET nip=:nip,nuptk=:nuptk,name_snapshot=:name,status=:status,last_synced_at=UTC_TIMESTAMP(3) WHERE portal_teacher_id=:portal';
  $this->db->pdo()->prepare($sql)->execute($v);
  return'updated';
 }
 private function schoolClass(array$d):string{$portal=(string)($d['id']??$d['class_id']??'');$name=trim((string)($d['name']??$d['nama']??''));if($portal===''||$name==='')throw new \UnexpectedValueException('Data kelas invalid.');$existing=$this->row('portal_classes','portal_class_id',$portal);$v=['portal'=>$portal,'code'=>$d['code']??$d['kode']??$name,'name'=>$name,'grade'=>$this->normalizeGrade($d['grade']??$d['tingkat']??null),'year'=>$d['academic_year']??$d['tahun_ajaran']??null];if($existing&&$this->same($existing,['code'=>$v['code'],'name'=>$v['name'],'grade'=>$v['grade'],'academic_year'=>$v['year'],'status'=>'ACTIVE'])){$this->touch('portal_classes',(int)$existing['id']);return'unchanged';}if(!$existing){try{$sql="INSERT INTO portal_classes(portal_class_id,code,name,grade,academic_year,status,last_synced_at) VALUES(:portal,:code,:name,:grade,:year,'ACTIVE',UTC_TIMESTAMP(3))";$this->db->pdo()->prepare($sql)->execute($v);return'inserted';}catch(\PDOException$e){if((string)($e->getCode()??'')==='23000'||str_contains($e->getMessage(),'Duplicate')){$existing=$this->row('portal_classes','portal_class_id',$portal);}else{throw$e;}}}$sql="UPDATE portal_classes SET code=:code,name=:name,grade=:grade,academic_year=:year,status='ACTIVE',last_synced_at=UTC_TIMESTAMP(3) WHERE portal_class_id=:portal";$this->db->pdo()->prepare($sql)->execute($v);return'updated';}
 private function academicYear(array$d):string{$portal=(string)($d['id']??'');$name=trim((string)($d['name']??''));if($portal===''||$name==='')throw new \UnexpectedValueException('Data tahun ajaran invalid.');$existing=$this->row('portal_academic_years','portal_academic_year_id',$portal)??$this->row('portal_academic_years','name',$name);$v=['portal'=>$portal,'name'=>$name,'active'=>(int)($d['is_active']??false)];if($existing&&$this->same($existing,['portal_academic_year_id'=>$portal,'name'=>$name,'is_active'=>$v['active']])){$this->touch('portal_academic_years',(int)$existing['id']);return'unchanged';}if(!$existing){try{$sql='INSERT INTO portal_academic_years(portal_academic_year_id,name,is_active,last_synced_at) VALUES(:portal,:name,:active,UTC_TIMESTAMP(3))';$this->db->pdo()->prepare($sql)->execute($v);return'inserted';}catch(\PDOException$e){if((string)($e->getCode()??'')==='23000'||str_contains($e->getMessage(),'Duplicate')){$existing=$this->row('portal_academic_years','name',$name);}else{throw$e;}}}$sql='UPDATE portal_academic_years SET portal_academic_year_id=:portal,name=:name,is_active=:active,last_synced_at=UTC_TIMESTAMP(3) WHERE id=:id';$this->db->pdo()->prepare($sql)->execute(['portal'=>$portal,'name'=>$name,'active'=>$v['active'],'id'=>(int)$existing['id']]);return'updated';}
 private function semester(array$d):string{$portal=(string)($d['id']??'');$yearId=(string)($d['academic_year_id']??'');$year=trim((string)($d['academic_year']??''));$type=strtoupper((string)($d['type']??''));if($portal===''||$yearId===''||$year===''||!in_array($type,['ODD','EVEN'],true))throw new \UnexpectedValueException('Data semester invalid.');$existing=$this->row('portal_semesters','portal_semester_id',$portal);$v=['portal'=>$portal,'year_id'=>$yearId,'type'=>$type,'year'=>$year,'active'=>(int)($d['is_active']??false)];if($existing&&$this->same($existing,['portal_academic_year_id'=>$yearId,'type'=>$type,'academic_year'=>$year,'is_active'=>$v['active']])){$this->touch('portal_semesters',(int)$existing['id']);return'unchanged';}if(!$existing){try{$sql='INSERT INTO portal_semesters(portal_semester_id,portal_academic_year_id,type,academic_year,is_active,last_synced_at) VALUES(:portal,:year_id,:type,:year,:active,UTC_TIMESTAMP(3))';$this->db->pdo()->prepare($sql)->execute($v);return'inserted';}catch(\PDOException$e){if((string)($e->getCode()??'')==='23000'||str_contains($e->getMessage(),'Duplicate')){$existing=$this->row('portal_semesters','portal_semester_id',$portal);if(!$existing){$stmt=$this->db->pdo()->prepare('SELECT * FROM portal_semesters WHERE portal_academic_year_id=:year_id AND type=:type LIMIT 1');$stmt->execute(['year_id'=>$yearId,'type'=>$type]);$existing=$stmt->fetch()?:null;}}else{throw$e;}}}$sql='UPDATE portal_semesters SET portal_academic_year_id=:year_id,type=:type,academic_year=:year,is_active=:active,last_synced_at=UTC_TIMESTAMP(3) WHERE id=:id';$this->db->pdo()->prepare($sql)->execute(['year_id'=>$yearId,'type'=>$type,'year'=>$year,'active'=>$v['active'],'id'=>(int)$existing['id']]);return'updated';}
 private function row(string$table,string$key,string$value):?array{$s=$this->db->pdo()->prepare("SELECT * FROM {$table} WHERE {$key}=:value LIMIT 1");$s->execute(['value'=>$value]);return$s->fetch()?:null;}
 private function same(array$row,array$values):bool{foreach($values as$k=>$v)if((string)($row[$k]??'')!==(string)($v??''))return false;return true;}
 private function touch(string$table,int$id):void{$this->db->pdo()->prepare("UPDATE {$table} SET last_synced_at=UTC_TIMESTAMP(3) WHERE id=:id")->execute(['id'=>$id]);}
 private function normalizeGrade(mixed$grade):?string{$value=strtoupper(trim((string)$grade));return match($value){'7','VII'=>'VII','8','VIII'=>'VIII','9','IX'=>'IX','10','X'=>'X','11','XI'=>'XI','12','XII'=>'XII',default=>$value!==''?$value:null};}
 private function deactivateStale(string$type,int$logId):int
 {
  [$table,$statusColumn,$inactiveValue]=match($type){'STUDENTS'=>['students','is_active',0],'TEACHERS'=>['teachers','status','INACTIVE'],'CLASSES'=>['portal_classes','status','INACTIVE'],'ACADEMIC_YEARS'=>['portal_academic_years','is_active',0],'SEMESTERS'=>['portal_semesters','is_active',0]};
  $sql="UPDATE {$table} SET {$statusColumn}=:inactive WHERE (last_synced_at IS NULL OR last_synced_at < (SELECT started_at FROM portal_sync_logs WHERE id=:log)) AND {$statusColumn}<>:inactive_check";
  $statement=$this->db->pdo()->prepare($sql);$statement->execute(['inactive'=>$inactiveValue,'inactive_check'=>$inactiveValue,'log'=>$logId]);return$statement->rowCount();
 }
 private function finish(int$id,string$status,array$s,?string$error):void{$q=$this->db->pdo()->prepare('UPDATE portal_sync_logs SET finished_at=UTC_TIMESTAMP(3),status=:status,total=:total,inserted_count=:inserted,updated_count=:updated,unchanged_count=:unchanged,failed_count=:failed,error_summary=:error WHERE id=:id');$q->execute(['id'=>$id,'status'=>$status,'total'=>(int)($s['total']??0),'inserted'=>(int)($s['inserted']??0),'updated'=>(int)($s['updated']??0),'unchanged'=>(int)($s['unchanged']??0),'failed'=>(int)($s['failed']??0),'error'=>$error]);}
}
