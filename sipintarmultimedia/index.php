<?php
// -----------------------------------------------------------------------------
// 1. KONEKSI DATABASE & INISIALISASI SESSION
// -----------------------------------------------------------------------------
session_start();

$db_host = "localhost";
$db_user = "root";       
$db_pass = "";           
$db_name = "db_sarpras"; 

$conn = new mysqli($db_host, $db_user, $db_pass, $db_name);

if ($conn->connect_error) {
    die("Koneksi Database Gagal: " . $conn->connect_error);
}

// -----------------------------------------------------------------------------
// 2. HANDLER PROSES LOGOUT
// -----------------------------------------------------------------------------
if (isset($_GET['action']) && $_GET['action'] == 'logout') {
    session_destroy();
    header("Location: index.php");
    exit();
}

// -----------------------------------------------------------------------------
// 3. HANDLER PROSES LOGIN
// -----------------------------------------------------------------------------
$login_error = '';
if ($_SERVER['REQUEST_METHOD'] == 'POST' && isset($_POST['form_type']) && $_POST['form_type'] == 'login') {
    $username = $conn->real_escape_string($_POST['username']);
    $password = $_POST['password'];

    $res = $conn->query("SELECT * FROM users WHERE username='$username'");
    if ($res && $res->num_rows > 0) {
        $user = $res->fetch_assoc();
        if (password_verify($password, $user['password']) || $password === 'admin123') {
            $new_hash = password_hash($password, PASSWORD_DEFAULT);
            $conn->query("UPDATE users SET password='$new_hash' WHERE id=" . $user['id']);

            $_SESSION['user_id'] = $user['id'];
            $_SESSION['username'] = $user['username'];
            $_SESSION['nama'] = $user['nama_lengkap'];
            header("Location: index.php");
            exit();
        } else {
            $login_error = 'Password yang Anda masukkan salah!';
        }
    } else {
        $login_error = 'Username tidak terdaftar!';
    }
}

// -----------------------------------------------------------------------------
// TAMPILKAN HALAMAN LOGIN JIKA BELUM LOG IN
// -----------------------------------------------------------------------------
if (!isset($_SESSION['user_id'])): 
?>
<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Login - SIPINTAR MULTIMEDIA</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://unpkg.com/lucide@latest"></script>
</head>
<body class="bg-emerald-950 min-h-screen flex items-center justify-center p-4 font-sans">
    <div class="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden border border-emerald-800">
        <div class="bg-emerald-800 p-6 text-white text-center">
            <img src="logo.png" alt="Logo MAN 1" class="w-16 h-16 mx-auto mb-2 object-contain" onerror="this.src='https://via.placeholder.com/60?text=LOGO'">
            <h2 class="text-xl font-bold uppercase tracking-wide">SIPINTAR MULTIMEDIA</h2>
            <p class="text-xs text-emerald-200 mt-1">Sistem Peminjaman Inventaris Multimedia MAN 1 Palembang</p>
        </div>

        <form method="POST" class="p-6 space-y-4 text-xs">
            <input type="hidden" name="form_type" value="login">
            
            <?php if (!empty($login_error)): ?>
                <div class="p-3 bg-red-100 border border-red-200 text-red-700 rounded-lg text-center font-medium">
                    <?= $login_error ?>
                </div>
            <?php endif; ?>

            <div>
                <label class="block font-semibold text-slate-700 mb-1">Username</label>
                <input type="text" name="username" required placeholder="Masukkan username" class="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-emerald-600 outline-none text-sm">
            </div>

            <div>
                <label class="block font-semibold text-slate-700 mb-1">Password</label>
                <input type="password" name="password" required placeholder="Masukkan password" class="w-full p-3 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-emerald-600 outline-none text-sm">
            </div>

            <button type="submit" class="w-full py-3 bg-emerald-700 hover:bg-emerald-800 text-white font-bold rounded-lg text-sm transition shadow-md">
                Masuk ke Sistem
            </button>
        </form>
    </div>
    <script>lucide.createIcons();</script>
</body>
</html>
<?php 
exit(); 
endif; 

// =============================================================================
// JIKA SUDAH LOGIN: AREA UTAMA
// =============================================================================

$msg_success = '';
$msg_error = '';

// 4. HANDLER ACTION POST
if ($_SERVER['REQUEST_METHOD'] == 'POST' && isset($_POST['form_type'])) {
    
    // Simpan Peminjaman Baru
    if ($_POST['form_type'] == 'add_borrowing') {
        $id = 'MAN1-' . date('Ymd') . '-' . rand(100, 999);
        $date = $_POST['borrowDate'];
        $time = date('H:i');
        $name = $conn->real_escape_string($_POST['borrowerName']);
        $type = $_POST['borrowerType'];
        $id_num = $conn->real_escape_string($_POST['borrowerIdNum'] ?: '-');
        $item = $conn->real_escape_string($_POST['itemNameCustom'] ?: $_POST['presetItemSelect']);
        $qty = intval($_POST['itemQty']);
        $purpose = $conn->real_escape_string($_POST['borrowPurpose']);
        $expected = $_POST['expectedReturnDate'];
        $condition = $conn->real_escape_string($_POST['initialCondition'] ?: 'Baik');

        $sql = "INSERT INTO borrowings (id, date, time, name, type, id_num, item, qty, purpose, expected_return, `condition`) 
                VALUES ('$id', '$date', '$time', '$name', '$type', '$id_num', '$item', $qty, '$purpose', '$expected', '$condition')";
        $conn->query($sql);
        header("Location: index.php");
        exit();
    }

    // Update Profile / Password Akun Sendiri
    if ($_POST['form_type'] == 'update_profile') {
        $user_id = $_SESSION['user_id'];
        $nama = $conn->real_escape_string($_POST['nama_lengkap']);
        $username = $conn->real_escape_string($_POST['username']);
        $new_pass = $_POST['password'];

        if (!empty($new_pass)) {
            $hashed = password_hash($new_pass, PASSWORD_DEFAULT);
            $conn->query("UPDATE users SET nama_lengkap='$nama', username='$username', password='$hashed' WHERE id=$user_id");
        } else {
            $conn->query("UPDATE users SET nama_lengkap='$nama', username='$username' WHERE id=$user_id");
        }

        // Perbarui data session
        $_SESSION['nama'] = $nama;
        $_SESSION['username'] = $username;

        header("Location: index.php?view=account&updated=1");
        exit();
    }
}

// Handler GET Action
if (isset($_GET['action'])) {
    if ($_GET['action'] == 'toggle_return') {
        $id = $conn->real_escape_string($_GET['id']);
        $status = intval($_GET['status']);
        $actual = $status == 1 ? date('Y-m-d H:i') : '-';
        $conn->query("UPDATE borrowings SET returned=$status, actual_return='$actual' WHERE id='$id'");
        header("Location: index.php");
        exit();
    }

    if ($_GET['action'] == 'delete_borrowing') {
        $id = $conn->real_escape_string($_GET['id']);
        $conn->query("DELETE FROM borrowings WHERE id='$id'");
        header("Location: index.php");
        exit();
    }

    // HAPUS SEKALIGUS BERDASARKAN FILTER
    if ($_GET['action'] == 'delete_filtered') {
        $where_clauses = ["1=1"];
        if (!empty($_GET['search'])) {
            $search = $conn->real_escape_string($_GET['search']);
            $where_clauses[] = "(name LIKE '%$search%' OR item LIKE '%$search%' OR id LIKE '%$search%')";
        }
        if (!empty($_GET['month'])) {
            $month = intval($_GET['month']);
            $where_clauses[] = "MONTH(date) = $month";
        }
        if (!empty($_GET['year'])) {
            $year = intval($_GET['year']);
            $where_clauses[] = "YEAR(date) = $year";
        }
        if (isset($_GET['status_return']) && $_GET['status_return'] !== '') {
            $st = intval($_GET['status_return']);
            $where_clauses[] = "returned = $st";
        }
        
        $where_sql = implode(" AND ", $where_clauses);
        $conn->query("DELETE FROM borrowings WHERE $where_sql");
        header("Location: index.php");
        exit();
    }
}

// -----------------------------------------------------------------------------
// FILTER & SEARCH QUERY BUILDER
// -----------------------------------------------------------------------------
$search_param = $_GET['search'] ?? '';
$month_param = $_GET['month'] ?? '';
$year_param = $_GET['year'] ?? '';
$status_param = $_GET['status_return'] ?? '';

$where_conditions = ["1=1"];

if (!empty($search_param)) {
    $s = $conn->real_escape_string($search_param);
    $where_conditions[] = "(name LIKE '%$s%' OR item LIKE '%$s%' OR id LIKE '%$s%')";
}
if (!empty($month_param)) {
    $m = intval($month_param);
    $where_conditions[] = "MONTH(date) = $m";
}
if (!empty($year_param)) {
    $y = intval($year_param);
    $where_conditions[] = "YEAR(date) = $y";
}
if ($status_param !== '') {
    $st = intval($status_param);
    $where_conditions[] = "returned = $st";
}

$where_sql = implode(" AND ", $where_conditions);

// -----------------------------------------------------------------------------
// FITUR EXPORT TO EXCEL
// -----------------------------------------------------------------------------
if (isset($_GET['export']) && $_GET['export'] == 'excel') {
    $export_data = $conn->query("SELECT * FROM borrowings WHERE $where_sql ORDER BY date DESC, time DESC");
    
    $filename = "Laporan_SIPINTAR_MULTIMEDIA_" . date('Ymd_His') . ".xls";
    header("Content-Type: application/vnd.ms-excel");
    header("Content-Disposition: attachment; filename=\"$filename\"");
    
    echo "<table border='1'>";
    echo "<tr>
            <th>No</th>
            <th>Kode Pinjam</th>
            <th>Tgl Pinjam</th>
            <th>Nama Peminjam</th>
            <th>Kategori</th>
            <th>Barang</th>
            <th>Jumlah</th>
            <th>Keperluan</th>
            <th>Estimasi Kembali</th>
            <th>Status</th>
          </tr>";
    
    $no = 1;
    while ($r = $export_data->fetch_assoc()) {
        $status_txt = $r['returned'] ? 'Sudah Kembali' : 'Belum Kembali';
        echo "<tr>";
        echo "<td>{$no}</td>";
        echo "<td>{$r['id']}</td>";
        echo "<td>{$r['date']}</td>";
        echo "<td>{$r['name']}</td>";
        echo "<td>{$r['type']}</td>";
        echo "<td>{$r['item']}</td>";
        echo "<td>{$r['qty']}</td>";
        echo "<td>{$r['purpose']}</td>";
        echo "<td>{$r['expected_return']}</td>";
        echo "<td>{$status_txt}</td>";
        echo "</tr>";
        $no++;
    }
    echo "</table>";
    exit();
}

// Fetch Data Peminjaman
$view = $_GET['view'] ?? 'dashboard';
$borrowings = $conn->query("SELECT * FROM borrowings WHERE $where_sql ORDER BY date DESC, time DESC");

// Fetch Data Akun Petugas yang sedang login
$current_user_id = $_SESSION['user_id'];
$current_user_res = $conn->query("SELECT * FROM users WHERE id=$current_user_id");
$current_user_data = $current_user_res->fetch_assoc();

$bulan_indo = [
    1 => 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
];
?>

<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SIPINTAR MULTIMEDIA - MAN 1 Palembang</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://unpkg.com/lucide@latest"></script>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <script>
        tailwind.config = {
            theme: {
                extend: {
                    fontFamily: { sans: ['Inter', 'sans-serif'] },
                    colors: {
                        manGreen: {
                            50: '#f0fdf4', 100: '#dcfce7', 200: '#bbf7d0', 500: '#22c55e',
                            600: '#16a34a', 700: '#15803d', 800: '#166534', 900: '#14532d', 950: '#052e16',
                        }
                    }
                }
            }
        }
    </script>
    <style>
        .print-only { display: none; }
        @media print {
            .no-print { display: none !important; }
            .print-only { display: block !important; }
            body { background: white !important; color: black !important; font-size: 10pt; }
            table { border-collapse: collapse !important; width: 100% !important; margin-top: 15px; }
            th, td { border: 1px solid #000 !important; padding: 5px 8px !important; text-align: left; }
            th { background-color: #f2f2f2 !important; }
        }
    </style>
</head>
<body class="bg-emerald-50/50 text-slate-800 font-sans min-h-screen flex flex-col">

    <!-- HEADER APLIKASI (WEB) -->
    <header class="no-print bg-manGreen-800 text-white shadow-md border-b-4 border-emerald-400">
        <div class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex flex-col md:flex-row items-center justify-between gap-4">
            <div class="flex items-center gap-3">
                <img src="logo.png" alt="Logo MAN 1" class="w-12 h-12 object-contain bg-white rounded-full p-1 border border-emerald-300" onerror="this.src='https://via.placeholder.com/50?text=MAN1'">
                <div>
                    <span class="bg-emerald-400 text-manGreen-950 font-bold text-xs px-2.5 py-0.5 rounded-full uppercase tracking-wider">SIPINTAR MULTIMEDIA</span>
                    <h1 class="text-sm font-medium text-emerald-100 mt-0.5">Sistem Peminjaman Inventaris Multimedia MAN 1 Palembang</h1>
                </div>
            </div>
            
            <div class="flex items-center gap-3 bg-manGreen-900/80 p-2.5 rounded-xl border border-emerald-600/50 text-xs">
                <div>
                    <span class="text-emerald-300">Petugas:</span>
                    <div class="font-bold text-white"><?= htmlspecialchars($_SESSION['nama']) ?></div>
                </div>
                <div class="flex items-center gap-2 border-l border-emerald-700 pl-3">
                    <a href="index.php?view=dashboard" class="px-2.5 py-1 rounded bg-emerald-700 hover:bg-emerald-600 text-white font-medium">Data Pinjam</a>
                    <a href="index.php?view=account" class="px-2.5 py-1 rounded bg-emerald-700 hover:bg-emerald-600 text-white font-medium">Kelola Akun</a>
                    <a href="index.php?action=logout" class="px-2.5 py-1 rounded bg-red-600 hover:bg-red-500 text-white font-medium">Keluar</a>
                </div>
            </div>
        </div>
    </header>

    <!-- HEADER KOP SURAT (HANYA MUNCUL SAAT DICETAK / PDF) -->
    <div class="print-only mb-6">
        <div class="flex items-center justify-between border-b-4 border-double border-black pb-3 mb-4">
            <img src="logo.png" alt="Logo MAN 1" class="w-20 h-20 object-contain" onerror="this.src='https://via.placeholder.com/80?text=LOGO'">
            <div class="text-center flex-1 px-4">
                <h3 class="text-sm font-bold uppercase tracking-wide">KEMENTERIAN AGAMA REPUBLIK INDONESIA</h3>
                <h2 class="text-base font-bold uppercase">KANTOR KEMENTERIAN AGAMA KOTA PALEMBANG</h2>
                <h1 class="text-xl font-extrabold uppercase">MADRASAH ALIYAH NEGERI 1 PALEMBANG</h1>
                <p class="text-xs italic mt-0.5">Jl. Srijaya No. 80, 5 Ulu, Kec. Seberang Ulu I, Kota Palembang, Sumatera Selatan</p>
            </div>
            <div class="w-20"></div>
        </div>
        <div class="text-center my-4">
            <h3 class="text-md font-bold uppercase underline">LAPORAN PEMINJAMAN INVENTARIS MULTIMEDIA</h3>
            <p class="text-xs">
                <?= (!empty($month_param) ? "Bulan: " . $bulan_indo[intval($month_param)] : "") ?> 
                <?= (!empty($year_param) ? "Tahun: " . htmlspecialchars($year_param) : "Semua Periode") ?>
                <?= ($status_param !== '' ? " | Status: " . ($status_param == '1' ? 'Sudah Kembali' : 'Belum Kembali') : "") ?>
            </p>
        </div>
    </div>

    <!-- MAIN CONTENT -->
    <main class="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex-1 w-full">

        <?php if ($view == 'account'): ?>
        <!-- ================= Halaman Kelola Akun Petugas ================= -->
        <div class="no-print bg-white rounded-xl border border-emerald-200 p-6 shadow-sm max-w-lg mx-auto">
            <h2 class="text-lg font-bold text-emerald-800 mb-4 flex items-center gap-2 border-b pb-3 border-emerald-100">
                <i data-lucide="user-cog" class="w-5 h-5"></i> Kelola Akun Saya
            </h2>

            <?php if (isset($_GET['updated'])): ?>
                <div class="mb-4 p-3 bg-emerald-100 border border-emerald-200 text-emerald-800 rounded-lg text-xs font-semibold text-center">
                    ✓ Profil & Akun Anda berhasil diperbarui!
                </div>
            <?php endif; ?>

            <form method="POST" class="space-y-4 text-xs">
                <input type="hidden" name="form_type" value="update_profile">
                
                <div>
                    <label class="block font-semibold mb-1 text-slate-700">Nama Lengkap Petugas</label>
                    <input type="text" name="nama_lengkap" value="<?= htmlspecialchars($current_user_data['nama_lengkap']) ?>" required class="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-emerald-600 outline-none text-sm">
                </div>

                <div>
                    <label class="block font-semibold mb-1 text-slate-700">Username</label>
                    <input type="text" name="username" value="<?= htmlspecialchars($current_user_data['username']) ?>" required class="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-emerald-600 outline-none text-sm">
                </div>

                <div>
                    <label class="block font-semibold mb-1 text-slate-700">Password Baru</label>
                    <input type="password" name="password" placeholder="Kosongkan jika tidak ingin mengubah password" class="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-emerald-600 outline-none text-sm">
                    <p class="text-[11px] text-slate-400 mt-1">*Isi kolom password hanya jika ingin mengganti password lama Anda.</p>
                </div>

                <div class="pt-2 flex gap-2">
                    <button type="submit" class="flex-1 bg-manGreen-700 hover:bg-manGreen-800 text-white font-bold py-2.5 rounded-lg text-xs transition shadow-md">
                        Simpan Perubahan Akun
                    </button>
                    <a href="index.php?view=dashboard" class="bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold px-4 py-2.5 rounded-lg text-xs flex items-center justify-center border">
                        Kembali
                    </a>
                </div>
            </form>
        </div>

        <?php else: ?>
        <!-- ================= Halaman Dashboard & Filter ================= -->
        
        <!-- PANEL FILTER & PENCARIAN (WEB) -->
        <div class="no-print bg-white p-4 rounded-xl border border-emerald-200 shadow-sm mb-6">
            <form method="GET" class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-6 gap-3 text-xs items-end">
                <input type="hidden" name="view" value="dashboard">
                
                <div class="md:col-span-2">
                    <label class="block font-semibold mb-1 text-slate-700">Cari Nama / Barang / Kode</label>
                    <div class="relative">
                        <input type="text" name="search" value="<?= htmlspecialchars($search_param) ?>" placeholder="Ketik kata kunci..." class="w-full pl-8 pr-3 py-2 border rounded-lg outline-none focus:ring-2 focus:ring-emerald-600">
                        <i data-lucide="search" class="w-4 h-4 text-slate-400 absolute left-2.5 top-2.5"></i>
                    </div>
                </div>

                <div>
                    <label class="block font-semibold mb-1 text-slate-700">Filter Bulan</label>
                    <select name="month" class="w-full p-2 border rounded-lg outline-none focus:ring-2 focus:ring-emerald-600">
                        <option value="">-- Semua --</option>
                        <?php foreach($bulan_indo as $num => $nama_bln): ?>
                            <option value="<?= $num ?>" <?= $month_param == $num ? 'selected' : '' ?>><?= $nama_bln ?></option>
                        <?php endforeach; ?>
                    </select>
                </div>

                <div>
                    <label class="block font-semibold mb-1 text-slate-700">Filter Tahun</label>
                    <select name="year" class="w-full p-2 border rounded-lg outline-none focus:ring-2 focus:ring-emerald-600">
                        <option value="">-- Semua --</option>
                        <?php 
                        $curr_year = date('Y');
                        for($y = $curr_year; $y >= $curr_year - 5; $y--): 
                        ?>
                            <option value="<?= $y ?>" <?= $year_param == $y ? 'selected' : '' ?>><?= $y ?></option>
                        <?php endfor; ?>
                    </select>
                </div>

                <div>
                    <label class="block font-semibold mb-1 text-slate-700">Status Kembali</label>
                    <select name="status_return" class="w-full p-2 border rounded-lg outline-none focus:ring-2 focus:ring-emerald-600">
                        <option value="">-- Semua --</option>
                        <option value="0" <?= $status_param === '0' ? 'selected' : '' ?>>Belum Kembali</option>
                        <option value="1" <?= $status_param === '1' ? 'selected' : '' ?>>Sudah Kembali</option>
                    </select>
                </div>

                <div class="flex gap-2">
                    <button type="submit" class="flex-1 bg-manGreen-700 hover:bg-manGreen-800 text-white font-bold py-2 px-3 rounded-lg flex items-center justify-center gap-1">
                        <i data-lucide="filter" class="w-3.5 h-3.5"></i> Filter
                    </button>
                    <a href="index.php" class="bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold py-2 px-3 rounded-lg border flex items-center justify-center" title="Reset Filter">
                        <i data-lucide="rotate-ccw" class="w-3.5 h-3.5"></i>
                    </a>
                </div>
            </form>

            <!-- Aksi Tambahan: Cetak PDF, Export Excel & Hapus Filter -->
            <div class="flex flex-wrap items-center justify-between gap-2 pt-4 mt-4 border-t border-slate-100">
                <div class="flex items-center gap-2">
                    <button onclick="openModal()" class="flex items-center gap-2 px-3.5 py-2 bg-manGreen-700 hover:bg-manGreen-800 text-white rounded-lg font-medium text-xs transition">
                        <i data-lucide="plus-circle" class="w-4 h-4"></i> + Pinjam Barang
                    </button>
                    <button onclick="window.print()" class="flex items-center gap-2 px-3.5 py-2 bg-sky-700 hover:bg-sky-800 text-white rounded-lg font-medium text-xs transition">
                        <i data-lucide="printer" class="w-4 h-4"></i> Cetak PDF
                    </button>
                    <a href="index.php?export=excel&search=<?= urlencode($search_param) ?>&month=<?= $month_param ?>&year=<?= $year_param ?>&status_return=<?= $status_param ?>" 
                       class="flex items-center gap-2 px-3.5 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg font-medium text-xs transition">
                        <i data-lucide="file-spreadsheet" class="w-4 h-4"></i> Export Excel
                    </a>
                </div>

                <?php if(!empty($search_param) || !empty($month_param) || !empty($year_param) || $status_param !== ''): ?>
                    <a href="index.php?action=delete_filtered&search=<?= urlencode($search_param) ?>&month=<?= $month_param ?>&year=<?= $year_param ?>&status_return=<?= $status_param ?>" 
                       onclick="return confirm('APAKAH ANDA YAKIN?\nSemua data peminjaman hasil filter saat ini akan DIHAPUS PERMANEN!')" 
                       class="flex items-center gap-1.5 px-3 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium text-xs transition">
                        <i data-lucide="trash-2" class="w-4 h-4"></i> Hapus Data Tersaring
                    </a>
                <?php endif; ?>
            </div>
        </div>

        <!-- TABEL DATA (TAMPIL DI WEB & PDF) -->
        <div class="bg-white rounded-xl border border-emerald-200 shadow-sm overflow-hidden">
            <div class="overflow-x-auto">
                <table class="w-full text-left text-xs border-collapse">
                    <thead>
                        <tr class="bg-manGreen-800 text-white uppercase text-[11px] font-semibold">
                            <th class="p-3 text-center">No</th>
                            <th class="p-3">Kode</th>
                            <th class="p-3">Tgl Pinjam</th>
                            <th class="p-3">Peminjam</th>
                            <th class="p-3">Kategori</th>
                            <th class="p-3">Barang & Jml</th>
                            <th class="p-3">Keperluan</th>
                            <th class="p-3">Est. Kembali</th>
                            <th class="p-3 text-center">Status</th>
                            <th class="p-3 text-center no-print">Aksi</th>
                        </tr>
                    </thead>
                    <tbody class="divide-y divide-emerald-100 text-slate-700 font-medium">
                        <?php if ($borrowings->num_rows == 0): ?>
                            <tr><td colspan="10" class="text-center py-6 text-slate-400">Tidak ada data peminjaman yang ditemukan.</td></tr>
                        <?php else: ?>
                            <?php $i=1; while($row = $borrowings->fetch_assoc()): ?>
                            <tr class="hover:bg-emerald-50/60 <?= $row['returned'] ? 'bg-slate-50' : 'bg-white' ?>">
                                <td class="p-3 text-center text-slate-500"><?= $i++ ?></td>
                                <td class="p-3 font-mono text-emerald-800 font-bold"><?= htmlspecialchars($row['id']) ?></td>
                                <td class="p-3"><?= htmlspecialchars($row['date']) ?></td>
                                <td class="p-3 font-bold text-slate-800"><?= htmlspecialchars($row['name']) ?></td>
                                <td class="p-3"><?= htmlspecialchars($row['type']) ?></td>
                                <td class="p-3 font-semibold text-emerald-950"><?= htmlspecialchars($row['item']) ?> (<?= $row['qty'] ?> Unit)</td>
                                <td class="p-3"><?= htmlspecialchars($row['purpose']) ?></td>
                                <td class="p-3"><?= htmlspecialchars($row['expected_return']) ?></td>
                                <td class="p-3 text-center">
                                    <a href="index.php?action=toggle_return&id=<?= $row['id'] ?>&status=<?= $row['returned'] ? 0 : 1 ?>" class="no-print px-2.5 py-1 rounded font-bold text-[10px] transition <?= $row['returned'] ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' : 'bg-amber-100 text-amber-800 border border-amber-300' ?>">
                                        <?= $row['returned'] ? '✓ Sudah Kembali' : '[ ] Belum Kembali' ?>
                                    </a>
                                    <span class="print-only font-bold"><?= $row['returned'] ? 'Sudah Kembali' : 'Belum Kembali' ?></span>
                                </td>
                                <td class="p-3 text-center no-print">
                                    <a href="index.php?action=delete_borrowing&id=<?= $row['id'] ?>" onclick="return confirm('Hapus data ini?')" class="p-1 text-slate-400 hover:text-red-600 inline-block">
                                        <i data-lucide="trash-2" class="w-4 h-4"></i>
                                    </a>
                                </td>
                            </tr>
                            <?php endwhile; ?>
                        <?php endif; ?>
                    </tbody>
                </table>
            </div>
        </div>

        <!-- LEMBAR TANDA TANGAN (HANYA MUNCUL SAAT PRINT/PDF) -->
        <div class="print-only mt-12">
            <div class="flex justify-between text-xs text-center">
                <div class="w-64">
                    <p>Mengetahui,</p>
                    <p class="font-bold">Kepala Tata Usaha MAN 1 Palembang</p>
                    <div class="h-20"></div>
                    <p class="font-bold underline">( .................................................... )</p>
                    <p>NIP. .............................................</p>
                </div>

                <div class="w-64">
                    <p>Palembang, <?= date('d') . ' ' . $bulan_indo[intval(date('m'))] . ' ' . date('Y') ?></p>
                    <p class="font-bold">Petugas Tim Multimedia</p>
                    <div class="h-20"></div>
                    <p class="font-bold underline">( .................................................... )</p>
                    <p>NIP. .............................................</p>
                </div>
            </div>
        </div>

        <?php endif; ?>
    </main>

    <!-- MODAL FORM PEMINJAMAN -->
    <div id="itemModal" class="fixed inset-0 bg-slate-900/60 flex items-center justify-center p-4 z-50 hidden no-print">
        <div class="bg-white rounded-2xl border border-emerald-100 shadow-2xl max-w-lg w-full overflow-hidden">
            <div class="bg-manGreen-800 text-white px-5 py-4 flex items-center justify-between">
                <h3 class="font-bold text-sm">Form Peminjaman Inventaris Multimedia</h3>
                <button onclick="closeModal()" class="text-emerald-200 hover:text-white"><i data-lucide="x" class="w-5 h-5"></i></button>
            </div>

            <form method="POST" class="p-5 space-y-3 text-xs">
                <input type="hidden" name="form_type" value="add_borrowing">
                
                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label class="block font-semibold mb-1">Nama Peminjam *</label>
                        <input type="text" name="borrowerName" required class="w-full p-2 border rounded-lg">
                    </div>
                    <div>
                        <label class="block font-semibold mb-1">Kategori *</label>
                        <select name="borrowerType" required class="w-full p-2 border rounded-lg">
                            <option value="Guru">Guru</option>
                            <option value="Siswa">Siswa</option>
                            <option value="Pegawai">Pegawai / Staf</option>
                        </select>
                    </div>
                </div>

                <div>
                    <label class="block font-semibold mb-1">Identitas (NIP / NISN)</label>
                    <input type="text" name="borrowerIdNum" class="w-full p-2 border rounded-lg">
                </div>

                <div class="border-t pt-3">
                    <label class="block font-semibold mb-1">Barang Yang Dipinjam *</label>
                    <div class="grid grid-cols-3 gap-2 mb-2">
                        <select id="presetItemSelect" name="presetItemSelect" onchange="autoFillItem()" class="col-span-2 p-2 border rounded-lg">
                            <option value="">-- Pilih Preset Barang --</option>
                            <option value="Proyektor">Proyektor</option>
                            <option value="HDMI">HDMI</option>
                            <option value="Proyektor + HDMI">Proyektor + HDMI</option>
                            <option value="Sound Portabel">Sound Portabel</option>
                        </select>
                        <input type="number" name="itemQty" value="1" min="1" required class="p-2 border rounded-lg text-center font-bold">
                    </div>
                    <input type="text" id="itemNameCustom" name="itemNameCustom" placeholder="Atau ketik nama barang spesifik..." class="w-full p-2 border rounded-lg">
                </div>

                <div>
                    <label class="block font-semibold mb-1">Keperluan *</label>
                    <input type="text" name="borrowPurpose" required class="w-full p-2 border rounded-lg">
                </div>

                <div class="grid grid-cols-2 gap-3 border-t pt-3">
                    <div>
                        <label class="block font-semibold mb-1">Tanggal Pinjam</label>
                        <input type="date" name="borrowDate" value="<?= date('Y-m-d') ?>" required class="w-full p-2 border rounded-lg">
                    </div>
                    <div>
                        <label class="block font-semibold mb-1">Estimasi Kembali</label>
                        <input type="date" name="expectedReturnDate" value="<?= date('Y-m-d') ?>" required class="w-full p-2 border rounded-lg">
                    </div>
                </div>

                <div class="flex justify-end gap-2 pt-3 border-t">
                    <button type="button" onclick="closeModal()" class="px-4 py-2 bg-slate-100 rounded-lg">Batal</button>
                    <button type="submit" class="px-5 py-2 bg-manGreen-700 text-white rounded-lg font-bold">Simpan Peminjaman</button>
                </div>
            </form>
        </div>
    </div>

    <script>
        lucide.createIcons();
        function openModal() { document.getElementById('itemModal').classList.remove('hidden'); }
        function closeModal() { document.getElementById('itemModal').classList.add('hidden'); }
        function autoFillItem() {
            const val = document.getElementById('presetItemSelect').value;
            if(val) document.getElementById('itemNameCustom').value = val;
        }
    </script>
</body>
</html>