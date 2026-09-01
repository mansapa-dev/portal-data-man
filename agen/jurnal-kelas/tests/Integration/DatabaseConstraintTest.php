<?php
namespace Tests\Integration;
use PDO;
use PHPUnit\Framework\TestCase;
final class DatabaseConstraintTest extends TestCase
{
    private function connection():PDO{$dsn=getenv('TEST_DB_DSN');if(!$dsn)$this->markTestSkipped('Set TEST_DB_DSN untuk menjalankan integration test pada database khusus.');return new PDO($dsn,getenv('TEST_DB_USERNAME')?:'',getenv('TEST_DB_PASSWORD')?:'',[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION]);}
    public function test_required_tables_exist():void{$pdo=$this->connection();foreach(['users','attendance_sessions','attendance_records','journals','journal_documentations','journal_revisions','audit_logs'] as $table){$q=$pdo->prepare('SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name=:table');$q->execute(['table'=>$table]);self::assertSame(1,(int)$q->fetchColumn(),"Tabel {$table} tidak ditemukan");}}
    public function test_attendance_student_unique_constraint_exists():void{$pdo=$this->connection();$q=$pdo->query("SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='attendance_records' AND index_name='uq_attendance_student' AND non_unique=0");self::assertSame(2,(int)$q->fetchColumn(),'Unique index harus memiliki dua kolom.');}
    public function test_audit_append_only_triggers_exist():void{$pdo=$this->connection();$q=$pdo->query("SELECT COUNT(*) FROM information_schema.triggers WHERE trigger_schema=DATABASE() AND trigger_name IN ('audit_logs_prevent_update','audit_logs_prevent_delete')");self::assertSame(2,(int)$q->fetchColumn());}
}
