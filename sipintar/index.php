<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>SIPINTAR - MAN 1 Palembang</title>
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
</head>
<body class="bg-slate-100 min-h-screen text-slate-800">

    <!-- LOGIN SCREEN -->
    <div id="login-screen" class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900 bg-opacity-80 p-4">
        <div class="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden">
            <div class="bg-emerald-800 p-6 text-center text-white">
                <div class="w-20 h-20 bg-white rounded-full flex items-center justify-center mx-auto mb-3 p-1 shadow-md overflow-hidden">
                    <img id="app-logo-img" src="logo.png" alt="Logo MAN 1 Palembang" class="w-full h-full object-contain rounded-full" onerror="this.onerror=null; this.parentElement.innerHTML='<div class=\'text-emerald-800 font-bold text-xs text-center\'>MAN 1</div>';">
                </div>
                <h2 class="text-xl font-bold">SIPINTAR</h2>
                <p class="text-emerald-100 text-xs mt-1">Sistem Pengelolaan Inventaris MAN 1 Palembang</p>
            </div>
            
            <div class="p-6 space-y-4">
                <form id="form-login" onsubmit="handleLogin(event)" class="space-y-4">
                    <div>
                        <label class="block text-xs font-semibold text-slate-600 mb-1">Username</label>
                        <input type="text" id="login-username" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-emerald-500 text-sm outline-none" placeholder="Masukkan username">
                    </div>
                    <div>
                        <label class="block text-xs font-semibold text-slate-600 mb-1">Password</label>
                        <input type="password" id="login-password" class="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-emerald-500 text-sm outline-none" placeholder="Masukkan password">
                    </div>
                    <button type="submit" class="w-full bg-emerald-700 hover:bg-emerald-800 text-white py-2.5 rounded-lg font-semibold text-sm transition shadow-md">
                        Masuk ke Sistem
                    </button>
                </form>

                <div class="relative my-3 text-center">
                    <div class="absolute inset-0 flex items-center"><div class="w-full border-t border-slate-200"></div></div>
                    <span class="relative bg-white px-2 text-[11px] text-slate-400">Atau Akses Pengunjung</span>
                </div>

                <a href="pengunjung.php" class="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 py-2 rounded-lg font-medium text-xs transition border border-slate-300 flex items-center justify-center gap-1.5">
                    <i data-lucide="user-check" class="w-4 h-4 text-slate-500"></i> Buka Form Pengunjung (Tanpa Login)
                </a>
            </div>
        </div>
    </div>

    <!-- MAIN APP DASHBOARD -->
    <div id="app-dashboard" class="hidden">
        <!-- HEADER / NAVBAR -->
        <header id="main-header" class="bg-emerald-800 text-white shadow-md sticky top-0 z-30">
            <div class="max-w-7xl mx-auto px-4 py-3 flex justify-between items-center">
                <div class="flex items-center gap-3">
                    <div class="p-0.5 bg-white rounded-lg w-10 h-10 flex items-center justify-center overflow-hidden">
                        <img src="logo.png" alt="Logo MAN 1 Palembang" class="w-full h-full object-contain" onerror="this.onerror=null; this.parentElement.innerHTML='<div class=\'text-emerald-800 font-bold text-[9px] text-center\'>MAN 1</div>';">
                    </div>
                    <div>
                        <h1 class="font-bold text-lg leading-tight">SIPINTAR</h1>
                        <p class="text-xs text-emerald-200">Sistem Pengelolaan Inventaris MAN 1 Palembang</p>
                    </div>
                </div>
                <div class="flex items-center gap-4">
                    <div class="text-right hidden sm:block">
                        <p id="user-name" class="text-xs font-semibold text-emerald-100">Petugas</p>
                        <p id="user-role-label" class="text-[10px] text-emerald-300">Petugas Inventaris</p>
                    </div>
                    <button onclick="handleLogout()" class="bg-rose-600 hover:bg-rose-700 text-white px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1 shadow transition">
                        <i data-lucide="log-out" class="w-3.5 h-3.5"></i> Logout
                    </button>
                </div>
            </div>
        </header>

        <!-- MAIN CONTAINER -->
        <main class="max-w-7xl mx-auto px-4 py-6 space-y-6">
            <!-- TAB NAVIGATION -->
            <div id="main-tabs" class="flex border-b border-slate-200 gap-2 overflow-x-auto">
                <button onclick="switchTab('form')" id="tab-form" class="px-4 py-2.5 text-sm font-semibold border-b-2 border-emerald-600 text-emerald-800 flex items-center gap-2 whitespace-nowrap">
                    <i data-lucide="file-plus" class="w-4 h-4"></i> Form Penerimaan Barang
                </button>
                <button onclick="switchTab('master_barang')" id="tab-master-barang" class="px-4 py-2.5 text-sm font-semibold border-b-2 border-transparent text-slate-500 hover:text-slate-700 flex items-center gap-2 whitespace-nowrap">
                    <i data-lucide="package" class="w-4 h-4"></i> Data Master Barang
                </button>
                <button onclick="switchTab('history')" id="tab-history" class="px-4 py-2.5 text-sm font-semibold border-b-2 border-transparent text-slate-500 hover:text-slate-700 flex items-center gap-2 whitespace-nowrap">
                    <i data-lucide="history" class="w-4 h-4"></i> Riwayat & Laporan
                </button>
                <button onclick="switchTab('users')" id="tab-users" class="px-4 py-2.5 text-sm font-semibold border-b-2 border-transparent text-slate-500 hover:text-slate-700 flex items-center gap-2 whitespace-nowrap">
                    <i data-lucide="users" class="w-4 h-4"></i> <span id="text-tab-users">Kelola Petugas</span>
                </button>
            </div>

            <!-- SECTION 1: FORM PENERIMAAN BARANG -->
            <section id="section-form" class="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                <h2 class="text-base font-bold text-slate-800 mb-4 pb-2 border-b flex items-center gap-2">
                    <i data-lucide="clipboard-list" class="w-5 h-5 text-emerald-600"></i> Penerimaan Barang
                </h2>
                
                <div id="form-holder">
                    <form id="form-pengambilan" onsubmit="handleSaveTransaksi(event)" class="space-y-4">
                        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div>
                                <label class="block text-xs font-semibold text-slate-600 mb-1">Tanggal Penerimaan</label>
                                <input type="date" id="tanggal_pengambilan" required class="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500">
                            </div>
                            <div>
                                <label class="block text-xs font-semibold text-slate-600 mb-1">Nama Penerima</label>
                                <input type="text" id="nama_pengambil" required placeholder="Nama Guru / Staf Penerima" class="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500">
                            </div>
                            <div>
                                <label class="block text-xs font-semibold text-slate-600 mb-1">Jabatan / Unit Kerja</label>
                                <input type="text" id="jabatan_unit" required placeholder="Contoh: Guru IPA / TU" class="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500">
                            </div>
                        </div>

                        <!-- TABEL INPUT BARANG -->
                        <div class="mt-6">
                            <label class="block text-xs font-semibold text-slate-600 mb-2">Daftar Barang yang Diterima</label>
                            <div class="overflow-x-auto border rounded-lg">
                                <table class="w-full text-sm text-left">
                                    <thead class="bg-slate-50 border-b text-xs font-semibold text-slate-600">
                                        <tr>
                                            <th class="p-3">Nama Barang</th>
                                            <th class="p-3 w-32">Jumlah</th>
                                            <th class="p-3 w-36">Satuan</th>
                                            <th class="p-3 w-16 text-center">Aksi</th>
                                        </tr>
                                    </thead>
                                    <tbody id="table-items-body"></tbody>
                                </table>
                            </div>
                            <button type="button" onclick="addBarangRow()" class="mt-2 text-xs font-semibold text-emerald-700 hover:text-emerald-800 flex items-center gap-1">
                                <i data-lucide="plus-circle" class="w-4 h-4"></i> Tambah Baris Barang
                            </button>
                        </div>

                        <div>
                            <label class="block text-xs font-semibold text-slate-600 mb-1">Keterangan / Keperluan (Opsional)</label>
                            <textarea id="keterangan" rows="2" placeholder="Catatan atau sumber barang diterima..." class="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500"></textarea>
                        </div>

                        <div class="pt-3 flex justify-end">
                            <button type="submit" class="bg-emerald-700 hover:bg-emerald-800 text-white px-5 py-2.5 rounded-lg font-semibold text-sm shadow transition flex items-center gap-2">
                                <i data-lucide="save" class="w-4 h-4"></i> Simpan Penerimaan
                            </button>
                        </div>
                    </form>
                </div>
            </section>

            <!-- SECTION 2: MASTER BARANG -->
            <section id="section-master-barang" class="hidden bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 pb-4 border-b">
                    <div>
                        <h2 class="text-base font-bold text-slate-800">Master Data Barang</h2>
                        <p class="text-xs text-slate-500">Kelola jenis barang, nama barang, dan stok ketersediaan inventaris.</p>
                    </div>
                    <div class="flex flex-wrap items-center gap-2">
                        <button onclick="openExcelModal()" class="bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow transition">
                            <i data-lucide="file-spreadsheet" class="w-4 h-4"></i> Upload Excel
                        </button>
                        <button onclick="openBarangModal()" class="bg-emerald-800 hover:bg-emerald-900 text-white px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow transition">
                            <i data-lucide="plus" class="w-4 h-4"></i> Tambah Barang
                        </button>
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
                                <th class="p-3 w-28 text-center">Aksi</th>
                            </tr>
                        </thead>
                        <tbody id="barang-table-body"></tbody>
                    </table>
                </div>
            </section>

            <!-- SECTION 3: RIWAYAT & LAPORAN REKAP -->
            <section id="section-history" class="hidden bg-white rounded-xl shadow-sm border border-slate-200 p-6">
                <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 pb-4 border-b">
                    <div>
                        <h2 class="text-base font-bold text-slate-800">Riwayat Penerimaan Barang</h2>
                        <p class="text-xs text-slate-500">Filter data untuk rekapitulasi dan pembuatan laporan PDF atau Excel.</p>
                    </div>
                    <div class="flex flex-wrap items-center gap-2">
                        <button onclick="exportPDF()" class="bg-rose-700 hover:bg-rose-800 text-white px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow transition">
                            <i data-lucide="file-text" class="w-4 h-4"></i> Cetak PDF
                        </button>
                        <button onclick="exportExcel()" class="bg-emerald-700 hover:bg-emerald-800 text-white px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow transition">
                            <i data-lucide="sheet" class="w-4 h-4"></i> Cetak Excel
                        </button>
                        <button onclick="handleHapusTerfilter()" class="bg-amber-600 hover:bg-amber-700 text-white px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow transition">
                            <i data-lucide="trash-2" class="w-4 h-4"></i> Hapus Terfilter
                        </button>
                    </div>
                </div>

                <!-- FILTER CONTROLS -->
                <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4 bg-slate-50 p-3 rounded-lg border">
                    <div>
                        <label class="block text-[11px] font-semibold text-slate-500 mb-1">Pencarian</label>
                        <input type="text" id="filter-search" oninput="renderTableHistory()" placeholder="Cari Kode/Nama/Barang..." class="w-full px-3 py-1.5 text-xs border rounded-md outline-none">
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
                                <th class="p-3">Tgl Penerimaan</th>
                                <th class="p-3">Penerima / Unit</th>
                                <th class="p-3">Rincian Barang</th>
                                <th class="p-3">Keterangan</th>
                            </tr>
                        </thead>
                        <tbody id="history-table-body"></tbody>
                    </table>
                </div>
            </section>

            <!-- SECTION 4: KELOLA PETUGAS -->
            <section id="section-users" class="hidden bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            </section>
        </main>
    </div>

    <!-- MODAL UPLOAD EXCEL MASTER BARANG -->
    <div id="modal-excel" class="hidden fixed inset-0 z-50 flex items-center justify-center bg-slate-900 bg-opacity-50 p-4">
        <div class="bg-white rounded-xl shadow-xl max-w-md w-full overflow-hidden">
            <div class="bg-emerald-800 text-white px-5 py-3 flex justify-between items-center">
                <h3 class="font-bold text-sm">Upload Template Excel Barang</h3>
                <button onclick="closeExcelModal()" class="text-emerald-200 hover:text-white">&times;</button>
            </div>
            <div class="p-5 space-y-4">
                <div class="bg-emerald-50 border border-emerald-200 p-3 rounded-lg text-xs text-emerald-800">
                    <p class="font-semibold mb-1">Format Kolom Excel yang Dibutuhkan:</p>
                    <p class="font-mono text-[11px]">nama_barang | jenis_barang | stok | satuan</p>
                </div>

                <button onclick="downloadExcelTemplate()" class="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold border flex items-center justify-center gap-1.5">
                    <i data-lucide="download" class="w-4 h-4"></i> Download Format Template Excel
                </button>

                <hr>

                <div>
                    <label class="block text-xs font-semibold text-slate-600 mb-1">Pilih File Excel (.xlsx / .xls)</label>
                    <input type="file" id="excel-file-input" accept=".xlsx, .xls" class="w-full text-xs text-slate-500 file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100 border rounded-lg p-1">
                </div>

                <div class="pt-2 flex justify-end gap-2">
                    <button type="button" onclick="closeExcelModal()" class="px-4 py-2 border rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-50">Batal</button>
                    <button type="button" onclick="processExcelUpload()" class="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-semibold">Upload & Import</button>
                </div>
            </div>
        </div>
    </div>

    <!-- MODAL EDIT / TAMBAH BARANG MANUAL -->
    <div id="modal-barang" class="hidden fixed inset-0 z-50 flex items-center justify-center bg-slate-900 bg-opacity-50 p-4">
        <div class="bg-white rounded-xl shadow-xl max-w-md w-full overflow-hidden">
            <div class="bg-emerald-800 text-white px-5 py-3 flex justify-between items-center">
                <h3 id="modal-barang-title" class="font-bold text-sm">Tambah Data Barang</h3>
                <button onclick="closeBarangModal()" class="text-emerald-200 hover:text-white">&times;</button>
            </div>
            <form id="form-barang" onsubmit="handleSaveMasterBarang(event)" class="p-5 space-y-4">
                <input type="hidden" id="barang-id">
                <div>
                    <label class="block text-xs font-semibold text-slate-600 mb-1">Nama Barang</label>
                    <input type="text" id="barang-nama" required class="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500" placeholder="Contoh: Spidol Boardmarker">
                </div>
                <div>
                    <label class="block text-xs font-semibold text-slate-600 mb-1">Jenis / Kategori Barang</label>
                    <input type="text" id="barang-jenis" required class="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500" placeholder="Contoh: ATK / Alat Kebersihan">
                </div>
                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label class="block text-xs font-semibold text-slate-600 mb-1">Jumlah Stok</label>
                        <input type="number" id="barang-stok" required min="0" value="0" class="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500">
                    </div>
                    <div>
                        <label class="block text-xs font-semibold text-slate-600 mb-1">Satuan</label>
                        <input type="text" id="barang-satuan" required class="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500" placeholder="Pcs/Box/Pack">
                    </div>
                </div>
                <div class="pt-2 flex justify-end gap-2">
                    <button type="button" onclick="closeBarangModal()" class="px-4 py-2 border rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-50">Batal</button>
                    <button type="submit" class="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-semibold">Simpan Barang</button>
                </div>
            </form>
        </div>
    </div>

    <!-- MODAL EDIT / TAMBAH PETUGAS (DITAMBAHKAN INPUT ROLE) -->
    <div id="modal-petugas" class="hidden fixed inset-0 z-50 flex items-center justify-center bg-slate-900 bg-opacity-50 p-4">
        <div class="bg-white rounded-xl shadow-xl max-w-md w-full overflow-hidden">
            <div class="bg-emerald-800 text-white px-5 py-3 flex justify-between items-center">
                <h3 id="modal-title" class="font-bold text-sm">Tambah Akun Petugas</h3>
                <button onclick="closeUserModal()" class="text-emerald-200 hover:text-white">&times;</button>
            </div>
            <form id="form-petugas" onsubmit="handleSavePetugas(event)" class="p-5 space-y-4">
                <input type="hidden" id="petugas-id">
                <div>
                    <label class="block text-xs font-semibold text-slate-600 mb-1">Nama Lengkap Petugas</label>
                    <input type="text" id="petugas-nama" required class="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500" placeholder="Contoh: Ahmad Subagja, S.Pd">
                </div>
                <div>
                    <label class="block text-xs font-semibold text-slate-600 mb-1">Username</label>
                    <input type="text" id="petugas-username" required class="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500" placeholder="Username login">
                </div>
                <div>
                    <label class="block text-xs font-semibold text-slate-600 mb-1">Role / Peran</label>
                    <select id="petugas-role" required class="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500 bg-white">
                        <option value="pegawai">Petugas / Pegawai</option>
                        <option value="admin">Administrator</option>
                        <option value="pemantau">Pemantau</option>
                    </select>
                </div>
                <div>
                    <label class="block text-xs font-semibold text-slate-600 mb-1">Password</label>
                    <input type="password" id="petugas-password" class="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500" placeholder="Isi password baru">
                    <p id="password-hint" class="text-[10px] text-slate-400 mt-1 hidden">*Kosongkan jika tidak ingin mengubah password.</p>
                </div>
                <div class="pt-2 flex justify-end gap-2">
                    <button type="button" onclick="closeUserModal()" class="px-4 py-2 border rounded-lg text-xs font-semibold text-slate-600 hover:bg-slate-50">Batal</button>
                    <button type="submit" class="px-4 py-2 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-xs font-semibold">Simpan Akun</button>
                </div>
            </form>
        </div>
    </div>

    <!-- JAVASCRIPT APP LOGIC -->
    <script>
        let rawTransaksiData = [];
        let rawPetugasData = [];
        let masterBarangList = [];
        let currentUserRole = 'pegawai';

        document.addEventListener('DOMContentLoaded', () => {
            if (window.lucide) lucide.createIcons();
            document.getElementById('tanggal_pengambilan').valueAsDate = new Date();

            const isLoggedIn = sessionStorage.getItem('sipintar_logged_in') === 'true';
            const role = sessionStorage.getItem('sipintar_role');

            if (isLoggedIn) {
                if (role === 'pemantau') {
                    window.location.href = 'pemantau.php';
                    return;
                }
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
                    sessionStorage.setItem('sipintar_logged_in', 'true');
                    sessionStorage.setItem('sipintar_user_id', result.id);
                    sessionStorage.setItem('sipintar_user', result.nama);
                    sessionStorage.setItem('sipintar_username', result.username);
                    sessionStorage.setItem('sipintar_role', result.role || 'pegawai');
                    
                    if (result.role === 'pemantau') {
                        window.location.href = 'pemantau.php';
                    } else {
                        showDashboard();
                    }
                } else {
                    alert(result.message);
                }
            } catch (err) {
                alert('Gagal terhubung ke server PHP/MySQL!');
            }
        }

        async function showDashboard() {
            document.getElementById('login-screen').classList.add('hidden');
            document.getElementById('app-dashboard').classList.remove('hidden');
            
            currentUserRole = sessionStorage.getItem('sipintar_role') || 'pegawai';

            document.getElementById('user-name').innerText = sessionStorage.getItem('sipintar_user') || 'Petugas';
            document.getElementById('user-role-label').innerText = currentUserRole === 'admin' ? 'Administrator' : 'Petugas Inventaris';

            document.getElementById('text-tab-users').innerText = currentUserRole === 'admin' ? 'Kelola Petugas' : 'Kelola Akun';

            await loadMasterBarang();
            addBarangRow();
            loadTransaksiData();
            loadPetugasData();
            switchTab('form');
        }

        function handleLogout() {
            sessionStorage.clear();
            location.reload();
        }

        // --- MASTER BARANG FUNCTIONS ---
        async function loadMasterBarang() {
            try {
                const res = await fetch('api.php?action=get_barang');
                const result = await res.json();
                if (result.success) {
                    masterBarangList = result.data;
                    renderTableBarang();
                }
            } catch (err) {
                console.error('Gagal memuat barang:', err);
            }
        }

        function renderTableBarang() {
            const tbody = document.getElementById('barang-table-body');
            tbody.innerHTML = '';

            if (masterBarangList.length === 0) {
                tbody.innerHTML = `<tr><td colspan="6" class="p-4 text-center text-xs text-slate-400">Belum ada data barang. Silakan unggah Excel atau tambah manual.</td></tr>`;
                return;
            }

            masterBarangList.forEach((b, index) => {
                const tr = document.createElement('tr');
                tr.className = "border-b text-xs hover:bg-slate-50";
                tr.innerHTML = `
                    <td class="p-3 font-semibold">${index + 1}</td>
                    <td class="p-3 font-semibold text-slate-800">${b.nama_barang}</td>
                    <td class="p-3 text-slate-600">${b.jenis_barang}</td>
                    <td class="p-3 font-bold ${b.stok < 5 ? 'text-rose-600' : 'text-emerald-700'}">${b.stok}</td>
                    <td class="p-3">${b.satuan}</td>
                    <td class="p-3 text-center flex justify-center gap-2">
                        <button onclick="editBarang(${b.id}, '${b.nama_barang}', '${b.jenis_barang}', ${b.stok}, '${b.satuan}')" class="text-blue-600 hover:text-blue-800 p-1" title="Edit">
                            <i data-lucide="edit" class="w-4 h-4"></i>
                        </button>
                        <button onclick="hapusBarang(${b.id})" class="text-rose-600 hover:text-rose-800 p-1" title="Hapus">
                            <i data-lucide="trash-2" class="w-4 h-4"></i>
                        </button>
                    </td>
                `;
                tbody.appendChild(tr);
            });

            if (window.lucide) lucide.createIcons();
        }

        // --- UPLOAD TEMPLATE EXCEL FUNCTIONS ---
        function openExcelModal() {
            document.getElementById('excel-file-input').value = "";
            document.getElementById('modal-excel').classList.remove('hidden');
        }

        function closeExcelModal() {
            document.getElementById('modal-excel').classList.add('hidden');
        }

        function downloadExcelTemplate() {
            const templateData = [
                { nama_barang: 'Spidol Snowman Hitam', jenis_barang: 'ATK', stok: 12, satuan: 'Pcs' },
                { nama_barang: 'Kertas HVS A4 80gr', jenis_barang: 'ATK', stok: 5, satuan: 'Rim' },
                { nama_barang: 'Sapu Ijuk', jenis_barang: 'Kebersihan', stok: 10, satuan: 'Pcs' }
            ];

            const worksheet = XLSX.utils.json_to_sheet(templateData);
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, "Master Barang");

            worksheet['!cols'] = [{ wch: 30 }, { wch: 20 }, { wch: 10 }, { wch: 10 }];

            XLSX.writeFile(workbook, "template_master_barang_sipintar.xlsx");
        }

        function processExcelUpload() {
            const fileInput = document.getElementById('excel-file-input');
            const file = fileInput.files[0];

            if (!file) {
                alert('Silakan pilih berkas Excel terlebih dahulu!');
                return;
            }

            const reader = new FileReader();
            reader.onload = async function(e) {
                try {
                    const data = new Uint8Array(e.target.result);
                    const workbook = XLSX.read(data, { type: 'array' });
                    const firstSheet = workbook.SheetNames[0];
                    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheet]);

                    if (rows.length === 0) {
                        alert('Berkas Excel kosong atau format tidak sesuai!');
                        return;
                    }

                    const items = rows.map(r => ({
                        nama_barang: r.nama_barang || r['Nama Barang'] || '',
                        jenis_barang: r.jenis_barang || r['Jenis Barang'] || 'Umum',
                        stok: parseInt(r.stok || r['Stok'] || 0),
                        satuan: r.satuan || r['Satuan'] || 'Pcs'
                    })).filter(item => item.nama_barang !== '');

                    if (items.length === 0) {
                        alert('Tidak ditemukan data barang yang valid pada berkas Excel!');
                        return;
                    }

                    const res = await fetch('api.php?action=save_template_barang', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ items })
                    });

                    const result = await res.json();
                    if (result.success) {
                        alert('Berhasil mengimpor data dari Excel ke Master Barang SIPINTAR!');
                        closeExcelModal();
                        loadMasterBarang();
                    } else {
                        alert(result.message);
                    }
                } catch (err) {
                    alert('Gagal memproses berkas Excel. Pastikan format kolom sesuai!');
                }
            };
            reader.readAsArrayBuffer(file);
        }

        function openBarangModal() {
            document.getElementById('modal-barang-title').innerText = "Tambah Data Barang";
            document.getElementById('barang-id').value = "";
            document.getElementById('barang-nama').value = "";
            document.getElementById('barang-jenis').value = "";
            document.getElementById('barang-stok').value = "0";
            document.getElementById('barang-satuan').value = "";
            document.getElementById('modal-barang').classList.remove('hidden');
        }

        function closeBarangModal() {
            document.getElementById('modal-barang').classList.add('hidden');
        }

        function editBarang(id, nama, jenis, stok, satuan) {
            document.getElementById('modal-barang-title').innerText = "Edit Data Barang";
            document.getElementById('barang-id').value = id;
            document.getElementById('barang-nama').value = nama;
            document.getElementById('barang-jenis').value = jenis;
            document.getElementById('barang-stok').value = stok;
            document.getElementById('barang-satuan').value = satuan;
            document.getElementById('modal-barang').classList.remove('hidden');
        }

        async function handleSaveMasterBarang(e) {
            e.preventDefault();
            const id = document.getElementById('barang-id').value;
            const nama = document.getElementById('barang-nama').value;
            const jenis = document.getElementById('barang-jenis').value;
            const stok = document.getElementById('barang-stok').value;
            const satuan = document.getElementById('barang-satuan').value;

            try {
                const res = await fetch('api.php?action=save_barang', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id, nama_barang: nama, jenis_barang: jenis, stok, satuan })
                });
                const result = await res.json();
                if (result.success) {
                    alert(result.message);
                    closeBarangModal();
                    loadMasterBarang();
                } else {
                    alert(result.message);
                }
            } catch (err) {
                alert('Gagal menyimpan barang.');
            }
        }

        async function hapusBarang(id) {
            if (confirm('Yakin ingin menghapus barang ini dari master data?')) {
                try {
                    const res = await fetch('api.php?action=hapus_barang', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ id })
                    });
                    const result = await res.json();
                    if (result.success) {
                        alert(result.message);
                        loadMasterBarang();
                    } else {
                        alert(result.message);
                    }
                } catch (err) {
                    alert('Gagal menghapus barang.');
                }
            }
        }

        // --- DYNAMIC INPUT TRANSAKSI BARANG ---
        function addBarangRow() {
            const tbody = document.getElementById('table-items-body');
            const tr = document.createElement('tr');
            tr.className = "border-b text-xs";
            
            let options = '<option value="">-- Pilih Barang --</option>';
            masterBarangList.forEach(b => {
                options += `<option value="${b.nama_barang}" data-satuan="${b.satuan}" data-stok="${b.stok}">${b.nama_barang} [Jenis: ${b.jenis_barang}] (Stok: ${b.stok} ${b.satuan})</option>`;
            });

            tr.innerHTML = `
                <td class="p-2">
                    <select required class="item-nama w-full px-2 py-1.5 border rounded outline-none bg-white" onchange="updateSatuanAndStok(this)">
                        ${options}
                    </select>
                </td>
                <td class="p-2"><input type="number" min="1" value="1" required class="item-jumlah w-full px-2 py-1.5 border rounded outline-none text-center"></td>
                <td class="p-2"><input type="text" readonly class="item-satuan w-full px-2 py-1.5 border rounded bg-slate-100 outline-none" placeholder="Satuan"></td>
                <td class="p-2 text-center">
                    <button type="button" onclick="this.closest('tr').remove()" class="text-rose-600 hover:text-rose-800 p-1">
                        <i data-lucide="trash" class="w-4 h-4"></i>
                    </button>
                </td>
            `;
            tbody.appendChild(tr);
            if (window.lucide) lucide.createIcons();
        }

        function updateSatuanAndStok(selectElem) {
            const selectedOption = selectElem.options[selectElem.selectedIndex];
            const tr = selectElem.closest('tr');
            const satuanInput = tr.querySelector('.item-satuan');
            const jumlahInput = tr.querySelector('.item-jumlah');

            const satuan = selectedOption.getAttribute('data-satuan') || '';
            const maxStok = parseInt(selectedOption.getAttribute('data-stok') || 0);

            satuanInput.value = satuan;
            if (maxStok > 0) {
                jumlahInput.max = maxStok;
            } else {
                jumlahInput.removeAttribute('max');
            }
        }

        async function handleSaveTransaksi(e) {
            e.preventDefault();
            const rows = document.querySelectorAll('#table-items-body tr');
            if (rows.length === 0) {
                alert('Tambahkan minimal 1 barang!');
                return;
            }

            const items = [];
            let stokValid = true;

            rows.forEach(r => {
                const selectElem = r.querySelector('.item-nama');
                const selectedOption = selectElem.options[selectElem.selectedIndex];
                const maxStok = parseInt(selectedOption.getAttribute('data-stok') || 0);
                const jml = parseInt(r.querySelector('.item-jumlah').value);

                if (maxStok > 0 && jml > maxStok) {
                    alert(`Stok untuk barang "${selectElem.value}" tidak mencukupi! (Maksimal: ${maxStok})`);
                    stokValid = false;
                    return;
                }

                items.push({
                    nama_barang: selectElem.value,
                    jumlah: jml,
                    satuan: r.querySelector('.item-satuan').value
                });
            });

            if (!stokValid) return;

            const selectedDate = document.getElementById('tanggal_pengambilan').value;
            const dateStr = selectedDate.replace(/-/g, '');
            const randomNum = Math.floor(100 + Math.random() * 900);
            const kode = `BRG-${dateStr}-${randomNum}`;

            const payload = {
                kode_transaksi: kode,
                tanggal_pengambilan: selectedDate,
                nama_pengambil: document.getElementById('nama_pengambil').value,
                jabatan_unit: document.getElementById('jabatan_unit').value,
                keterangan: document.getElementById('keterangan').value,
                items: items
            };

            try {
                const res = await fetch('api.php?action=simpan_transaksi', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                const result = await res.json();

                if (result.success) {
                    alert('Transaksi Penerimaan Berhasil Disimpan!');
                    document.getElementById('form-pengambilan').reset();
                    document.getElementById('tanggal_pengambilan').valueAsDate = new Date();
                    document.getElementById('table-items-body').innerHTML = '';
                    await loadMasterBarang();
                    addBarangRow();
                    loadTransaksiData();
                    switchTab('history');
                } else {
                    alert(result.message);
                }
            } catch (err) {
                alert('Gagal menyimpan data ke database.');
            }
        }

        async function loadTransaksiData() {
            try {
                const res = await fetch('api.php?action=get_transaksi');
                const result = await res.json();
                if (result.success) {
                    rawTransaksiData = result.data;
                    renderTableHistory();
                }
            } catch (err) {
                console.error('Gagal memuat data:', err);
            }
        }

        function getFilteredData() {
            const search = document.getElementById('filter-search').value.toLowerCase();
            const bulan = document.getElementById('filter-bulan').value;
            const tahun = document.getElementById('filter-tahun').value;

            return rawTransaksiData.filter(item => {
                const itemDate = new Date(item.tanggal_pengambilan);
                const itemBulan = String(itemDate.getMonth() + 1).padStart(2, '0');
                const itemTahun = String(itemDate.getFullYear());

                const matchSearch = item.kode_transaksi.toLowerCase().includes(search) ||
                                    item.nama_pengambil.toLowerCase().includes(search) ||
                                    item.jabatan_unit.toLowerCase().includes(search) ||
                                    (item.items && item.items.some(i => i.nama_barang.toLowerCase().includes(search)));

                const matchBulan = !bulan || itemBulan === bulan;
                const matchTahun = !tahun || itemTahun === tahun;

                return matchSearch && matchBulan && matchTahun;
            });
        }

        function renderTableHistory() {
            const tbody = document.getElementById('history-table-body');
            const filtered = getFilteredData();
            tbody.innerHTML = '';

            if (filtered.length === 0) {
                tbody.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-xs text-slate-400">Tidak ada data transaksi yang cocok.</td></tr>`;
                return;
            }

            filtered.forEach(item => {
                const barangList = item.items && item.items.length > 0 
                    ? item.items.map(i => `• ${i.nama_barang} (${i.jumlah} ${i.satuan})`).join('<br>') 
                    : '-';

                const tr = document.createElement('tr');
                tr.className = "border-b text-xs hover:bg-slate-50";
                tr.innerHTML = `
                    <td class="p-3 font-semibold text-emerald-800">${item.kode_transaksi}</td>
                    <td class="p-3">${item.tanggal_pengambilan}</td>
                    <td class="p-3"><strong>${item.nama_pengambil}</strong><br><span class="text-[10px] text-slate-500">${item.jabatan_unit}</span></td>
                    <td class="p-3">${barangList}</td>
                    <td class="p-3 text-slate-500">${item.keterangan || '-'}</td>
                `;
                tbody.appendChild(tr);
            });
        }

        async function handleHapusTerfilter() {
            const filtered = getFilteredData();
            if (filtered.length === 0) {
                alert('Tidak ada data yang cocok dengan filter aktif!');
                return;
            }

            if (confirm(`Apakah Anda yakin ingin MENGHAPUS PERMANEN ${filtered.length} data penerimaan yang sedang tampil?`)) {
                const kodes = filtered.map(f => f.kode_transaksi);
                try {
                    const res = await fetch('api.php?action=hapus_transaksi', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ kodes: kodes })
                    });
                    const result = await res.json();
                    if (result.success) {
                        alert(result.message);
                        loadTransaksiData();
                    } else {
                        alert(result.message);
                    }
                } catch (err) {
                    alert('Gagal menghapus data.');
                }
            }
        }

        async function loadPetugasData() {
            try {
                const res = await fetch('api.php?action=get_petugas');
                const result = await res.json();
                if (result.success) {
                    rawPetugasData = result.data;
                    renderTablePetugas();
                }
            } catch (err) {
                console.error('Gagal memuat petugas:', err);
            }
        }

        function renderTablePetugas() {
            const containerSection = document.getElementById('section-users');
            const myId = sessionStorage.getItem('sipintar_user_id');
            const myName = sessionStorage.getItem('sipintar_user');
            const myUsername = sessionStorage.getItem('sipintar_username');

            if (currentUserRole === 'pegawai') {
                containerSection.innerHTML = `
                    <div class="max-w-md mx-auto bg-white p-2">
                        <div class="mb-4 pb-2 border-b">
                            <h2 class="text-base font-bold text-slate-800">Edit Akun Saya</h2>
                            <p class="text-xs text-slate-500">Perbarui nama lengkap, username, atau password Anda.</p>
                        </div>
                        <form onsubmit="handleSavePetugasLangsung(event)" class="space-y-4">
                            <input type="hidden" id="pegawai-edit-id" value="${myId}">
                            <div>
                                <label class="block text-xs font-semibold text-slate-600 mb-1">Nama Lengkap</label>
                                <input type="text" id="pegawai-edit-nama" value="${myName}" required class="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500">
                            </div>
                            <div>
                                <label class="block text-xs font-semibold text-slate-600 mb-1">Username</label>
                                <input type="text" id="pegawai-edit-username" value="${myUsername}" required class="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500">
                            </div>
                            <div>
                                <label class="block text-xs font-semibold text-slate-600 mb-1">Password Baru</label>
                                <input type="password" id="pegawai-edit-password" placeholder="••••••••" class="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500">
                                <p class="text-[10px] text-slate-400 mt-1">*Kosongkan jika tidak ingin mengubah password.</p>
                            </div>
                            <button type="submit" class="w-full bg-emerald-700 hover:bg-emerald-800 text-white py-2 rounded-lg font-semibold text-xs transition shadow">
                                Simpan Perubahan Akun
                            </button>
                        </form>
                    </div>
                `;
                return;
            }

            containerSection.innerHTML = `
                <div class="flex justify-between items-center mb-6 pb-4 border-b">
                    <div>
                        <h2 class="text-base font-bold text-slate-800">Kelola Akun Petugas</h2>
                        <p class="text-xs text-slate-500">Tambah, edit, atau hapus akun petugas pengakses sistem.</p>
                    </div>
                    <button onclick="openUserModal()" class="bg-emerald-700 hover:bg-emerald-800 text-white px-3.5 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 shadow transition">
                        <i data-lucide="user-plus" class="w-4 h-4"></i> Tambah Akun Petugas
                    </button>
                </div>

                <div class="overflow-x-auto border rounded-lg">
                    <table class="w-full text-sm text-left">
                        <thead class="bg-slate-100 border-b text-xs font-semibold text-slate-600">
                            <tr>
                                <th class="p-3">No</th>
                                <th class="p-3">Nama Lengkap</th>
                                <th class="p-3">Username</th>
                                <th class="p-3">Role</th>
                                <th class="p-3 w-32 text-center">Aksi</th>
                            </tr>
                        </thead>
                        <tbody id="petugas-table-body"></tbody>
                    </table>
                </div>
            `;

            const tbody = document.getElementById('petugas-table-body');
            tbody.innerHTML = '';

            rawPetugasData.forEach((p, index) => {
                const tr = document.createElement('tr');
                tr.className = "border-b text-xs hover:bg-slate-50";
                tr.innerHTML = `
                    <td class="p-3 font-semibold">${index + 1}</td>
                    <td class="p-3 font-medium text-slate-800">${p.nama_lengkap}</td>
                    <td class="p-3"><code class="bg-slate-100 px-2 py-0.5 rounded border">${p.username}</code></td>
                    <td class="p-3"><span class="capitalize px-2 py-0.5 rounded text-[11px] font-semibold ${p.role === 'admin' ? 'bg-purple-100 text-purple-700' : 'bg-emerald-100 text-emerald-700'}">${p.role || 'pegawai'}</span></td>
                    <td class="p-3 text-center flex justify-center gap-2">
                        <button onclick="editPetugas(${p.id}, '${p.nama_lengkap}', '${p.username}', '${p.role || 'pegawai'}')" class="text-blue-600 hover:text-blue-800 p-1" title="Edit">
                            <i data-lucide="edit" class="w-4 h-4"></i>
                        </button>
                        <button onclick="hapusPetugas(${p.id})" class="text-rose-600 hover:text-rose-800 p-1" title="Hapus">
                            <i data-lucide="trash-2" class="w-4 h-4"></i>
                        </button>
                    </td>
                `;
                tbody.appendChild(tr);
            });

            if (window.lucide) lucide.createIcons();
        }

        async function handleSavePetugasLangsung(e) {
            e.preventDefault();
            const id = document.getElementById('pegawai-edit-id').value;
            const nama = document.getElementById('pegawai-edit-nama').value;
            const username = document.getElementById('pegawai-edit-username').value;
            const password = document.getElementById('pegawai-edit-password').value;

            try {
                const res = await fetch('api.php?action=save_petugas', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        id, 
                        nama_lengkap: nama, 
                        username, 
                        password,
                        current_user_id: sessionStorage.getItem('sipintar_user_id'),
                        current_user_role: sessionStorage.getItem('sipintar_role')
                    })
                });
                const result = await res.json();
                if (result.success) {
                    alert(result.message);
                    sessionStorage.setItem('sipintar_user', nama);
                    sessionStorage.setItem('sipintar_username', username);
                    document.getElementById('user-name').innerText = nama;
                    document.getElementById('pegawai-edit-password').value = '';
                } else {
                    alert(result.message);
                }
            } catch (err) {
                alert('Gagal memperbarui akun.');
            }
        }

        function openUserModal() {
            document.getElementById('modal-title').innerText = "Tambah Akun Petugas";
            document.getElementById('petugas-id').value = "";
            document.getElementById('petugas-nama').value = "";
            document.getElementById('petugas-username').value = "";
            document.getElementById('petugas-role').value = "pegawai";
            document.getElementById('petugas-password').value = "";
            document.getElementById('petugas-password').required = true;
            document.getElementById('password-hint').classList.add('hidden');
            document.getElementById('modal-petugas').classList.remove('hidden');
        }

        function closeUserModal() {
            document.getElementById('modal-petugas').classList.add('hidden');
        }

        function editPetugas(id, nama, username, role) {
            document.getElementById('modal-title').innerText = "Edit Akun Petugas";
            document.getElementById('petugas-id').value = id;
            document.getElementById('petugas-nama').value = nama;
            document.getElementById('petugas-username').value = username;
            document.getElementById('petugas-role').value = role || 'pegawai';
            document.getElementById('petugas-password').value = "";
            document.getElementById('petugas-password').required = false;
            document.getElementById('password-hint').classList.remove('hidden');
            document.getElementById('modal-petugas').classList.remove('hidden');
        }

        async function handleSavePetugas(e) {
            e.preventDefault();
            const id = document.getElementById('petugas-id').value;
            const nama = document.getElementById('petugas-nama').value;
            const username = document.getElementById('petugas-username').value;
            const role = document.getElementById('petugas-role').value;
            const password = document.getElementById('petugas-password').value;

            try {
                const res = await fetch('api.php?action=save_petugas', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ 
                        id, 
                        nama_lengkap: nama, 
                        username, 
                        role,
                        password,
                        current_user_id: sessionStorage.getItem('sipintar_user_id'),
                        current_user_role: sessionStorage.getItem('sipintar_role')
                    })
                });
                const result = await res.json();
                if (result.success) {
                    alert(result.message);
                    closeUserModal();
                    loadPetugasData();
                } else {
                    alert(result.message);
                }
            } catch (err) {
                alert('Gagal menyimpan petugas.');
            }
        }

        async function hapusPetugas(id) {
            if (confirm('Yakin ingin menghapus akun petugas ini?')) {
                try {
                    const res = await fetch('api.php?action=hapus_petugas', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ id })
                    });
                    const result = await res.json();
                    if (result.success) {
                        alert(result.message);
                        loadPetugasData();
                    } else {
                        alert(result.message);
                    }
                } catch (err) {
                    alert('Gagal menghapus petugas.');
                }
            }
        }

        function exportPDF() {
            const filtered = getFilteredData();
            if (filtered.length === 0) {
                alert('Tidak ada data untuk dicetak!');
                return;
            }

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
            doc.text('Laporan Bukti Penerimaan Barang Inventaris (SIPINTAR)', 110, 20, { align: 'center' });
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
                    item.tanggal_pengambilan,
                    `${item.nama_pengambil}\n(${item.jabatan_unit})`,
                    barangStr,
                    item.keterangan || '-'
                ]);
            });

            doc.autoTable({
                startY: 29,
                head: [['No', 'Kode', 'Tanggal', 'Penerima', 'Rincian Barang', 'Ket']],
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

            doc.save(`Laporan_SIPINTAR_Penerimaan_${new Date().toISOString().slice(0, 10)}.pdf`);
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
                    'Tanggal Penerimaan': item.tanggal_pengambilan,
                    'Nama Penerima': item.nama_pengambil,
                    'Jabatan / Unit Kerja': item.jabatan_unit,
                    'Rincian Barang': barangStr,
                    'Keterangan': item.keterangan || '-'
                });
            });

            const worksheet = XLSX.utils.json_to_sheet(excelData);
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, "Laporan Penerimaan");

            worksheet['!cols'] = [
                { wch: 5 },
                { wch: 20 },
                { wch: 18 },
                { wch: 22 },
                { wch: 20 },
                { wch: 45 },
                { wch: 25 }
            ];

            XLSX.writeFile(workbook, `Laporan_SIPINTAR_Penerimaan_${new Date().toISOString().slice(0, 10)}.xlsx`);
        }

        function switchTab(tab) {
            document.getElementById('section-form').classList.add('hidden');
            document.getElementById('section-master-barang').classList.add('hidden');
            document.getElementById('section-history').classList.add('hidden');
            document.getElementById('section-users').classList.add('hidden');

            document.getElementById('tab-form').className = "px-4 py-2.5 text-sm font-semibold border-b-2 border-transparent text-slate-500 hover:text-slate-700 flex items-center gap-2 whitespace-nowrap";
            document.getElementById('tab-master-barang').className = "px-4 py-2.5 text-sm font-semibold border-b-2 border-transparent text-slate-500 hover:text-slate-700 flex items-center gap-2 whitespace-nowrap";
            document.getElementById('tab-history').className = "px-4 py-2.5 text-sm font-semibold border-b-2 border-transparent text-slate-500 hover:text-slate-700 flex items-center gap-2 whitespace-nowrap";
            document.getElementById('tab-users').className = "px-4 py-2.5 text-sm font-semibold border-b-2 border-transparent text-slate-500 hover:text-slate-700 flex items-center gap-2 whitespace-nowrap";

            if (tab === 'form') {
                document.getElementById('section-form').classList.remove('hidden');
                document.getElementById('tab-form').className = "px-4 py-2.5 text-sm font-semibold border-b-2 border-emerald-600 text-emerald-800 flex items-center gap-2 whitespace-nowrap";
            } else if (tab === 'master_barang') {
                document.getElementById('section-master-barang').classList.remove('hidden');
                document.getElementById('tab-master-barang').className = "px-4 py-2.5 text-sm font-semibold border-b-2 border-emerald-600 text-emerald-800 flex items-center gap-2 whitespace-nowrap";
            } else if (tab === 'history') {
                document.getElementById('section-history').classList.remove('hidden');
                document.getElementById('tab-history').className = "px-4 py-2.5 text-sm font-semibold border-b-2 border-emerald-600 text-emerald-800 flex items-center gap-2 whitespace-nowrap";
            } else if (tab === 'users') {
                document.getElementById('section-users').classList.remove('hidden');
                document.getElementById('tab-users').className = "px-4 py-2.5 text-sm font-semibold border-b-2 border-emerald-600 text-emerald-800 flex items-center gap-2 whitespace-nowrap";
            }
        }
    </script>
</body>
</html>