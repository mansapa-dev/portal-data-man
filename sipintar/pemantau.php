<?php require_once __DIR__.'/app/bootstrap.php'; ?>
<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SIPINTAR - Mode Pemantau</title>
    <!-- Tailwind CSS -->
    <script src="https://cdn.tailwindcss.com"></script>
    <!-- Lucide Icons -->
    <script src="https://unpkg.com/lucide@latest"></script>
    <!-- jsPDF & autoTable -->
    <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"></script>
    <script src="https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.5.25/jspdf.plugin.autotable.min.js"></script>
    <!-- SheetJS / XLSX Library -->
    <script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"></script>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
        body { font-family: 'Inter', sans-serif; }
    </style>
<?php require __DIR__."/app/client.php"; ?>
</head>
<body class="bg-slate-100 min-h-screen text-slate-800">

    <!-- LOGIN SCREEN FOR PEMANTAU -->
    <div id="login-screen" class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900 bg-opacity-80 p-4">
        <div class="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden">
            <div class="bg-emerald-800 p-6 text-center text-white">
                <div class="w-20 h-20 bg-white rounded-full flex items-center justify-center mx-auto mb-3 p-1 shadow-md overflow-hidden">
                    <img id="login-logo-img" src="logo.png" alt="Logo MAN 1 Palembang" class="w-full h-full object-contain rounded-full" onerror="this.onerror=null; this.parentElement.innerHTML='<div class=\'text-emerald-800 font-bold text-xs text-center\'>MAN 1</div>';">
                </div>
                <h2 class="text-xl font-bold">SIPINTAR</h2>
                <p class="text-emerald-100 text-xs mt-1">Akses Mode Pemantau / Monitoring</p>
            </div>

            <div class="p-6 space-y-4">
                <form id="form-login" onsubmit="handleLogin(event)" class="space-y-4">
                    <div>
                        <label class="block text-xs font-semibold text-slate-600 mb-1">Username</label>
                        <input type="text" id="login-username" required class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-emerald-500 text-sm outline-none" placeholder="Masukkan username pemantau">
                    </div>
                    <div>
                        <label class="block text-xs font-semibold text-slate-600 mb-1">Password</label>
                        <input type="password" id="login-password" required class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-emerald-500 text-sm outline-none" placeholder="Masukkan password">
                    </div>
                    <button type="submit" class="w-full bg-emerald-700 hover:bg-emerald-800 text-white py-2.5 rounded-lg font-semibold text-sm transition shadow-md">
                        Masuk Pemantau
                    </button>
                </form>

                <div class="relative my-3 text-center">
                    <div class="absolute inset-0 flex items-center"><div class="w-full border-t border-slate-200"></div></div>
                    <span class="relative bg-white px-2 text-[11px] text-slate-400">Atau Halaman Utama</span>
                </div>

                <a href="index.php" class="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 py-2 rounded-lg font-medium text-xs transition border border-slate-300 flex items-center justify-center gap-1.5">
                    <i data-lucide="arrow-left" class="w-4 h-4 text-slate-500"></i> Kembali ke Halaman Utama
                </a>
            </div>
        </div>
    </div>

    <!-- MAIN APP DASHBOARD (Hidden by default) -->
    <div id="app-dashboard" class="hidden">
        <!-- HEADER / NAVBAR -->
        <header class="bg-emerald-800 text-white shadow-md sticky top-0 z-30">
            <div class="max-w-7xl mx-auto px-4 py-3 flex justify-between items-center">
                <div class="flex items-center gap-3">
                    <div class="p-0.5 bg-white rounded-lg w-10 h-10 flex items-center justify-center overflow-hidden">
                        <img id="app-logo-img" src="logo.png" alt="Logo MAN 1 Palembang" class="w-full h-full object-contain" onerror="this.onerror=null; this.parentElement.innerHTML='<div class=\'text-emerald-800 font-bold text-[9px] text-center\'>MAN 1</div>';">
                    </div>
                    <div>
                        <h1 class="font-bold text-lg leading-tight">SIPINTAR</h1>
                        <p class="text-xs text-emerald-200">Sistem Pengelolaan Inventaris MAN 1 Palembang</p>
                    </div>
                </div>
                <div class="flex items-center gap-4">
                    <div class="text-right hidden sm:block">
                        <p id="user-name" class="text-xs font-semibold text-emerald-100">Pemantau</p>
                        <p class="text-[10px] text-emerald-300">Mode Monitoring (Read-Only)</p>
                    </div>
                    <button onclick="handleLogout()" class="bg-rose-600 hover:bg-rose-700 text-white px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1 shadow transition">
                        <i data-lucide="log-out" class="w-3.5 h-3.5"></i> Keluar
                    </button>
                </div>
            </div>
        </header>

        <!-- MAIN CONTAINER -->
        <main class="max-w-7xl mx-auto px-4 py-6 space-y-6">

            <!-- TAB NAVIGATION -->
            <div class="flex border-b border-slate-200 gap-2 overflow-x-auto">
                <button onclick="switchTab('dashboard')" id="tab-dashboard" class="px-4 py-2.5 text-sm font-semibold border-b-2 border-emerald-600 text-emerald-800 flex items-center gap-2 whitespace-nowrap">
                    <i data-lucide="layout-dashboard" class="w-4 h-4"></i> Dashboard
                </button>
                <button onclick="switchTab('history')" id="tab-history" class="px-4 py-2.5 text-sm font-semibold border-b-2 border-transparent text-slate-500 hover:text-slate-700 flex items-center gap-2 whitespace-nowrap">
                    <i data-lucide="history" class="w-4 h-4"></i> Riwayat & Laporan Inventaris
                </button>
                <button onclick="switchTab('master_barang')" id="tab-master-barang" class="px-4 py-2.5 text-sm font-semibold border-b-2 border-transparent text-slate-500 hover:text-slate-700 flex items-center gap-2 whitespace-nowrap">
                    <i data-lucide="package" class="w-4 h-4"></i> Data Stok Barang
                </button>
            </div>

            <!-- SECTION 0: DASHBOARD STATISTIK -->
            <section id="section-dashboard" class="space-y-6">
                <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
                        <div>
                            <p class="text-xs text-slate-500 font-medium">Total Jenis Barang</p>
                            <h3 id="dash-total-barang" class="text-2xl font-bold text-slate-800 mt-1">0</h3>
                        </div>
                        <div class="p-3 bg-blue-50 text-blue-600 rounded-lg">
                            <i data-lucide="boxes" class="w-6 h-6"></i>
                        </div>
                    </div>

                    <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
                        <div>
                            <p class="text-xs text-slate-500 font-medium">Stok Kritis (≤ 5)</p>
                            <h3 id="dash-stok-kritis" class="text-2xl font-bold text-amber-600 mt-1">0</h3>
                        </div>
                        <div class="p-3 bg-amber-50 text-amber-600 rounded-lg">
                            <i data-lucide="alert-triangle" class="w-6 h-6"></i>
                        </div>
                    </div>

                    <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
                        <div>
                            <p class="text-xs text-slate-500 font-medium">Transaksi Barang Masuk</p>
                            <h3 id="dash-trans-masuk" class="text-2xl font-bold text-emerald-600 mt-1">0</h3>
                        </div>
                        <div class="p-3 bg-emerald-50 text-emerald-600 rounded-lg">
                            <i data-lucide="arrow-down-left" class="w-6 h-6"></i>
                        </div>
                    </div>

                    <div class="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex items-center justify-between">
                        <div>
                            <p class="text-xs text-slate-500 font-medium">Transaksi Barang Keluar</p>
                            <h3 id="dash-trans-keluar" class="text-2xl font-bold text-rose-600 mt-1">0</h3>
                        </div>
                        <div class="p-3 bg-rose-50 text-rose-600 rounded-lg">
                            <i data-lucide="arrow-up-right" class="w-6 h-6"></i>
                        </div>
                    </div>
                </div>

                <div class="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                    <h2 class="text-base font-bold text-slate-800 mb-4 flex items-center gap-2">
                        <i data-lucide="bell" class="w-5 h-5 text-amber-500"></i> Peringatan Notifikasi Stok Kritis
                    </h2>
                    <div id="dash-alert-container" class="space-y-3"></div>
                </div>

                <div class="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                    <div class="flex justify-between items-center mb-4">
                        <h2 class="text-base font-bold text-slate-800 flex items-center gap-2">
                            <i data-lucide="clock" class="w-5 h-5 text-emerald-600"></i> Transaksi Terbaru
                        </h2>
                        <button onclick="switchTab('history')" class="text-xs font-semibold text-emerald-700 hover:text-emerald-800">Lihat Semua →</button>
                    </div>
                    <div class="overflow-x-auto border rounded-lg">
                        <table class="w-full text-sm text-left">
                            <thead class="bg-slate-50 border-b text-xs font-semibold text-slate-600">
                                <tr>
                                    <th class="p-3">Kode Transaksi</th>
                                    <th class="p-3">Tipe</th>
                                    <th class="p-3">Tanggal</th>
                                    <th class="p-3">Pihak Terkait</th>
                                    <th class="p-3">Rincian Barang</th>
                                </tr>
                            </thead>
                            <tbody id="dash-recent-table-body"></tbody>
                        </table>
                    </div>
                </div>
            </section>

            <!-- SECTION 1: RIWAYAT & LAPORAN REKAP -->
            <section id="section-history" class="hidden bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 pb-4 border-b">
                    <div>
                        <h2 class="text-base font-bold text-slate-800">Riwayat & Laporan Inventaris</h2>
                        <p class="text-xs text-slate-500">Pemantauan data transaksi barang masuk & keluar serta pencetakan laporan.</p>
                    </div>
                    <div class="flex flex-wrap items-center gap-2">
                        <button onclick="exportPDF()" class="bg-rose-700 hover:bg-rose-800 text-white px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow transition">
                            <i data-lucide="file-text" class="w-4 h-4"></i> Cetak PDF
                        </button>
                        <button onclick="exportExcel()" class="bg-emerald-700 hover:bg-emerald-800 text-white px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow transition">
                            <i data-lucide="sheet" class="w-4 h-4"></i> Cetak Excel
                        </button>
                    </div>
                </div>

                <!-- FILTER CONTROLS -->
                <div class="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-4 bg-slate-50 p-3 rounded-lg border">
                    <div>
                        <label class="block text-[11px] font-semibold text-slate-500 mb-1">Tipe Transaksi</label>
                        <select id="filter-tipe" onchange="renderTableHistory()" class="w-full px-3 py-1.5 text-xs border rounded-md outline-none">
                            <option value="">Semua Transaksi</option>
                            <option value="MASUK">Barang Masuk (Restok)</option>
                            <option value="KELUAR">Barang Keluar (Penerimaan)</option>
                        </select>
                    </div>
                    <div>
                        <label class="block text-[11px] font-semibold text-slate-500 mb-1">Pencarian</label>
                        <input type="text" id="filter-search" oninput="renderTableHistory()" placeholder="Cari Kode/Pihak/Barang..." class="w-full px-3 py-1.5 text-xs border rounded-md outline-none">
                    </div>
                    <div>
                        <label class="block text-[11px] font-semibold text-slate-500 mb-1">Bulan</label>
                        <select id="filter-bulan" onchange="renderTableHistory()" class="w-full px-3 py-1.5 text-xs border rounded-md outline-none">
                            <option value="">Semua Bulan</option>
                            <option value="01">Januari</option>
                            <option value="02">Februari</option>
                            <option value="03">Maret</option>
                            <option value="04">April</option>
                            <option value="05">Mei</option>
                            <option value="06">Juni</option>
                            <option value="07">Juli</option>
                            <option value="08">Agustus</option>
                            <option value="09">September</option>
                            <option value="10">Oktober</option>
                            <option value="11">November</option>
                            <option value="12">Desember</option>
                        </select>
                    </div>
                    <div>
                        <label class="block text-[11px] font-semibold text-slate-500 mb-1">Tahun</label>
                        <input type="number" id="filter-tahun" oninput="renderTableHistory()" placeholder="Contoh: 2026" class="w-full px-3 py-1.5 text-xs border rounded-md outline-none">
                    </div>
                </div>

                <div class="overflow-x-auto border rounded-lg">
                    <table class="w-full text-sm text-left">
                        <thead class="bg-slate-100 border-b text-xs font-semibold text-slate-600">
                            <tr>
                                <th class="p-3">Kode Transaksi</th>
                                <th class="p-3">Tipe</th>
                                <th class="p-3">Tanggal</th>
                                <th class="p-3">Penerima / Petugas</th>
                                <th class="p-3">Rincian Barang</th>
                                <th class="p-3">Keterangan</th>
                            </tr>
                        </thead>
                        <tbody id="history-table-body"></tbody>
                    </table>
                </div>
            </section>

            <!-- SECTION 2: MASTER BARANG -->
            <section id="section-master-barang" class="hidden bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 pb-4 border-b">
                    <div>
                        <h2 class="text-base font-bold text-slate-800">Master Data & Stok Barang</h2>
                        <p class="text-xs text-slate-500">Melihat daftar barang dan jumlah stok yang tersedia saat ini.</p>
                    </div>
                </div>

                <div class="overflow-x-auto border rounded-lg">
                    <table class="w-full text-sm text-left">
                        <thead class="bg-slate-100 border-b text-xs font-semibold text-slate-600">
                            <tr>
                                <th class="p-3 w-12">No</th>
                                <th class="p-3">Nama Barang</th>
                                <th class="p-3">Jenis Barang</th>
                                <th class="p-3">Stok Tersedia</th>
                                <th class="p-3">Satuan</th>
                            </tr>
                        </thead>
                        <tbody id="barang-table-body"></tbody>
                    </table>
                </div>
            </section>

        </main>
    </div>

    <!-- JAVASCRIPT LOGIC -->
    <script>
        let rawTransaksiData = [];
        let masterBarangList = [];

        document.addEventListener('DOMContentLoaded', async () => {
            if (window.lucide) lucide.createIcons();

            const isLoggedIn = Boolean(window.sipSession.user);

            if (isLoggedIn) {
                showDashboard();
            }
        });

        async function handleLogin(e) {
            e.preventDefault();
            const u = document.getElementById('login-username').value;
            const p = document.getElementById('login-password').value;

            try {
                const res = await fetch('api.php?action=login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username: u, password: p })
                });
                const result = await res.json();

                if (result.success) {
                    if (!result.permissions.includes('transactions.read')) {
                        alert('Akun ini bukan akun dengan hak akses Pemantau!');
                        return;
                    }
                    sessionStorage.setItem('sipintar_pemantau_logged_in', 'true');
                    sessionStorage.setItem('sipintar_user', result.nama);

                    showDashboard();
                } else {
                    alert(result.message);
                }
            } catch (err) {
                alert('Gagal terhubung ke server!');
            }
        }

        async function showDashboard() {
            document.getElementById('login-screen').classList.add('hidden');
            document.getElementById('app-dashboard').classList.remove('hidden');

            const userName = sessionStorage.getItem('sipintar_user') || 'Pemantau';
            document.getElementById('user-name').innerText = userName;

            await loadMasterBarang();
            await loadTransaksiData();
            switchTab('dashboard');
        }

        async function handleLogout() {
            await fetch("api.php?action=logout", {method:"POST"});
            sessionStorage.removeItem('sipintar_pemantau_logged_in');
            location.reload();
        }

        async function loadMasterBarang() {
            try {
                const res = await fetch('api.php?action=get_barang');
                const result = await res.json();
                if (result.success) {
                    masterBarangList = result.data;
                    renderTableBarang();
                    renderDashboardWidgets();
                }
            } catch (err) {
                console.error('Gagal memuat barang:', err);
            }
        }

        function renderTableBarang() {
            const tbody = document.getElementById('barang-table-body');
            tbody.innerHTML = '';

            if (masterBarangList.length === 0) {
                tbody.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-xs text-slate-400">Belum ada data barang.</td></tr>`;
                return;
            }

            masterBarangList.forEach((b, index) => {
                const tr = document.createElement('tr');
                tr.className = "border-b text-xs hover:bg-slate-50";
                tr.innerHTML = `
                    <td class="p-3 font-semibold">${index + 1}</td>
                    <td class="p-3 font-semibold text-slate-800">${sipEscape(b.nama_barang)}</td>
                    <td class="p-3 text-slate-600">${sipEscape(b.jenis_barang)}</td>
                    <td class="p-3 font-bold ${b.stok <= 5 ? 'text-rose-600' : 'text-emerald-700'}">${b.stok}</td>
                    <td class="p-3">${sipEscape(b.satuan)}</td>
                `;
                tbody.appendChild(tr);
            });
        }

        async function loadTransaksiData() {
            try {
                const res = await fetch('api.php?action=get_transaksi&page=' + (window.sipHistoryPage || 1));
                const result = await res.json();
                if (result.success) {
                    rawTransaksiData = result.data;
                    window.sipHistoryTotal = result.total;
                    window.sipHistoryLimit = result.per_page;
                    document.getElementById('sip-history-status').textContent = `Riwayat halaman ${result.page} · ${result.total} transaksi. Filter, ringkasan transaksi, dan ekspor mengikuti halaman ini.`;
                    renderTableHistory();
                    renderDashboardWidgets();
                }
            } catch (err) {
                console.error('Gagal memuat data:', err);
            }
        }

        function renderDashboardWidgets() {
            document.getElementById('dash-total-barang').innerText = masterBarangList.length;

            const kritis = masterBarangList.filter(b => b.stok <= 5);
            document.getElementById('dash-stok-kritis').innerText = kritis.length;

            const countMasuk = rawTransaksiData.filter(t => (t.tipe || 'KELUAR') === 'MASUK').length;
            const countKeluar = rawTransaksiData.filter(t => (t.tipe || 'KELUAR') === 'KELUAR').length;

            document.getElementById('dash-trans-masuk').innerText = countMasuk;
            document.getElementById('dash-trans-keluar').innerText = countKeluar;

            const alertContainer = document.getElementById('dash-alert-container');
            alertContainer.innerHTML = '';

            if (kritis.length === 0) {
                alertContainer.innerHTML = `
                    <div class="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800 flex items-center gap-2">
                        <i data-lucide="check-circle" class="w-4 h-4 text-emerald-600"></i>
                        <span>Semua stok barang berada dalam kondisi aman (di atas 5 Pcs).</span>
                    </div>
                `;
            } else {
                kritis.forEach(b => {
                    const statusClass = b.stok == 0 ? 'bg-rose-50 border-rose-300 text-rose-800' : 'bg-amber-50 border-amber-300 text-amber-800';
                    const badgeClass = b.stok == 0 ? 'bg-rose-600 text-white' : 'bg-amber-500 text-white';
                    const statusText = b.stok == 0 ? 'STOK HABIS' : 'STOK TIPIS';

                    const div = document.createElement('div');
                    div.className = `p-3 border rounded-lg text-xs flex items-center justify-between ${statusClass}`;
                    div.innerHTML = `
                        <div class="flex items-center gap-2.5">
                            <i data-lucide="alert-circle" class="w-4 h-4 flex-shrink-0"></i>
                            <div>
                                <span class="font-bold">${sipEscape(b.nama_barang)}</span>
                                <span class="text-[11px] opacity-80"> (Kategori: ${sipEscape(b.jenis_barang)})</span>
                            </div>
                        </div>
                        <div class="flex items-center gap-2">
                            <span class="font-bold text-sm">${b.stok} ${sipEscape(b.satuan)}</span>
                            <span class="px-2 py-0.5 text-[10px] rounded font-bold ${badgeClass}">${statusText}</span>
                        </div>
                    `;
                    alertContainer.appendChild(div);
                });
            }

            const recentTbody = document.getElementById('dash-recent-table-body');
            recentTbody.innerHTML = '';

            const recent = rawTransaksiData.slice(0, 5);
            if (recent.length === 0) {
                recentTbody.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-xs text-slate-400">Belum ada transaksi.</td></tr>`;
            } else {
                recent.forEach(t => {
                    const tipe = t.tipe || 'KELUAR';
                    const tipeBadge = tipe === 'MASUK'
                        ? `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">BARANG MASUK</span>`
                        : `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800">BARANG KELUAR</span>`;

                    const barangStr = t.items && t.items.length > 0
                        ? t.items.map(i => `${sipEscape(i.nama_barang)} (${i.jumlah} ${sipEscape(i.satuan)})`).join(', ')
                        : '-';

                    const tr = document.createElement('tr');
                    tr.className = "border-b text-xs hover:bg-slate-50";
                    tr.innerHTML = `
                        <td class="p-3 font-semibold">${sipEscape(t.kode_transaksi)}</td>
                        <td class="p-3">${tipeBadge}</td>
                        <td class="p-3">${sipEscape(t.tanggal_pengambilan)}</td>
                        <td class="p-3 font-medium">${sipEscape(t.nama_pengambil)} <span class="text-[10px] text-slate-400">(${sipEscape(t.jabatan_unit)})</span></td>
                        <td class="p-3 text-slate-600">${barangStr}</td>
                    `;
                    recentTbody.appendChild(tr);
                });
            }

            if (window.lucide) lucide.createIcons();
        }

        function getFilteredData() {
            const tipe = document.getElementById('filter-tipe').value;
            const search = document.getElementById('filter-search').value.toLowerCase();
            const bulan = document.getElementById('filter-bulan').value;
            const tahun = document.getElementById('filter-tahun').value;

            return rawTransaksiData.filter(item => {
                const itemTipe = item.tipe || 'KELUAR';
                const itemDate = new Date(item.tanggal_pengambilan);
                const itemBulan = String(itemDate.getMonth() + 1).padStart(2, '0');
                const itemTahun = String(itemDate.getFullYear());

                const matchTipe = !tipe || itemTipe === tipe;

                const matchSearch = item.kode_transaksi.toLowerCase().includes(search) ||
                                    item.nama_pengambil.toLowerCase().includes(search) ||
                                    item.jabatan_unit.toLowerCase().includes(search) ||
                                    (item.items && item.items.some(i => i.nama_barang.toLowerCase().includes(search)));

                const matchBulan = !bulan || itemBulan === bulan;
                const matchTahun = !tahun || itemTahun === tahun;

                return matchTipe && matchSearch && matchBulan && matchTahun;
            });
        }

        function renderTableHistory() {
            const tbody = document.getElementById('history-table-body');
            const filtered = getFilteredData();
            tbody.innerHTML = '';

            if (filtered.length === 0) {
                tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-xs text-slate-400">Tidak ada data transaksi yang cocok dengan filter.</td></tr>`;
                return;
            }

            filtered.forEach(item => {
                const tipe = item.tipe || 'KELUAR';
                const tipeBadge = tipe === 'MASUK'
                    ? `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">BARANG MASUK</span>`
                    : `<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800">BARANG KELUAR</span>`;

                const pihakSubtext = tipe === 'MASUK' ? 'Petugas Penerima' : 'Jabatan';

                const barangList = item.items && item.items.length > 0
                    ? item.items.map(i => `• ${sipEscape(i.nama_barang)} (${i.jumlah} ${sipEscape(i.satuan)})`).join('<br>')
                    : '-';

                const tr = document.createElement('tr');
                tr.className = "border-b text-xs hover:bg-slate-50";
                tr.innerHTML = `
                    <td class="p-3 font-semibold text-emerald-800">${sipEscape(item.kode_transaksi)}</td>
                    <td class="p-3">${tipeBadge}</td>
                    <td class="p-3">${sipEscape(item.tanggal_pengambilan)}</td>
                    <td class="p-3"><strong>${sipEscape(item.nama_pengambil)}</strong><br><span class="text-[10px] text-slate-500">${pihakSubtext}: ${sipEscape(item.jabatan_unit)}</span></td>
                    <td class="p-3">${barangList}</td>
                    <td class="p-3 text-slate-500">${sipEscape(item.keterangan || '-')}</td>
                `;
                tbody.appendChild(tr);
            });
        }

        function exportPDF() {
            const filtered = getFilteredData();
            if (filtered.length === 0) {
                alert('Tidak ada data untuk dicetak!');
                return;
            }

            const filterTipeVal = document.getElementById('filter-tipe').value;
            const filterBulanElem = document.getElementById('filter-bulan');
            const filterTahunVal = document.getElementById('filter-tahun').value.trim();
            const bulanText = filterBulanElem.options[filterBulanElem.selectedIndex].text;

            let jenisLaporan = 'Laporan Rekapitulasi Inventaris Barang';
            if (filterTipeVal === 'MASUK') jenisLaporan = 'Laporan Rekapitulasi Barang Masuk (Restok)';
            if (filterTipeVal === 'KELUAR') jenisLaporan = 'Laporan Rekapitulasi Barang Keluar (Penerimaan)';

            let wktuText = '';
            if (filterBulanElem.value !== '') {
                wktuText += ` Bulan ${bulanText}`;
            }
            if (filterTahunVal !== '') {
                wktuText += ` ${filterTahunVal}`;
            }

            const judulLaporan = `${jenisLaporan}${wktuText}`;

            const { jsPDF } = window.jspdf;
            const doc = new jsPDF();

            const logoImg = document.getElementById('app-logo-img');
            if (logoImg && logoImg.complete && logoImg.naturalWidth !== 0) {
                try {
                    doc.addImage(logoImg, 'PNG', 14, 8, 16, 16);
                } catch (e) {
                    console.log("Logo skip load");
                }
            }

            doc.setFontSize(14);
            doc.setFont('helvetica', 'bold');
            doc.text('MAN 1 PALEMBANG', 110, 14, { align: 'center' });
            doc.setFontSize(10);
            doc.setFont('helvetica', 'normal');
            doc.text(`${judulLaporan} (SIPINTAR)`, 110, 20, { align: 'center' });
            doc.setLineWidth(0.5);
            doc.line(14, 26, 196, 26);

            const tableRows = [];
            filtered.forEach((item, index) => {
                const barangStr = item.items && item.items.length > 0
                    ? item.items.map(i => `${i.nama_barang} (${i.jumlah} ${i.satuan})`).join(', ')
                    : '-';

                tableRows.push([
                    index + 1,
                    item.kode_transaksi,
                    item.tipe || 'KELUAR',
                    item.tanggal_pengambilan,
                    `${item.nama_pengambil}\n(${item.jabatan_unit})`,
                    barangStr,
                    item.keterangan || '-'
                ]);
            });

            doc.autoTable({
                startY: 29,
                head: [['No', 'Kode', 'Tipe', 'Tanggal', 'Pihak Terkait', 'Rincian Barang', 'Ket']],
                body: tableRows,
                theme: 'grid',
                headStyles: { fillColor: [6, 95, 70] },
                styles: { fontSize: 8, cellPadding: 3 }
            });

            let finalY = doc.lastAutoTable.finalY + 12;

            if (finalY > 240) {
                doc.addPage();
                finalY = 25;
            }

            const todayStr = new Date().toLocaleDateString('id-ID', {
                day: 'numeric',
                month: 'long',
                year: 'numeric'
            });

            doc.setFontSize(9);
            doc.setFont('helvetica', 'normal');

            doc.text('Mengetahui,', 20, finalY);
            doc.text('Kepala Tata Usaha MAN 1 Palembang', 20, finalY + 5);

            doc.text(`Palembang, ${todayStr}`, 135, finalY);
            doc.text('Petugas Pengelola Inventaris,', 135, finalY + 5);

            const ttdY = finalY + 30;

            doc.setFont('helvetica', 'bold');
            doc.text('( .................................................... )', 20, ttdY);
            doc.setFont('helvetica', 'normal');
            doc.text('NIP. ...............................................', 20, ttdY + 5);

            doc.setFont('helvetica', 'bold');
            doc.text('( .................................................... )', 135, ttdY);
            doc.setFont('helvetica', 'normal');
            doc.text('NIP. ...............................................', 135, ttdY + 5);

            doc.save(`Laporan_SIPINTAR_${new Date().toISOString().slice(0, 10)}.pdf`);
        }

        function exportExcel() {
            const filtered = getFilteredData();
            if (filtered.length === 0) {
                alert('Tidak ada data untuk diexport!');
                return;
            }

            const excelData = [];
            filtered.forEach((item, index) => {
                const barangStr = item.items && item.items.length > 0
                    ? item.items.map(i => `${i.nama_barang} (${i.jumlah} ${i.satuan})`).join('; ')
                    : '-';

                excelData.push({
                    'No': index + 1,
                    'Kode Transaksi': item.kode_transaksi,
                    'Tipe Transaksi': item.tipe || 'KELUAR',
                    'Tanggal Transaksi': item.tanggal_pengambilan,
                    'Penerima / Petugas': item.nama_pengambil,
                    'Jabatan': item.jabatan_unit,
                    'Rincian Barang': barangStr,
                    'Keterangan': item.keterangan || '-'
                });
            });

            const worksheet = XLSX.utils.json_to_sheet(excelData);
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, "Laporan Inventaris");

            worksheet['!cols'] = [
                { wch: 5 },
                { wch: 20 },
                { wch: 15 },
                { wch: 18 },
                { wch: 22 },
                { wch: 20 },
                { wch: 45 },
                { wch: 25 }
            ];

            XLSX.writeFile(workbook, `Laporan_SIPINTAR_${new Date().toISOString().slice(0, 10)}.xlsx`);
        }

        function switchTab(tab) {
            document.getElementById('section-dashboard').classList.add('hidden');
            document.getElementById('section-history').classList.add('hidden');
            document.getElementById('section-master-barang').classList.add('hidden');

            const inactiveStyle = "px-4 py-2.5 text-sm font-semibold border-b-2 border-transparent text-slate-500 hover:text-slate-700 flex items-center gap-2 whitespace-nowrap";
            const activeStyle = "px-4 py-2.5 text-sm font-semibold border-b-2 border-emerald-600 text-emerald-800 flex items-center gap-2 whitespace-nowrap";

            document.getElementById('tab-dashboard').className = inactiveStyle;
            document.getElementById('tab-history').className = inactiveStyle;
            document.getElementById('tab-master-barang').className = inactiveStyle;

            if (tab === 'dashboard') {
                document.getElementById('section-dashboard').classList.remove('hidden');
                document.getElementById('tab-dashboard').className = activeStyle;
            } else if (tab === 'history') {
                document.getElementById('section-history').classList.remove('hidden');
                document.getElementById('tab-history').className = activeStyle;
            } else if (tab === 'master_barang') {
                document.getElementById('section-master-barang').classList.remove('hidden');
                document.getElementById('tab-master-barang').className = activeStyle;
            }
        }
    </script>
<div class="p-3 text-center text-xs bg-white border-t"><span id="sip-history-status">Riwayat transaksi</span>
<button class="mx-3 underline" onclick="window.sipHistoryPage=Math.max(1,(window.sipHistoryPage||1)-1);loadTransaksiData()">Sebelumnya</button>
<button class="mx-3 underline" onclick="if((window.sipHistoryPage||1)*(window.sipHistoryLimit||100)<window.sipHistoryTotal){window.sipHistoryPage=(window.sipHistoryPage||1)+1;loadTransaksiData()}">Berikutnya</button></div></body>
</html>
