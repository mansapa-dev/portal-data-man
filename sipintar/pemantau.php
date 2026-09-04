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
</head>
<body class="bg-slate-100 min-h-screen text-slate-800">

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
            <button onclick="switchTab('history')" id="tab-history" class="px-4 py-2.5 text-sm font-semibold border-b-2 border-emerald-600 text-emerald-800 flex items-center gap-2 whitespace-nowrap">
                <i data-lucide="history" class="w-4 h-4"></i> Riwayat & Laporan Penerimaan
            </button>
            <button onclick="switchTab('master_barang')" id="tab-master-barang" class="px-4 py-2.5 text-sm font-semibold border-b-2 border-transparent text-slate-500 hover:text-slate-700 flex items-center gap-2 whitespace-nowrap">
                <i data-lucide="package" class="w-4 h-4"></i> Data Stok Barang
            </button>
        </div>

        <!-- SECTION 1: RIWAYAT & LAPORAN REKAP -->
        <section id="section-history" class="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <div class="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 pb-4 border-b">
                <div>
                    <h2 class="text-base font-bold text-slate-800">Riwayat Penerimaan Barang</h2>
                    <p class="text-xs text-slate-500">Pemantauan data penerimaan barang inventaris serta pencetakan laporan.</p>
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

    <!-- JAVASCRIPT LOGIC -->
    <script>
        let rawTransaksiData = [];
        let masterBarangList = [];

        document.addEventListener('DOMContentLoaded', () => {
            if (window.lucide) lucide.createIcons();

            const isLoggedIn = sessionStorage.getItem('sipintar_logged_in') === 'true';
            const role = sessionStorage.getItem('sipintar_role');

            if (!isLoggedIn || role !== 'pemantau') {
                window.location.href = 'index.php';
                return;
            }

            const userName = sessionStorage.getItem('sipintar_user') || 'Pemantau';
            document.getElementById('user-name').innerText = userName;

            loadMasterBarang();
            loadTransaksiData();
        });

        function handleLogout() {
            sessionStorage.clear();
            window.location.href = 'index.php';
        }

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
                tbody.innerHTML = `<tr><td colspan="5" class="p-4 text-center text-xs text-slate-400">Belum ada data barang.</td></tr>`;
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
                `;
                tbody.appendChild(tr);
            });
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
            document.getElementById('section-history').classList.add('hidden');
            document.getElementById('section-master-barang').classList.add('hidden');

            document.getElementById('tab-history').className = "px-4 py-2.5 text-sm font-semibold border-b-2 border-transparent text-slate-500 hover:text-slate-700 flex items-center gap-2 whitespace-nowrap";
            document.getElementById('tab-master-barang').className = "px-4 py-2.5 text-sm font-semibold border-b-2 border-transparent text-slate-500 hover:text-slate-700 flex items-center gap-2 whitespace-nowrap";

            if (tab === 'history') {
                document.getElementById('section-history').classList.remove('hidden');
                document.getElementById('tab-history').className = "px-4 py-2.5 text-sm font-semibold border-b-2 border-emerald-600 text-emerald-800 flex items-center gap-2 whitespace-nowrap";
            } else if (tab === 'master_barang') {
                document.getElementById('section-master-barang').classList.remove('hidden');
                document.getElementById('tab-master-barang').className = "px-4 py-2.5 text-sm font-semibold border-b-2 border-emerald-600 text-emerald-800 flex items-center gap-2 whitespace-nowrap";
            }
        }
    </script>
</body>
</html>