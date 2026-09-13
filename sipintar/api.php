<?php
require __DIR__.'/app/bootstrap.php';
require __DIR__.'/app/src/Inventory.php';
header('Content-Type: application/json; charset=utf-8');
$action=$_GET['action'] ?? '';
$input=json_decode(file_get_contents('php://input'),true) ?? [];
if (!is_array($input)) sip_fail(422,'Format permintaan tidak valid.');
try {
    if ($action==='login') {
        sip_check_csrf(); $user=sip_login($input['username'] ?? '',$input['password'] ?? '');
        if (!$user) sip_fail(401,'Username atau password salah.');
        echo json_encode(['success'=>true,'id'=>(string)$user['id'],'nama'=>$user['name'],'username'=>$user['username'],'role'=>$user['superadmin_slot']?'superadmin':'pegawai','permissions'=>array_values(array_filter(\Sipintar\Identity::PERMISSIONS,fn($p)=>sip_identity()->allows($user,'sipintar',$p))),'csrf'=>sip_csrf()]); exit;
    }
    if ($action==='logout') { sip_check_csrf(); sip_logout(); echo json_encode(['success'=>true]); exit; }
    $permissions=['get_barang'=>'inventory.read','save_barang'=>'inventory.manage','save_template_barang'=>'inventory.manage','hapus_barang'=>'inventory.manage','simpan_transaksi'=>'transactions.create','update_transaksi'=>'transactions.manage','get_transaksi'=>'transactions.read','hapus_transaksi'=>'transactions.manage'];
    if (!isset($permissions[$action])) sip_fail(404,'Action tidak ditemukan.');
    $user=sip_require('sipintar',$permissions[$action]);
    if (!str_starts_with($action,'get_')) sip_check_csrf();
    session_write_close();
    $db=sip_db('sipintar'); $repo=new \Sipintar\Inventory($db);
    switch($action) {
        case 'get_barang': $result=['data'=>$db->query('SELECT * FROM barang ORDER BY nama_barang')->fetch_all(MYSQLI_ASSOC)]; break;
        case 'get_transaksi': $result=$repo->transactions(max(1,(int)($_GET['page'] ?? 1)),min(200,max(1,(int)($_GET['per_page'] ?? 100)))); break;
        case 'save_barang':
            $id=(int)($input['id'] ?? 0); $stock=filter_var($input['stok'] ?? null,FILTER_VALIDATE_INT);
            if ($stock===false || $stock<0 || trim($input['nama_barang'] ?? '')==='' || trim($input['satuan'] ?? '')==='') throw new RuntimeException('Nama, satuan, dan stok nonnegatif diperlukan.');
            $values=[trim($input['nama_barang']),$input['jenis_barang'] ?? '',$stock,$input['satuan']];
            if ($repo->query('SELECT id FROM barang WHERE nama_barang=? AND id<>?',[$values[0],$id])->get_result()->num_rows) throw new RuntimeException('Nama barang sudah digunakan.');
            if ($id) {
                $old=$repo->query('SELECT nama_barang FROM barang WHERE id=?',[$id])->get_result()->fetch_assoc();
                if (!$old) throw new RuntimeException('Barang tidak ditemukan.');
                if ($old['nama_barang']!==$values[0] && $repo->query('SELECT id FROM transaksi_detail WHERE nama_barang=? LIMIT 1',[$old['nama_barang']])->get_result()->num_rows) throw new RuntimeException('Nama barang dengan riwayat transaksi tidak dapat diubah.');
                $repo->query('UPDATE barang SET nama_barang=?,jenis_barang=?,stok=?,satuan=? WHERE id=?',[...$values,$id]);
            } else $repo->query('INSERT INTO barang (nama_barang,jenis_barang,stok,satuan) VALUES (?,?,?,?)',$values);
            break;
        case 'save_template_barang':
            $items=$input['items'] ?? []; if (!$items || count($items)>200) throw new RuntimeException('Template harus berisi 1–200 barang.');
            $db->begin_transaction();
            try {
                foreach($items as $item) {
                    $name=trim($item['nama_barang'] ?? ''); $stock=filter_var($item['stok'] ?? null,FILTER_VALIDATE_INT);
                    if ($name==='' || $stock===false || $stock<0 || empty($item['satuan'])) throw new RuntimeException('Data template tidak valid.');
                    $existing=$repo->query('SELECT id FROM barang WHERE nama_barang=? FOR UPDATE',[$name])->get_result()->fetch_all(MYSQLI_ASSOC);
                    if(count($existing)>1) throw new RuntimeException('Nama barang duplikat.');
                    if($existing) $repo->query('UPDATE barang SET stok=stok+? WHERE id=?',[$stock,(int)$existing[0]['id']]);
                    else $repo->query('INSERT INTO barang (nama_barang,jenis_barang,stok,satuan) VALUES (?,?,?,?)',[$name,$item['jenis_barang'] ?? '',$stock,$item['satuan']]);
                }
                $db->commit();
            } catch(Throwable $e) { $db->rollback(); throw $e; } break;
        case 'hapus_barang':
            $id=(int)($input['id'] ?? 0);
            if($repo->query('SELECT d.id FROM transaksi_detail d JOIN barang b ON b.nama_barang=d.nama_barang WHERE b.id=? LIMIT 1',[$id])->get_result()->num_rows) throw new RuntimeException('Barang masih memiliki riwayat transaksi.');
            $repo->query('DELETE FROM barang WHERE id=?',[$id]); break;
        case 'simpan_transaksi':
        case 'update_transaksi':
            if ($action==='simpan_transaksi') {
                if (!sip_identity()->allows($user,'sipintar','transactions.manage')) $input['tipe']='KELUAR';
                $employeeId=$input['employee_id'] ?? $user['employee_id'];
                if (!sip_identity()->allows($user,'sipintar','transactions.manage')) $employeeId=$user['employee_id'];
                $employee=sip_identity()->query('SELECT name FROM employees WHERE public_id=? AND active=1',[$employeeId])->fetchColumn();
                $input['nama_pengambil']=$employee ?: $user['name'];
            }
            $repo->save($input,$action==='update_transaksi'); break;
        case 'hapus_transaksi': $repo->delete($input['kodes'] ?? []); break;
    }
    echo json_encode(['success'=>true,'message'=>'Data berhasil diproses.',...($result ?? [])]);
} catch (RuntimeException $e) { if ($e instanceof mysqli_sql_exception || $e instanceof PDOException) throw $e; sip_fail(422,$e->getMessage()); }
