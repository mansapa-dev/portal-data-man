<?php
require __DIR__.'/app/bootstrap.php';
require __DIR__.'/app/src/Borrowings.php';
$conn = sip_db('multimedia');
$login_error = '';
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    sip_check_csrf();
    if (($_POST['form_type'] ?? '') === 'logout') { sip_logout(); header('Location: index.php'); exit; }
    if (($_POST['form_type'] ?? '') === 'login') {
        try {
            if (sip_login($_POST['username'] ?? '', $_POST['password'] ?? '')) { header('Location: index.php'); exit; }
            $login_error = 'Username atau password salah.';
        } catch (RuntimeException $e) { $login_error = $e->getMessage(); }
    }
}
$currentUser = sip_user();
if ($currentUser) {
    if (!sip_identity()->allows($currentUser, 'multimedia', 'borrowings.read') && sip_identity()->allows($currentUser, 'multimedia', 'borrowings.create')) { header('Location: peminjam.php'); exit; }
    sip_require('multimedia', 'borrowings.read');
    $_SESSION['nama']=$currentUser['name'];
    $_SESSION['username']=$currentUser['username'];
}
// -----------------------------------------------------------------------------
// TAMPILKAN HALAMAN LOGIN JIKA BELUM LOG IN
// -----------------------------------------------------------------------------
if (!$currentUser):
?>
<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Login - SIPINTAR MULTIMEDIA</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <script src="https://unpkg.com/lucide@latest"></script>
<?php require __DIR__."/app/client.php"; ?>
</head>
<body class="bg-emerald-950 min-h-screen flex items-center justify-center p-4 font-sans">
    <div class="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden border border-emerald-800">
        <div class="bg-emerald-800 p-6 text-white text-center">
            <img src="logo.png" alt="Logo MAN 1" class="w-16 h-16 mx-auto mb-2 object-contain" onerror="this.src='https://via.placeholder.com/60?text=LOGO'">
            <h2 class="text-xl font-bold uppercase tracking-wide">SIPINTAR MULTIMEDIA</h2>
            <p class="text-xs text-emerald-200 mt-1">Sistem Peminjaman Inventaris Multimedia MAN 1 Palembang</p>
        </div>

        <form method="POST" class="p-6 space-y-4 text-xs"><input type="hidden" name="_csrf" value="<?= sip_e(sip_csrf()) ?>">
            <input type="hidden" name="form_type" value="login">

            <?php if (!empty($login_error)): ?>
                <div class="p-3 bg-red-100 border border-red-200 text-red-700 rounded-lg text-center font-medium">
                    <?= sip_e($login_error) ?>
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

            <div class="text-center pt-1">
                <a href="peminjam.php" class="text-emerald-700 hover:text-emerald-800 font-semibold text-xs hover:underline transition">
                    Masuk sebagai Peminjam
                </a>
            </div>
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

// Mutations are authorized on the server and require POST + CSRF.
if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['form_type'])) {
    $action = $_POST['form_type'];
    $permission = $action === 'add_borrowing' ? 'borrowings.create' : 'borrowings.manage';
    $currentUser = sip_require('multimedia', $permission);
    $service = new \Sipintar\Borrowings(new \Sipintar\Database($conn));
    try {
        if ($action === 'toggle_return') $service->returned($_POST['id'] ?? '', (int)($_POST['status'] ?? -1));
        elseif (in_array($action, ['add_borrowing', 'edit_borrowing'], true)) {
            $employee = sip_employee($currentUser, 'multimedia', $_POST);
            if ($action === 'edit_borrowing' && empty($_POST['employee_id'])) {
                $old = (new \Sipintar\Database($conn))->query('SELECT name,id_num FROM borrowings WHERE id=?', [$_POST['edit_id'] ?? ''])->get_result()->fetch_assoc();
                if (!$old) throw new RuntimeException('Peminjaman tidak ditemukan.');
                $employee = ['name'=>$old['name'], 'nip'=>$old['id_num']];
            }
            $service->save($_POST, $employee, $action === 'edit_borrowing');
        } else sip_fail(404, 'Tindakan tidak ditemukan.');
    } catch (RuntimeException $e) { if ($e instanceof mysqli_sql_exception) throw $e; sip_fail(422, $e->getMessage()); }
    header('Location: index.php?view=data'); exit;
}
session_write_close();

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
        $r = array_map('sip_e', $r);
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

$view = $_GET['view'] ?? 'dashboard';

// Fetch Data Statistik Dashboard
$total_pinjam = $conn->query("SELECT COUNT(*) as total FROM borrowings")->fetch_assoc()['total'];
$total_belum = $conn->query("SELECT COUNT(*) as total FROM borrowings WHERE returned=0")->fetch_assoc()['total'];
$total_sudah = $conn->query("SELECT COUNT(*) as total FROM borrowings WHERE returned=1")->fetch_assoc()['total'];
$total_user = sip_identity()->query("SELECT COUNT(*) FROM accounts a WHERE a.active=1 AND (a.superadmin_slot=1 OR EXISTS (SELECT 1 FROM grants g WHERE g.account_id=a.id ))")->fetchColumn();

// Fetch Data Peminjaman untuk Tabel Data
$page = max(1, (int)($_GET['page'] ?? 1));
$offset = ($page - 1) * 50;
$filtered_total = (int)$conn->query("SELECT COUNT(*) FROM borrowings WHERE $where_sql")->fetch_row()[0];
$borrowings = $conn->query("SELECT * FROM borrowings WHERE $where_sql ORDER BY date DESC, time DESC, id DESC LIMIT 50 OFFSET $offset");

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
<?php require __DIR__."/app/client.php"; ?>
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
                    <span class="text-emerald-300">Pengguna:</span>
                    <div class="font-bold text-white flex items-center gap-1.5">
                        <?= htmlspecialchars($_SESSION['nama']) ?>
                    </div>
                </div>
                <div class="flex items-center gap-2 border-l border-emerald-700 pl-3">
                    <a href="index.php?view=dashboard" class="px-2.5 py-1 rounded <?= $view == 'dashboard' ? 'bg-emerald-500 font-bold text-white' : 'bg-emerald-700 hover:bg-emerald-600 text-white' ?> font-medium">Dashboard</a>
                    <a href="index.php?view=data" class="px-2.5 py-1 rounded <?= $view == 'data' ? 'bg-emerald-500 font-bold text-white' : 'bg-emerald-700 hover:bg-emerald-600 text-white' ?> font-medium">Data Pinjam</a>
                    <form method="POST" class="inline"><input type="hidden" name="_csrf" value="<?= sip_e(sip_csrf()) ?>"><input type="hidden" name="form_type" value="logout"><button class="px-2.5 py-1 rounded bg-red-600 text-white">Keluar</button></form>
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

        <?php if ($view == 'dashboard'): ?>
        <!-- ================= HALAMAN DASHBOARD ================= -->
        <div class="no-print space-y-6">
            <!-- CARDS RINGKASAN STATISTIK -->
            <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div class="bg-white p-5 rounded-xl border border-emerald-100 shadow-sm flex items-center justify-between">
                    <div>
                        <p class="text-xs font-semibold text-slate-500 uppercase">Total Peminjaman</p>
                        <h3 class="text-2xl font-bold text-slate-800 mt-1"><?= $total_pinjam ?></h3>
                    </div>
                    <div class="w-12 h-12 bg-emerald-100 text-emerald-700 rounded-xl flex items-center justify-center">
                        <i data-lucide="archive" class="w-6 h-6"></i>
                    </div>
                </div>

                <div class="bg-white p-5 rounded-xl border border-amber-100 shadow-sm flex items-center justify-between">
                    <div>
                        <p class="text-xs font-semibold text-slate-500 uppercase">Sedang Dipinjam</p>
                        <h3 class="text-2xl font-bold text-amber-600 mt-1"><?= $total_belum ?></h3>
                    </div>
                    <div class="w-12 h-12 bg-amber-100 text-amber-700 rounded-xl flex items-center justify-center">
                        <i data-lucide="clock" class="w-6 h-6"></i>
                    </div>
                </div>

                <div class="bg-white p-5 rounded-xl border border-emerald-100 shadow-sm flex items-center justify-between">
                    <div>
                        <p class="text-xs font-semibold text-slate-500 uppercase">Sudah Dikembalikan</p>
                        <h3 class="text-2xl font-bold text-emerald-600 mt-1"><?= $total_sudah ?></h3>
                    </div>
                    <div class="w-12 h-12 bg-emerald-100 text-emerald-700 rounded-xl flex items-center justify-center">
                        <i data-lucide="check-circle" class="w-6 h-6"></i>
                    </div>
                </div>

                <div class="bg-white p-5 rounded-xl border border-blue-100 shadow-sm flex items-center justify-between">
                    <div>
                        <p class="text-xs font-semibold text-slate-500 uppercase">Total Pengguna</p>
                        <h3 class="text-2xl font-bold text-blue-600 mt-1"><?= $total_user ?></h3>
                    </div>
                    <div class="w-12 h-12 bg-blue-100 text-blue-700 rounded-xl flex items-center justify-center">
                        <i data-lucide="users" class="w-6 h-6"></i>
                    </div>
                </div>
            </div>

            <!-- AKTIVITAS PEMINJAMAN TERBARU -->
            <div class="bg-white rounded-xl border border-emerald-200 shadow-sm p-6">
                <div class="flex items-center justify-between mb-4 border-b pb-3 border-slate-100">
                    <h2 class="text-base font-bold text-emerald-800 flex items-center gap-2">
                        <i data-lucide="activity" class="w-5 h-5"></i> Aktivitas Peminjaman Terbaru
                    </h2>
                    <a href="index.php?view=data" class="text-xs font-semibold text-emerald-700 hover:underline flex items-center gap-1">
                        Lihat Semua Data <i data-lucide="arrow-right" class="w-3.5 h-3.5"></i>
                    </a>
                </div>

                <div class="overflow-x-auto">
                    <table class="w-full text-left text-xs border-collapse">
                        <thead>
                            <tr class="bg-slate-100 text-slate-700 uppercase text-[11px] font-semibold">
                                <th class="p-3">Kode</th>
                                <th class="p-3">Peminjam</th>
                                <th class="p-3">Barang</th>
                                <th class="p-3">Tgl Pinjam</th>
                                <th class="p-3">Est. Kembali</th>
                                <th class="p-3 text-center">Status</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-100 text-slate-700">
                            <?php
                            $recent = $conn->query("SELECT * FROM borrowings ORDER BY created_at DESC LIMIT 5");
                            if ($recent->num_rows == 0):
                            ?>
                                <tr><td colspan="6" class="text-center py-4 text-slate-400">Belum ada aktivitas transaksi.</td></tr>
                            <?php else: ?>
                                <?php while($r = $recent->fetch_assoc()): ?>
                                <tr class="hover:bg-slate-50">
                                    <td class="p-3 font-mono font-bold text-emerald-800"><?= htmlspecialchars($r['id']) ?></td>
                                    <td class="p-3 font-semibold"><?= htmlspecialchars($r['name']) ?> (<?= htmlspecialchars($r['type']) ?>)</td>
                                    <td class="p-3"><?= htmlspecialchars($r['item']) ?> (<?= $r['qty'] ?> Unit)</td>
                                    <td class="p-3"><?= htmlspecialchars($r['date']) ?></td>
                                    <td class="p-3"><?= htmlspecialchars($r['expected_return']) ?></td>
                                    <td class="p-3 text-center">
                                        <span class="px-2.5 py-1 rounded text-[10px] font-bold <?= $r['returned'] ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800' ?>">
                                            <?= $r['returned'] ? 'Sudah Kembali' : 'Belum Kembali' ?>
                                        </span>
                                    </td>
                                </tr>
                                <?php endwhile; ?>
                            <?php endif; ?>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>

        <?php else: ?>
        <!-- ================= HALAMAN TABEL DATA PEMINJAMAN ================= -->

        <!-- PANEL FILTER & PENCARIAN (WEB) -->
        <div class="no-print bg-white p-4 rounded-xl border border-emerald-200 shadow-sm mb-6">
            <form method="GET" class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-6 gap-3 text-xs items-end">
                <input type="hidden" name="view" value="data">

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
                    <a href="index.php?view=data" class="bg-slate-100 hover:bg-slate-200 text-slate-600 font-bold py-2 px-3 rounded-lg border flex items-center justify-center" title="Reset Filter">
                        <i data-lucide="rotate-ccw" class="w-3.5 h-3.5"></i>
                    </a>
                </div>
            </form>

            <!-- TOMBOL AKSI: PINJAM BARANG, CETAK PDF, EXPORT EXCEL -->
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
                                    <?php if (sip_identity()->allows($currentUser,'multimedia','borrowings.manage')): ?><form method="POST" class="inline"><input type="hidden" name="_csrf" value="<?= sip_e(sip_csrf()) ?>"><input type="hidden" name="form_type" value="toggle_return"><input type="hidden" name="id" value="<?= sip_e($row['id']) ?>"><input type="hidden" name="status" value="<?= $row['returned'] ? 0 : 1 ?>"><button class="no-print px-2.5 py-1 rounded font-bold text-[10px] transition <?= $row['returned'] ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' : 'bg-amber-100 text-amber-800 border border-amber-300' ?>">
                                        <?= $row['returned'] ? '✓ Sudah Kembali' : '[ ] Belum Kembali' ?>
                                    </button></form><?php else: ?><?= $row['returned'] ? 'Sudah kembali' : 'Belum kembali' ?><?php endif ?>
                                    <span class="print-only font-bold"><?= $row['returned'] ? 'Sudah Kembali' : 'Belum Kembali' ?></span>
                                </td>
                                <td class="p-3 text-center no-print">
                                    <!-- TOMBOL EDIT DATA PEMINJAMAN -->
                                    <button onclick='openEditModal(<?= sip_e(json_encode($row, JSON_HEX_TAG | JSON_HEX_APOS | JSON_HEX_AMP | JSON_HEX_QUOT)) ?>)' class="px-2.5 py-1 bg-amber-500 hover:bg-amber-600 text-white rounded text-[11px] font-bold flex items-center gap-1 mx-auto">
                                        <i data-lucide="edit-3" class="w-3.5 h-3.5"></i> Edit
                                    </button>
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

    <!-- MODAL FORM TAMBAH PEMINJAMAN -->
    <nav class="p-4 text-center">Halaman <?= $page ?> · <?= $filtered_total ?> peminjaman
<?php if ($page > 1): ?><a class="mx-3 underline" href="?<?= sip_e(http_build_query(array_merge($_GET,['page'=>$page-1]))) ?>">Sebelumnya</a><?php endif ?>
<?php if ($page*50 < $filtered_total): ?><a class="mx-3 underline" href="?<?= sip_e(http_build_query(array_merge($_GET,['page'=>$page+1]))) ?>">Berikutnya</a><?php endif ?></nav>
<div id="itemModal" class="fixed inset-0 bg-slate-900/60 flex items-center justify-center p-4 z-50 hidden no-print">
        <div class="bg-white rounded-2xl border border-emerald-100 shadow-2xl max-w-lg w-full overflow-hidden">
            <div class="bg-manGreen-800 text-white px-5 py-4 flex items-center justify-between">
                <h3 class="font-bold text-sm">Form Peminjaman Inventaris Multimedia</h3>
                <button onclick="closeModal()" class="text-emerald-200 hover:text-white"><i data-lucide="x" class="w-5 h-5"></i></button>
            </div>

            <form method="POST" class="p-5 space-y-3 text-xs"><input type="hidden" name="_csrf" value="<?= sip_e(sip_csrf()) ?>">
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

    <!-- MODAL FORM EDIT PEMINJAMAN -->
    <div id="editBorrowingModal" class="fixed inset-0 bg-slate-900/60 flex items-center justify-center p-4 z-50 hidden no-print">
        <div class="bg-white rounded-2xl border border-emerald-100 shadow-2xl max-w-lg w-full overflow-hidden">
            <div class="bg-manGreen-800 text-white px-5 py-4 flex items-center justify-between">
                <h3 class="font-bold text-sm">Edit Data Peminjaman</h3>
                <button onclick="closeEditModal()" class="text-emerald-200 hover:text-white"><i data-lucide="x" class="w-5 h-5"></i></button>
            </div>

            <form method="POST" class="p-5 space-y-3 text-xs"><input type="hidden" name="_csrf" value="<?= sip_e(sip_csrf()) ?>">
                <input type="hidden" name="form_type" value="edit_borrowing">
                <input type="hidden" id="edit_borrow_id" name="edit_id">

                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label class="block font-semibold mb-1">Nama Peminjam *</label>
                        <input type="text" id="edit_borrowerName" name="borrowerName" required class="w-full p-2 border rounded-lg">
                    </div>
                    <div>
                        <label class="block font-semibold mb-1">Kategori *</label>
                        <select id="edit_borrowerType" name="borrowerType" required class="w-full p-2 border rounded-lg">
                            <option value="Guru">Guru</option>
                            <option value="Siswa">Siswa</option>
                            <option value="Pegawai">Pegawai / Staf</option>
                        </select>
                    </div>
                </div>

                <div>
                    <label class="block font-semibold mb-1">Identitas (NIP / NISN)</label>
                    <input type="text" id="edit_borrowerIdNum" name="borrowerIdNum" class="w-full p-2 border rounded-lg">
                </div>

                <div class="border-t pt-3">
                    <label class="block font-semibold mb-1">Nama Barang & Jumlah *</label>
                    <div class="grid grid-cols-3 gap-2">
                        <input type="text" id="edit_itemName" name="itemName" required class="col-span-2 p-2 border rounded-lg">
                        <input type="number" id="edit_itemQty" name="itemQty" min="1" required class="p-2 border rounded-lg text-center font-bold">
                    </div>
                </div>

                <div>
                    <label class="block font-semibold mb-1">Keperluan *</label>
                    <input type="text" id="edit_borrowPurpose" name="borrowPurpose" required class="w-full p-2 border rounded-lg">
                </div>

                <div class="grid grid-cols-2 gap-3 border-t pt-3">
                    <div>
                        <label class="block font-semibold mb-1">Tanggal Pinjam</label>
                        <input type="date" id="edit_borrowDate" name="borrowDate" required class="w-full p-2 border rounded-lg">
                    </div>
                    <div>
                        <label class="block font-semibold mb-1">Estimasi Kembali</label>
                        <input type="date" id="edit_expectedReturnDate" name="expectedReturnDate" required class="w-full p-2 border rounded-lg">
                    </div>
                </div>

                <div class="flex justify-end gap-2 pt-3 border-t">
                    <button type="button" onclick="closeEditModal()" class="px-4 py-2 bg-slate-100 rounded-lg">Batal</button>
                    <button type="submit" class="px-5 py-2 bg-manGreen-700 text-white rounded-lg font-bold">Update Data</button>
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

        function openEditModal(data) {
            document.querySelector('#editBorrowingModal form').reset();
            document.getElementById('edit_borrow_id').value = data.id;
            document.getElementById('edit_borrowerName').value = data.name;
            document.getElementById('edit_borrowerType').value = data.type;
            document.getElementById('edit_borrowerIdNum').value = data.id_num;
            document.getElementById('edit_itemName').value = data.item;
            document.getElementById('edit_itemQty').value = data.qty;
            document.getElementById('edit_borrowPurpose').value = data.purpose;
            document.getElementById('edit_borrowDate').value = data.date;
            document.getElementById('edit_expectedReturnDate').value = data.expected_return;

            document.getElementById('editBorrowingModal').classList.remove('hidden');
        }

        function closeEditModal() {
            document.getElementById('editBorrowingModal').classList.add('hidden');
        }
    </script>
</body>
</html>
