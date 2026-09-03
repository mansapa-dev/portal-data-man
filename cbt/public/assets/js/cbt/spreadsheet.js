// Spreadsheet export, template generation, and upload parsing helpers.
function exportToExcel(filename, sheetName, headers, dataRows) {
  if (!dataRows || dataRows.length === 0) {
    showCustomAlert('Peringatan', 'Tidak ada data untuk diexport.');
    return;
  }
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

function downloadTemplateSoal(namaMapel = '') {
  let headers = ['nama_ujian', 'pertanyaan', 'opsi_a', 'opsi_b', 'opsi_c', 'opsi_d', 'opsi_e', 'jawaban_benar', 'poin', 'gambar_keterangan'];
  let sampleData = [
    [
      namaMapel ? `${namaMapel} Kelas X` : 'Kimia Kelas XII',
      'Perhatikan gambar di samping. Apakah nama struktur senyawa pada soal ini?',
      'Etanol',
      'Metanol',
      'Propanol',
      'Butanol',
      'Pentanol',
      'A',
      1,
      '(Opsional: Anda bisa langsung Insert -> Picture gambar ke baris ini di Excel)'
    ],
    [
      namaMapel ? `${namaMapel} Kelas X` : 'Biologi Kelas X',
      'Organel sel yang berfungsi sebagai tempat respirasi aerob dan penghasil energi ATP adalah...',
      'Mitokondria',
      'Ribosom',
      'Lisosom',
      'Badan Golgi',
      'Kloroplas',
      'A',
      1,
      '(Kosongkan jika soal teks biasa tanpa gambar)'
    ]
  ];
  const filename = namaMapel ? `template_soal_${namaMapel.toLowerCase().replace(/\s+/g, '_')}.xlsx` : 'template_soal.xlsx';
  exportToExcel(filename, 'Template Soal', headers, sampleData);
}

function downloadTemplateAkun() {
  let headers = ['username', 'nama_lengkap', 'role', 'password'];
  let sampleData = [['guru_kimia', 'Dra. Hj. Nurul', 'guru', '123456']];
  exportToExcel('template_akun_pengguna.xlsx', 'Template Akun', headers, sampleData);
}

// EXTRACT EMBEDDED IMAGES DIRECTLY INSERTED INSIDE EXCEL (.XLSX)
async function extractImagesFromExcel(file) {
  const rowImages = {};
  if (typeof JSZip === 'undefined') return rowImages;

  try {
    const zip = await JSZip.loadAsync(file);

    // Look for drawings XML and relationship files
    const drawingFiles = zip.file(/^xl\/drawings\/drawing\d+\.xml$/i);
    const relsFiles = zip.file(/^xl\/drawings\/_rels\/drawing\d+\.xml\.rels$/i);

    if (drawingFiles.length === 0 || relsFiles.length === 0) {
      // Fallback: Check if there are any media files inside the archive
      const mediaFiles = zip.file(/^xl\/media\/.+$/i);
      if (mediaFiles && mediaFiles.length > 0) {
        for (let i = 0; i < mediaFiles.length; i++) {
          const mFile = mediaFiles[i];
          const ext = mFile.name.split('.').pop().toLowerCase();
          const mime = ext === 'png' ? 'image/png' : (ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : (ext === 'webp' ? 'image/webp' : 'image/png'));
          const base64 = await mFile.async('base64');
          rowImages[i] = `data:${mime};base64,${base64}`;
        }
      }
      return rowImages;
    }

    const drawingXmlStr = await drawingFiles[0].async('string');
    const drawingRelsStr = await relsFiles[0].async('string');

    // Parse relationships (rId -> image target path)
    const parser = new DOMParser();
    const relsDoc = parser.parseFromString(drawingRelsStr, 'text/xml');
    const rels = {};
    const relElements = relsDoc.getElementsByTagName('Relationship');
    for (let i = 0; i < relElements.length; i++) {
      const el = relElements[i];
      const id = el.getAttribute('Id');
      let target = el.getAttribute('Target') || '';
      target = target.replace('../', 'xl/');
      rels[id] = target;
    }

    // Parse drawing cell anchors (mapping to row)
    const drawDoc = parser.parseFromString(drawingXmlStr, 'text/xml');
    const anchors = Array.from(drawDoc.getElementsByTagNameNS('*', 'twoCellAnchor'))
      .concat(Array.from(drawDoc.getElementsByTagNameNS('*', 'oneCellAnchor')))
      .concat(Array.from(drawDoc.getElementsByTagName('xdr:twoCellAnchor')))
      .concat(Array.from(drawDoc.getElementsByTagName('xdr:oneCellAnchor')));

    for (let i = 0; i < anchors.length; i++) {
      const anchor = anchors[i];
      const fromEl = anchor.getElementsByTagNameNS('*', 'from')[0] || anchor.getElementsByTagName('xdr:from')[0];
      const blipEl = anchor.getElementsByTagNameNS('*', 'blip')[0] || anchor.getElementsByTagName('a:blip')[0];

      if (fromEl && blipEl) {
        const rowEl = fromEl.getElementsByTagNameNS('*', 'row')[0] || fromEl.getElementsByTagName('xdr:row')[0];
        const rEmbed = blipEl.getAttribute('r:embed') || blipEl.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'embed') || blipEl.getAttribute('embed');

        if (rowEl && rEmbed && rels[rEmbed]) {
          const excelRowIndex = parseInt(rowEl.textContent, 10);
          const dataRowIndex = excelRowIndex >= 1 ? excelRowIndex - 1 : excelRowIndex;
          const mediaPath = rels[rEmbed];
          const mediaFile = zip.file(mediaPath) || zip.file(new RegExp(mediaPath.split('/').pop() + '$', 'i'))[0];

          if (mediaFile) {
            const ext = mediaFile.name.split('.').pop().toLowerCase();
            const mime = ext === 'png' ? 'image/png' : (ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : (ext === 'webp' ? 'image/webp' : 'image/png'));
            const base64 = await mediaFile.async('base64');
            rowImages[dataRowIndex] = `data:${mime};base64,${base64}`;
          }
        }
      }
    }
  } catch (err) {
    console.warn('Excel image extraction notice:', err);
  }
  return rowImages;
}

async function handleExcelUpload(input, callback) {
  const file = input.files[0];
  if (!file) return;

  try {
    // 1. Extract directly embedded images from Excel
    const embeddedImages = await extractImagesFromExcel(file);

    // 2. Read sheet rows
    const reader = new FileReader();
    reader.onload = function (e) {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const json = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

        // Merge extracted images into question rows
        json.forEach((row, idx) => {
          if (embeddedImages[idx] && !row.url_gambar && !row.gambar_soal) {
            row.url_gambar = embeddedImages[idx];
          }
        });

        callback(json);
      } catch (err) {
        showCustomAlert('Gagal', 'Gagal membaca file Excel: ' + err.message);
        input.value = '';
      }
    };
    reader.readAsArrayBuffer(file);
  } catch (err) {
    showCustomAlert('Gagal', 'Gagal memproses file Excel: ' + err.message);
    input.value = '';
  }
}
