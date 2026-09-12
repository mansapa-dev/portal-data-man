<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Form Penerimaan Barang - SIPINTAR</title>
    <!-- Tailwind CSS -->
    <script src="https://cdn.tailwindcss.com"></script>
    <!-- Lucide Icons -->
    <script src="https://unpkg.com/lucide@latest"></script>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');
        body { font-family: 'Inter', sans-serif; }
    </style>
</head>
<body class="bg-slate-100 min-h-screen text-slate-800 p-4 md:p-8">

    <div class="max-w-3xl mx-auto bg-white rounded-xl shadow-md border border-slate-200 overflow-hidden">
        <!-- HEADER -->
        <div class="bg-emerald-800 p-6 text-white text-center">
            <div class="w-16 h-16 bg-white rounded-full flex items-center justify-center mx-auto mb-3 p-1 shadow-md overflow-hidden">
                <img src="logo.png" alt="Logo MAN 1 Palembang" class="w-full h-full object-contain rounded-full" onerror="this.onerror=null; this.parentElement.innerHTML='<div class=\'text-emerald-800 font-bold text-xs text-center\'>MAN 1</div>';">
            </div>
            <h1 class="text-xl font-bold">SIPINTAR - MAN 1 Palembang</h1>
            <p class="text-emerald-100 text-xs mt-1">Sistem Pengelolaan Inventaris MAN 1 Palembang</p>
        </div>

        <!-- FORM PENERIMAAN -->
        <form id="form-pengambilan" onsubmit="handleSaveTransaksi(event)" class="p-6 space-y-4">
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
                <textarea id="keterangan" rows="2" placeholder="Catatan atau sumber barang..." class="w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-emerald-500"></textarea>
            </div>

            <div class="pt-3 flex justify-end items-center">
                <button type="submit" class="bg-emerald-700 hover:bg-emerald-800 text-white px-5 py-2.5 rounded-lg font-semibold text-sm shadow transition flex items-center gap-2">
                    <i data-lucide="save" class="w-4 h-4"></i> Kirim Formulir Penerimaan
                </button>
            </div>
        </form>
    </div>

    <script>
        let masterBarangList = [];

        document.addEventListener('DOMContentLoaded', async () => {
            if (window.lucide) lucide.createIcons();
            document.getElementById('tanggal_pengambilan').valueAsDate = new Date();
            await loadMasterBarang();
            addBarangRow();
        });

        async function loadMasterBarang() {
            try {
                const res = await fetch('api.php?action=get_barang');
                const result = await res.json();
                if (result.success) {
                    masterBarangList = result.data;
                }
            } catch (err) {
                console.error('Gagal memuat barang:', err);
            }
        }

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
                    alert('Data penerimaan barang berhasil dikirim!');
                    document.getElementById('form-pengambilan').reset();
                    document.getElementById('tanggal_pengambilan').valueAsDate = new Date();
                    document.getElementById('table-items-body').innerHTML = '';
                    await loadMasterBarang();
                    addBarangRow();
                } else {
                    alert(result.message);
                }
            } catch (err) {
                alert('Gagal menyimpan data ke database.');
            }
        }
    </script>
</body>
</html>