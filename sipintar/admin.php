<?php
require __DIR__.'/app/bootstrap.php';
$identity = sip_identity(); $message = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    sip_check_csrf();
    try {
        if (($_POST['action'] ?? '') === 'login') {
            if (!sip_login($_POST['username'] ?? '', $_POST['password'] ?? '')) $message = 'Username atau password salah.';
        } else {
            $user = sip_user();
            if (!$user || (int)$user['superadmin_slot'] !== 1) sip_fail(403,'Hanya superadmin yang dapat mengatur akses.');
            switch ($_POST['action'] ?? '') {
                case 'logout': sip_logout(); break;
                case 'role': $identity->saveRole(trim($_POST['name'] ?? ''),$_POST['permissions'] ?? [],(int)($_POST['id'] ?? 0)); $message='Role disimpan.'; break;
                case 'account': $identity->saveAccount($_POST); $message='Akun dan akses disimpan.'; break;
                case 'sync': $rows=(new \Sipintar\PortalClient(sip_config()['portal']))->employees(); $message=\Sipintar\PortalClient::sync($identity,$rows).' pegawai disinkronkan.'; break;
            }
        }
    } catch (RuntimeException $e) { $message = $e instanceof PDOException ? 'Gagal menyimpan. Periksa username, pegawai, atau role yang sudah dipakai.' : $e->getMessage(); }
}
$user = sip_user();
if ($user && (int)$user['superadmin_slot'] !== 1) sip_fail(403,'Panel ini hanya untuk superadmin.');
function csrf_field(): void { echo '<input type="hidden" name="_csrf" value="'.sip_e(sip_csrf()).'">'; }
?>
<!doctype html><html lang="id"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Pengaturan SIPINTAR</title>
<style>body{font:16px system-ui;background:#f1f5f9;color:#18352c;max-width:1100px;margin:32px auto;padding:16px}section{background:white;border:1px solid #d5e3de;border-radius:12px;padding:20px;margin:16px 0}input,select,button{font:inherit;padding:8px;margin:5px;max-width:95%}label{display:inline-block;margin:6px}button{background:#176348;color:white;border:0;border-radius:6px;cursor:pointer}table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:10px;border-bottom:1px solid #ddd}.scroll{overflow:auto}a{color:#176348}</style>
<h1>Pengaturan SIPINTAR</h1><p>Akun dan role khusus SIPINTAR. Data pegawai bersumber dari Portal Data.</p>
<nav><a href="index.php">Kembali ke aplikasi</a></nav>
<?php if ($message): ?><p role="status"><?= sip_e($message) ?></p><?php endif ?>
<?php if (!$user): ?><section><h2>Masuk sebagai superadmin</h2><form method="post"><?php csrf_field() ?><input type="hidden" name="action" value="login"><label>Username <input name="username" required autocomplete="username"></label><label>Password <input name="password" type="password" required autocomplete="current-password"></label><button>Masuk</button></form></section>
<?php else:
$roles=$identity->query('SELECT * FROM roles ORDER BY name')->fetchAll(PDO::FETCH_ASSOC);
$q=trim($_GET['q'] ?? ''); $page=max(1,(int)($_GET['page'] ?? 1)); $offset=($page-1)*50;
$accounts=$identity->query('SELECT a.*,e.name employee_name FROM accounts a LEFT JOIN employees e ON e.public_id=a.employee_id WHERE a.username LIKE ? OR e.name LIKE ? ORDER BY a.id LIMIT 51 OFFSET '.$offset,['%'.$q.'%','%'.$q.'%'])->fetchAll(PDO::FETCH_ASSOC);
$edit=$identity->query('SELECT * FROM accounts WHERE id=? AND superadmin_slot IS NULL',[(int)($_GET['edit'] ?? 0)])->fetch(PDO::FETCH_ASSOC) ?: [];
$assignedRole=$edit ? (int)$identity->query('SELECT role_id FROM grants WHERE account_id=?',[$edit['id']])->fetchColumn() : 0;
$editRole=$identity->query('SELECT * FROM roles WHERE id=?',[(int)($_GET['role'] ?? 0)])->fetch(PDO::FETCH_ASSOC) ?: [];
?>
<section><form method="post"><?php csrf_field() ?><button name="action" value="sync">Sinkronkan pegawai dari Portal Data</button><button name="action" value="logout">Keluar</button></form><p>Sinkronisasi mengambil data guru aktif dari Portal Data. Pembuatan akun dan pemberian akses tetap diatur superadmin.</p></section>
<section><h2><?= $edit ? 'Edit akun' : 'Tambah akun pegawai' ?></h2><form method="post"><?php csrf_field() ?><input type="hidden" name="action" value="account"><input type="hidden" name="id" value="<?= sip_e($edit['id'] ?? 0) ?>"><label>Username <input name="username" required value="<?= sip_e($edit['username'] ?? '') ?>"></label><label>Pegawai <input id="employee-search" placeholder="Cari nama atau NIP" autocomplete="off"></label><select id="employee-choice" name="employee_id" required><?php if ($edit): ?><option value="<?= sip_e($edit['employee_id']) ?>"><?= sip_e($edit['name']) ?></option><?php endif ?></select><label>Password <input name="password" type="password" minlength="12" autocomplete="new-password" <?= $edit ? '' : 'required' ?>></label><small>Minimal 12 karakter; kosongkan saat edit untuk mempertahankan password.</small><br>
<label>Role proyek ini<select name="role_id"><option value="0">Tanpa akses</option><?php foreach ($roles as $role): ?><option value="<?= $role['id'] ?>" <?= $assignedRole===(int)$role['id'] ? 'selected' : '' ?>><?= sip_e($role['name']) ?></option><?php endforeach ?></select></label>
<label><input name="active" type="checkbox" value="1" <?= !$edit || $edit['active'] ? 'checked' : '' ?>>Akun aktif</label><button>Simpan akun</button></form></section>
<section><h2>Role dan izin</h2><p><?php foreach ($roles as $role): ?><a href="?role=<?= $role['id'] ?>"><?= sip_e($role['name']) ?></a> · <?php endforeach ?><a href="admin.php">Role baru</a></p><form method="post"><?php csrf_field() ?><input type="hidden" name="action" value="role"><input type="hidden" name="id" value="<?= sip_e($editRole['id'] ?? 0) ?>"><label>Nama role <input name="name" required value="<?= sip_e($editRole['name'] ?? '') ?>"></label><br><?php foreach (\Sipintar\Identity::PERMISSIONS as $permission): ?><label><input type="checkbox" name="permissions[]" value="<?= sip_e($permission) ?>" <?= in_array($permission,json_decode($editRole['permissions'] ?? '[]',true),true) ? 'checked' : '' ?>><?= sip_e(['inventory.read'=>'Lihat barang','inventory.manage'=>'Kelola barang','transactions.read'=>'Lihat laporan transaksi','transactions.create'=>'Buat transaksi','transactions.manage'=>'Edit/hapus transaksi','borrowings.read'=>'Lihat laporan peminjaman','borrowings.create'=>'Buat peminjaman','borrowings.manage'=>'Edit/kembalikan peminjaman'][$permission]) ?></label><?php endforeach ?><br><button>Simpan role</button></form></section>
<section><h2>Akun</h2><form><input name="q" value="<?= sip_e($q) ?>" placeholder="Cari akun atau pegawai"><button>Cari</button></form><div class="scroll"><table><tr><th>Username</th><th>Nama</th><th>Status</th><th>Aksi</th></tr><?php foreach (array_slice($accounts,0,50) as $a): ?><tr><td><?= sip_e($a['username']) ?></td><td><?= sip_e($a['employee_name'] ?? $a['name']) ?></td><td><?= $a['active'] ? 'Aktif' : 'Nonaktif' ?></td><td><?php if ($a['superadmin_slot']): ?>Superadmin<?php else: ?><a href="?edit=<?= $a['id'] ?>">Atur akses</a><?php endif ?></td></tr><?php endforeach ?></table></div><?php if ($page>1): ?><a href="?page=<?= $page-1 ?>&q=<?= urlencode($q) ?>">Sebelumnya</a><?php endif ?> <?php if(count($accounts)>50): ?><a href="?page=<?= $page+1 ?>&q=<?= urlencode($q) ?>">Berikutnya</a><?php endif ?></section>
<script>let timer, seq=0;document.getElementById('employee-search').addEventListener('input',e=>{clearTimeout(timer);const q=e.target.value,n=++seq;timer=setTimeout(async()=>{const r=await fetch('employees.php?q='+encodeURIComponent(q));const j=await r.json();if(n!==seq)return;const s=document.getElementById('employee-choice');s.replaceChildren(new Option('Pilih pegawai',''));for(const row of j.data||[])s.add(new Option(row.name+(row.nip?' — '+row.nip:''),row.public_id));},250)});</script>
<?php endif ?></html>
