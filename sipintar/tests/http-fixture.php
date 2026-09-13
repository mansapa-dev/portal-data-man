<?php
if(PHP_SAPI!=='cli') exit;
require dirname(__DIR__).'/app/src/Identity.php';
$name=getenv('SIPINTAR_TEST_DB'); $socket=getenv('SIPINTAR_TEST_SOCKET');
if(!preg_match('/^sipintar_http_[a-f0-9]{8}$/',$name ?: '') || !$socket) exit(1);
$db=new PDO('mysql:unix_socket='.$socket,'root','',[PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION]);
if(($argv[1] ?? '')==='clean') { $db->exec("DROP DATABASE IF EXISTS `$name`"); exit; }
if(($argv[1] ?? '')==='setup') {
    $db->exec("CREATE DATABASE `$name`"); $db->exec("USE `$name`");
    $db->exec(file_get_contents(dirname(__DIR__).'/database/schema.sql'));
    if(\Sipintar\Identity::APP==='sipintar') $db->exec("INSERT INTO barang (nama_barang,jenis_barang,stok,satuan) VALUES ('Pen','ATK',20,'pcs')");
    exit;
}
$db->exec("USE `$name`");
$i=new \Sipintar\Identity($db);
$i->query("INSERT INTO employees VALUES ('portal-1','Pegawai Satu','123',1),('portal-2','Pemantau Dua','456',1)");
foreach(['pegawai'=>'portal-1','pemantau'=>'portal-2'] as $username=>$employee) {
    $role=(int)$i->query('SELECT id FROM roles WHERE name=?',[$username])->fetchColumn();
    $i->saveAccount(['username'=>$username,'password'=>'Testing-password-123','employee_id'=>$employee,'active'=>1,'role_id'=>$role]);
}
