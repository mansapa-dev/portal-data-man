<?php
if(PHP_SAPI!=='cli') exit;
require dirname(__DIR__).'/app/src/Inventory.php';
if(!preg_match('/^sipintar_test_[a-f0-9]{8}$/',$argv[1] ?? '')) exit(3);
mysqli_report(MYSQLI_REPORT_ERROR|MYSQLI_REPORT_STRICT);
$db=new mysqli('localhost','root','',$argv[1],0,getenv('SIPINTAR_TEST_SOCKET'));
try {
    (new \Sipintar\Inventory($db))->save(['kode_transaksi'=>$argv[2],'tipe'=>'KELUAR','tanggal_pengambilan'=>'2026-09-13','nama_pengambil'=>'Concurrent Employee','items'=>[['nama_barang'=>'Pen','jumlah'=>4]]],false);
} catch(RuntimeException $e) { if(str_contains($e->getMessage(),'Stok tidak cukup')) exit(2); throw $e; }
