<?php
header('Content-Type: application/json');
error_reporting(0);

$host = 'localhost';
$user = 'root';
$pass = '';
$db   = 'sipintar_db';

$conn = new mysqli($host, $user, $pass, $db);

if ($conn->connect_error) {
    echo json_encode(['success' => false, 'message' => 'Koneksi database gagal: ' . $conn->connect_error]);
    exit;
}

// 0. AUTO-CREATE TABEL MASTER BARANG, TRANSAKSI, & DETAIL
$conn->query("CREATE TABLE IF NOT EXISTS barang (
    id INT AUTO_INCREMENT PRIMARY KEY,
    nama_barang VARCHAR(150) NOT NULL,
    jenis_barang VARCHAR(100) NOT NULL,
    stok INT NOT NULL DEFAULT 0,
    satuan VARCHAR(50) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)");

$conn->query("CREATE TABLE IF NOT EXISTS transaksi (
    id INT AUTO_INCREMENT PRIMARY KEY,
    kode_transaksi VARCHAR(50) UNIQUE NOT NULL,
    tanggal_pengambilan DATE NOT NULL,
    nama_pengambil VARCHAR(100) NOT NULL,
    jabatan_unit VARCHAR(100) NOT NULL,
    keterangan TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)");

$conn->query("CREATE TABLE IF NOT EXISTS transaksi_detail (
    id INT AUTO_INCREMENT PRIMARY KEY,
    kode_transaksi VARCHAR(50) NOT NULL,
    nama_barang VARCHAR(150) NOT NULL,
    jumlah INT NOT NULL,
    satuan VARCHAR(50) NOT NULL,
    FOREIGN KEY (kode_transaksi) REFERENCES transaksi(kode_transaksi) ON DELETE CASCADE
)");

$action = $_GET['action'] ?? '';

// 1. LOGIN
if ($action === 'login') {
    $input = json_decode(file_get_contents('php://input'), true);
    $username = $conn->real_escape_string($input['username'] ?? '');
    $password = $conn->real_escape_string($input['password'] ?? '');

    $sql = "SELECT * FROM users WHERE username = '$username' AND password = '$password'";
    $res = $conn->query($sql);

    if ($res && $res->num_rows > 0) {
        $row = $res->fetch_assoc();
        echo json_encode([
            'success'  => true,
            'id'       => (string)$row['id'],
            'nama'     => $row['nama_lengkap'],
            'username' => $row['username'],
            'role'     => strtolower($row['role'] ?? 'pegawai')
        ]);
        exit;
    }
    
    echo json_encode(['success' => false, 'message' => 'Username atau password salah!']);
    exit;
}

// 2. KELOLA MASTER BARANG (GET, SAVE, SAVE BATCH TEMPLATE, HAPUS)
if ($action === 'get_barang') {
    $res = $conn->query("SELECT * FROM barang ORDER BY nama_barang ASC");
    $data = [];
    if ($res) {
        while ($row = $res->fetch_assoc()) {
            $data[] = $row;
        }
    }
    echo json_encode(['success' => true, 'data' => $data]);
    exit;
}

if ($action === 'save_barang') {
    $input = json_decode(file_get_contents('php://input'), true);
    $id    = (int)($input['id'] ?? 0);
    $nama  = $conn->real_escape_string($input['nama_barang'] ?? '');
    $jenis = $conn->real_escape_string($input['jenis_barang'] ?? '');
    $stok  = (int)($input['stok'] ?? 0);
    $satuan= $conn->real_escape_string($input['satuan'] ?? '');

    if ($id > 0) {
        $sql = "UPDATE barang SET nama_barang='$nama', jenis_barang='$jenis', stok=$stok, satuan='$satuan' WHERE id=$id";
    } else {
        $sql = "INSERT INTO barang (nama_barang, jenis_barang, stok, satuan) VALUES ('$nama', '$jenis', $stok, '$satuan')";
    }

    if ($conn->query($sql)) {
        echo json_encode(['success' => true, 'message' => 'Data barang berhasil disimpan!']);
    } else {
        echo json_encode(['success' => false, 'message' => 'Gagal menyimpan barang: ' . $conn->error]);
    }
    exit;
}

// SIMPAN BATCH DARI TEMPLATE
if ($action === 'save_template_barang') {
    $input = json_decode(file_get_contents('php://input'), true);
    $items = $input['items'] ?? [];

    if (empty($items)) {
        echo json_encode(['success' => false, 'message' => 'Tidak ada data template yang dikirim!']);
        exit;
    }

    $conn->begin_transaction();
    try {
        foreach ($items as $item) {
            $nama  = $conn->real_escape_string($item['nama_barang'] ?? '');
            $jenis = $conn->real_escape_string($item['jenis_barang'] ?? '');
            $stok  = (int)($item['stok'] ?? 0);
            $satuan= $conn->real_escape_string($item['satuan'] ?? '');

            $check = $conn->query("SELECT id, stok FROM barang WHERE nama_barang = '$nama'");
            if ($check && $check->num_rows > 0) {
                $row = $check->fetch_assoc();
                $newStok = $row['stok'] + $stok;
                $conn->query("UPDATE barang SET stok = $newStok, jenis_barang = '$jenis', satuan = '$satuan' WHERE id = " . $row['id']);
            } else {
                $conn->query("INSERT INTO barang (nama_barang, jenis_barang, stok, satuan) VALUES ('$nama', '$jenis', $stok, '$satuan')");
            }
        }
        $conn->commit();
        echo json_encode(['success' => true, 'message' => 'Template barang berhasil ditambahkan ke Master Data!']);
    } catch (Exception $e) {
        $conn->rollback();
        echo json_encode(['success' => false, 'message' => 'Gagal memproses template: ' . $e->getMessage()]);
    }
    exit;
}

if ($action === 'hapus_barang') {
    $input = json_decode(file_get_contents('php://input'), true);
    $id = (int)($input['id'] ?? 0);
    if ($conn->query("DELETE FROM barang WHERE id = $id")) {
        echo json_encode(['success' => true, 'message' => 'Barang berhasil dihapus!']);
    } else {
        echo json_encode(['success' => false, 'message' => 'Gagal menghapus barang: ' . $conn->error]);
    }
    exit;
}

// 3. SIMPAN TRANSAKSI PENERIMAAN BARANG
if ($action === 'simpan_transaksi') {
    $input = json_decode(file_get_contents('php://input'), true);

    $kode     = $conn->real_escape_string($input['kode_transaksi'] ?? '');
    $tanggal  = $conn->real_escape_string($input['tanggal_pengambilan'] ?? '');
    $pengambil= $conn->real_escape_string($input['nama_pengambil'] ?? '');
    $jabatan  = $conn->real_escape_string($input['jabatan_unit'] ?? '');
    $ket      = $conn->real_escape_string($input['keterangan'] ?? '');
    $items    = $input['items'] ?? [];

    if (empty($kode) || empty($tanggal) || empty($pengambil) || empty($items)) {
        echo json_encode(['success' => false, 'message' => 'Data formulir tidak lengkap!']);
        exit;
    }

    $conn->begin_transaction();

    try {
        $sqlHead = "INSERT INTO transaksi (kode_transaksi, tanggal_pengambilan, nama_pengambil, jabatan_unit, keterangan) 
                    VALUES ('$kode', '$tanggal', '$pengambil', '$jabatan', '$ket')";
        if (!$conn->query($sqlHead)) {
            throw new Exception($conn->error);
        }

        foreach ($items as $item) {
            $namaBrg = $conn->real_escape_string($item['nama_barang'] ?? '');
            $jml     = (int)($item['jumlah'] ?? 1);
            $satuan  = $conn->real_escape_string($item['satuan'] ?? '');

            $sqlDet = "INSERT INTO transaksi_detail (kode_transaksi, nama_barang, jumlah, satuan) 
                       VALUES ('$kode', '$namaBrg', $jml, '$satuan')";
            if (!$conn->query($sqlDet)) {
                throw new Exception($conn->error);
            }

            $conn->query("UPDATE barang SET stok = stok - $jml WHERE nama_barang = '$namaBrg'");
        }

        $conn->commit();
        echo json_encode(['success' => true, 'message' => 'Transaksi penerimaan berhasil disimpan!']);
    } catch (Exception $e) {
        $conn->rollback();
        echo json_encode(['success' => false, 'message' => 'Gagal menyimpan transaksi: ' . $e->getMessage()]);
    }
    exit;
}

// 4. GET / AMBIL SEMUA DATA TRANSAKSI
if ($action === 'get_transaksi') {
    $sqlHeader = "SELECT * FROM transaksi ORDER BY tanggal_pengambilan DESC, id DESC";
    $resHeader = $conn->query($sqlHeader);

    $data = [];
    if ($resHeader) {
        while ($head = $resHeader->fetch_assoc()) {
            $kode = $conn->real_escape_string($head['kode_transaksi']);
            
            $sqlDetail = "SELECT nama_barang, jumlah, satuan FROM transaksi_detail WHERE kode_transaksi = '$kode'";
            $resDetail = $conn->query($sqlDetail);
            
            $items = [];
            if ($resDetail && $resDetail->num_rows > 0) {
                while ($det = $resDetail->fetch_assoc()) {
                    $items[] = [
                        'nama_barang' => $det['nama_barang'],
                        'jumlah'      => $det['jumlah'],
                        'satuan'      => $det['satuan']
                    ];
                }
            }
            
            $head['items'] = $items;
            $data[] = $head;
        }
    }

    echo json_encode(['success' => true, 'data' => $data]);
    exit;
}

// 5. HAPUS TRANSAKSI TERFILTER
if ($action === 'hapus_transaksi') {
    $input = json_decode(file_get_contents('php://input'), true);
    $kodes = $input['kodes'] ?? [];

    if (empty($kodes)) {
        echo json_encode(['success' => false, 'message' => 'Tidak ada data yang dipilih untuk dihapus.']);
        exit;
    }

    $escapedKodes = array_map(function($k) use ($conn) {
        return "'" . $conn->real_escape_string($k) . "'";
    }, $kodes);

    $strKodes = implode(',', $escapedKodes);
    $sql = "DELETE FROM transaksi WHERE kode_transaksi IN ($strKodes)";

    if ($conn->query($sql)) {
        echo json_encode(['success' => true, 'message' => 'Data transaksi terpilih berhasil dihapus!']);
    } else {
        echo json_encode(['success' => false, 'message' => 'Gagal menghapus transaksi: ' . $conn->error]);
    }
    exit;
}

// 6. GET PETUGAS
if ($action === 'get_petugas') {
    $sql = "SELECT id, nama_lengkap, username, role FROM users ORDER BY id ASC";
    $res = $conn->query($sql);
    $data = [];
    if ($res) {
        while ($row = $res->fetch_assoc()) {
            $row['id'] = (string)$row['id'];
            $row['role'] = strtolower($row['role'] ?? 'pegawai');
            $data[] = $row;
        }
    }
    echo json_encode(['success' => true, 'data' => $data]);
    exit;
}

// 7. EDIT / SAVE PETUGAS
if ($action === 'save_petugas') {
    $input = json_decode(file_get_contents('php://input'), true);
    
    $currentUserId   = (string)($input['current_user_id'] ?? '');
    $currentUserRole = strtolower($input['current_user_role'] ?? 'pegawai');

    $id    = (int)($input['id'] ?? 0);
    $nama  = $conn->real_escape_string($input['nama_lengkap'] ?? '');
    $user  = $conn->real_escape_string($input['username'] ?? '');
    $pass  = $conn->real_escape_string($input['password'] ?? '');
    $role  = $conn->real_escape_string($input['role'] ?? 'pegawai');

    if ($currentUserRole !== 'admin' && (string)$id !== $currentUserId) {
        echo json_encode(['success' => false, 'message' => 'Ditolak: Anda hanya boleh mengedit akun sendiri!']);
        exit;
    }

    if ($id > 0) {
        if ($currentUserRole === 'admin') {
            if (!empty($pass)) {
                $sql = "UPDATE users SET nama_lengkap='$nama', username='$user', password='$pass', role='$role' WHERE id=$id";
            } else {
                $sql = "UPDATE users SET nama_lengkap='$nama', username='$user', role='$role' WHERE id=$id";
            }
        } else {
            if (!empty($pass)) {
                $sql = "UPDATE users SET nama_lengkap='$nama', username='$user', password='$pass' WHERE id=$id";
            } else {
                $sql = "UPDATE users SET nama_lengkap='$nama', username='$user' WHERE id=$id";
            }
        }
    } else {
        $sql = "INSERT INTO users (nama_lengkap, username, password, role) VALUES ('$nama', '$user', '$pass', '$role')";
    }

    if ($conn->query($sql)) {
        echo json_encode(['success' => true, 'message' => 'Data akun berhasil disimpan!']);
    } else {
        echo json_encode(['success' => false, 'message' => 'Gagal menyimpan: ' . $conn->error]);
    }
    exit;
}

// 8. HAPUS PETUGAS
if ($action === 'hapus_petugas') {
    $input = json_decode(file_get_contents('php://input'), true);
    $id = (int)($input['id'] ?? 0);

    $sql = "DELETE FROM users WHERE id = $id";
    if ($conn->query($sql)) {
        echo json_encode(['success' => true, 'message' => 'Akun berhasil dihapus!']);
    } else {
        echo json_encode(['success' => false, 'message' => 'Gagal menghapus: ' . $conn->error]);
    }
    exit;
}
?>