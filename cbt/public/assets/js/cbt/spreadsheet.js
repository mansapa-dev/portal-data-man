// Spreadsheet export, template generation, and upload parsing helpers.
function exportToExcel(filename, sheetName, headers, dataRows) {
  if (!dataRows || dataRows.length === 0) { showCustomAlert('Peringatan', 'Tidak ada data untuk diexport.'); return; }
  let wsData = [headers, ...dataRows];
  let wb = XLSX.utils.book_new();
  let ws = XLSX.utils.aoa_to_sheet(wsData);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename);
}

function downloadTemplateSiswa() {
  let headers = ['nisn', 'nama', 'kelas', 'tingkat', 'pin', 'tahun_ajaran'];
  let sampleData = [
    ['0091234567', 'Ahmad Fulan', 'X MIPA 1', 'X', '', '2025/2026'],
    ['0087654321', 'Budi Santoso', 'XI IPA 1', 'XI', '', '2025/2026']
  ];
  exportToExcel('template_siswa.xlsx', 'Template Siswa', headers, sampleData);
}

function downloadTemplateSoal() {
  let headers = ['nama_ujian', 'pertanyaan', 'url_gambar', 'opsi_a', 'opsi_b', 'opsi_c', 'opsi_d', 'opsi_e', 'jawaban_benar', 'poin'];
  let sampleData = [
    ['Kimia Kelas XII', 'Perhatikan gambar berikut. Apakah nama struktur senyawa di atas?', 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/87/Ethanol_flat_structure.png/220px-Ethanol_flat_structure.png', 'Etanol', 'Metanol', 'Propanol', 'Butanol', 'Pentanol', 'A', 1],
    ['Biologi Kelas X', 'Organel sel yang berfungsi untuk respirasi seluler dan menghasilkan ATP adalah...', '', 'Mitokondria', 'Ribosom', 'Lisosom', 'Badan Golgi', 'Kloroplas', 'A', 1]
  ];
  exportToExcel('template_soal.xlsx', 'Template Soal', headers, sampleData);
}

function downloadTemplateAkun() {
  let headers = ['username', 'nama_lengkap', 'role', 'password'];
  let sampleData = [['guru_kimia', 'Dra. Hj. Nurul', 'guru', '123456']];
  exportToExcel('template_akun_pengguna.xlsx', 'Template Akun', headers, sampleData);
}

function handleExcelUpload(input, callback) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const data = new Uint8Array(e.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const json = XLSX.utils.sheet_to_json(worksheet, { defval: "" });
      callback(json);
    } catch (err) {
      showCustomAlert('Gagal', 'Gagal membaca file Excel: ' + err.message);
      input.value = '';
    }
  };
  reader.readAsArrayBuffer(file);
}
