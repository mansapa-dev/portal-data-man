<?php
declare(strict_types=1);
require dirname(__DIR__).'/app/src/Identity.php';
require dirname(__DIR__).'/app/src/PortalClient.php';
$count=0;
function check(bool $ok,string $message): void { global $count; if(!$ok) throw new RuntimeException('FAIL: '.$message); $count++; echo "PASS $message\n"; }
function rejects(callable $fn,string $message): void { try { $fn(); } catch(Throwable $e) { check(true,$message); return; } check(false,$message); }
function freshIdentity(): \Sipintar\Identity {
    $db=new PDO('sqlite::memory:',null,null,[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION]);
    $db->exec('PRAGMA foreign_keys=ON');
    $db->exec(str_replace('PRIMARY KEY AUTO_INCREMENT','PRIMARY KEY AUTOINCREMENT',file_get_contents(dirname(__DIR__).'/database/identity.sql')));
    return new \Sipintar\Identity($db);
}
$i=freshIdentity(); $other=freshIdentity();
$app=\Sipintar\Identity::APP;
$create=$app==='sipintar'?'transactions.create':'borrowings.create';
$read=$app==='sipintar'?'transactions.read':'borrowings.read';
$manage=$app==='sipintar'?'inventory.manage':'borrowings.manage';
$foreign=$app==='sipintar'?'multimedia':'sipintar';
$source=[['id'=>'portal-1','name'=>'Pegawai Portal','nip'=>'123'],['id'=>'portal-2','name'=>'Pegawai Kedua','nip'=>null]];
foreach([$i,$other] as $instance) {
    $instance->query('INSERT INTO accounts (username,password_hash,name,superadmin_slot) VALUES (?,?,?,1)',['admin',password_hash('Testing-admin-password',PASSWORD_DEFAULT),'Admin']);
    \Sipintar\PortalClient::sync($instance,$source);
    $instance->saveRole('pegawai',[$create]);
    $instance->saveRole('pemantau',[$read]);
}
check($i->user(1)!==null && $other->user(1)!==null,'each independent database has its own superadmin');
rejects(fn()=>$i->query("INSERT INTO accounts (username,password_hash,name,superadmin_slot) VALUES ('second','x','Second',1)"),'second superadmin in same project rejected');
rejects(fn()=>$i->query("INSERT INTO accounts (username,password_hash,name,superadmin_slot) VALUES ('invalid','x','Invalid',2)"),'alternate superadmin slot rejected');
$input=['username'=>'pegawai','password'=>'Testing-employee-password','employee_id'=>'portal-1','active'=>1,'role_id'=>1];
$i->saveAccount($input);
$other->saveAccount([...$input,'password'=>'Different-project-password','role_id'=>2]);
$u=$i->login('pegawai','Testing-employee-password','test');
check($u!==null,'local employee login uses password hash');
check($other->login('pegawai','Testing-employee-password','test')===null,'same portal employee may have separate credentials');
check($i->allows($u,$app,$create),'pegawai has local create permission');
check(!$i->allows($u,$app,$manage),'pegawai cannot manage data');
check(!$i->allows(null,$app,$read),'anonymous access denied');
check(!$i->allows($i->user(1),$foreign,$create),'even local superadmin cannot authorize a different project');
rejects(fn()=>$i->saveRole('foreign',[$app==='sipintar'?'borrowings.read':'inventory.read']),'role rejects permissions from other project');
$i->saveRole('pegawai',[],1);
check(!$i->allows($u,$app,$create),'role edits revoke access on existing identity');
check($other->allows($other->user(2),$app,$read),'role edits leave independent database unchanged');
rejects(fn()=>$i->saveAccount([...$input,'id'=>1]),'account form cannot change superadmin');
rejects(fn()=>$i->saveAccount([...$input,'username'=>'duplicate']),'one account per portal employee per project');
$i->saveAccount([...$input,'id'=>2,'role_id'=>0]);
check(!$i->allows($i->user(2),$app,$create),'no role revokes local application access');
rejects(fn()=>\Sipintar\PortalClient::sync($i,[]),'empty portal snapshot preserves local cache');
check((int)$i->query('SELECT COUNT(*) FROM employees WHERE active=1')->fetchColumn()===2,'cached employees preserved after rejected sync');
\Sipintar\PortalClient::sync($i,[$source[1]]);
check($i->user(2)===null,'inactive portal employee loses local session access');
check($other->user(2)!==null,'sync only updates the target project cache');
check($i->user(1)!==null,'local superadmin remains available when employee is inactive');
for($n=0;$n<5;$n++) $i->login('admin','wrong','limited');
rejects(fn()=>$i->login('admin','Testing-admin-password','limited'),'login throttles repeated failures');
check($i->login('admin','admin123','other')===null,'legacy universal password rejected');

$socket=getenv('SIPINTAR_TEST_SOCKET');
if($socket) {
    mysqli_report(MYSQLI_REPORT_ERROR|MYSQLI_REPORT_STRICT);
    $m=new mysqli('localhost','root','','',0,$socket);
    $name='sipintar_test_'.bin2hex(random_bytes(4)); $m->query("CREATE DATABASE `$name`"); $m->select_db($name);
    try {
        $pdo=new PDO('mysql:unix_socket='.$socket.';dbname='.$name,'root','',[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION]);
        $pdo->exec(file_get_contents(dirname(__DIR__).'/database/identity.sql'));
        $pdo->exec(file_get_contents(dirname(__DIR__).'/database/schema.sql'));
        $pdo->exec("INSERT INTO accounts (username,password_hash,name,superadmin_slot) VALUES ('admin','hash','Admin',1)");
        rejects(fn()=>$pdo->exec("INSERT INTO accounts (username,password_hash,name,superadmin_slot) VALUES ('second','hash','Admin',1)"),'MySQL singleton constraint is local');
        require dirname(__DIR__).'/app/src/Borrowings.php';
        $r=new \Sipintar\Database($m);
        $b=new \Sipintar\Borrowings($r);
        $loan=['borrowDate'=>'2026-09-13','expectedReturnDate'=>'2026-09-14','itemName'=>'Projector','itemQty'=>1,'borrowPurpose'=>'Class','borrowerType'=>'Guru'];
        $id=$b->save($loan,['name'=>"O'Neil",'nip'=>'42']);
        check($r->query('SELECT name FROM borrowings WHERE id=?',[$id])->get_result()->fetch_row()[0]==="O'Neil",'borrowing uses prepared statements');
        $b->returned($id,1); check((int)$r->query('SELECT returned FROM borrowings WHERE id=?',[$id])->get_result()->fetch_row()[0]===1,'borrowing return updates status');
        rejects(fn()=>$b->save([...$loan,'itemQty'=>-1],['name'=>'X','nip'=>null]),'borrowing negative quantity rejected');
        rejects(fn()=>$b->save([...$loan,'expectedReturnDate'=>'2026-09-12'],['name'=>'X','nip'=>null]),'return before borrowing date rejected');
    } finally { $m->query("DROP DATABASE `$name`"); }
}
echo "$count checks passed for $app.\n";
