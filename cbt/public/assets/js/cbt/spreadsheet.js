// Spreadsheet export, template generation, and upload parsing helpers.
function exportToExcel(filename, sheetName, headers, dataRows) {
  if (!dataRows || dataRows.length === 0) {
    showCustomAlert('Peringatan', 'Tidak ada data untuk diexport.');
    return;
  }
  let wsData = [headers, ...dataRows];
  let wb = XLSX.utils.book_new();
  let ws = XLSX.utils.aoa_to_sheet(wsData);
  ws['!cols'] = headers.map((header, column) => ({ wch: Math.min(42, Math.max(String(header).length + 2, ...dataRows.map(row => String(row[column] ?? '').length + 2))) }));
  if (ws['!ref']) ws['!autofilter'] = { ref: ws['!ref'] };
  const centered = /^(no\.?|nomor|tingkat|kelas|semester|nilai|benar|salah|status|waktu|tahun)/i;
  wsData.forEach((row,rowIndex) => row.forEach((_,columnIndex) => { const cell=ws[XLSX.utils.encode_cell({r:rowIndex,c:columnIndex})];if(!cell)return;cell.s={alignment:{horizontal:rowIndex===0||centered.test(String(headers[columnIndex]||''))?'center':'left',vertical:'center',wrapText:true},font:rowIndex===0?{bold:true}:undefined}; }));
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename, { cellStyles: true });
}

function downloadTemplateSiswa() {
  let headers = ['nisn', 'nama', 'kelas', 'tingkat', 'pin', 'tahun_ajaran'];
  let sampleData = [
    ['0091234567', 'Ahmad Fulan', 'X MIPA 1', 'X', '', '2025/2026'],
    ['0087654321', 'Budi Santoso', 'XI IPA 1', 'XI', '', '2025/2026']
  ];
  exportToExcel('template_siswa.xlsx', 'Template Siswa', headers, sampleData);
}

function downloadTemplateSoal(namaMapel = '', ujianList = []) {
  let headers = ['ujian_id', 'nama_ujian', 'no', 'tipe_soal', 'pertanyaan', 'gambar_soal', 'opsi_a', 'gambar_a', 'opsi_b', 'gambar_b', 'opsi_c', 'gambar_c', 'opsi_d', 'gambar_d', 'opsi_e', 'gambar_e', 'jawaban_benar', 'poin', 'pembahasan', 'gambar_pembahasan'];
  const selectedExam = Array.isArray(ujianList) && ujianList.length ? ujianList[0] : null;
  let sampleData = [
    [
      selectedExam?.id || '',
      selectedExam?.nama_ujian || (namaMapel ? '' : 'Kimia Kelas XII'),
      1,
      'PILIHAN_GANDA',
      'Nilai dari \\(x^2 + H_2O\\) adalah ... (gambar dapat ditempel langsung pada cell ini)',
      '',
      'Etanol',
      '',
      'Metanol',
      '',
      'Propanol',
      '',
      'Butanol',
      '',
      'Pentanol',
      '',
      'A',
      1,
      'Pembahasan dapat berisi equation \\(x^2\\).',
      ''
    ],
    [
      selectedExam?.id || '',
      selectedExam?.nama_ujian || (namaMapel ? '' : 'Biologi Kelas X'),
      2,
      'PILIHAN_GANDA',
      'Tuliskan pangkat dengan <sup>2</sup>, indeks dengan <sub>2</sub>, atau equation \\(E=mc^2\\).',
      '',
      'Mitokondria',
      '',
      'Ribosom',
      '',
      'Lisosom',
      '',
      'Badan Golgi',
      '',
      'Kloroplas',
      '',
      'A',
      1,
      '',
      ''
    ]
  ];
  const filename = namaMapel ? `template_soal_${namaMapel.toLowerCase().replace(/\s+/g, '_')}.xlsx` : 'template_soal.xlsx';
  const workbook = XLSX.utils.book_new();
  const templateSheet = XLSX.utils.aoa_to_sheet([headers, ...sampleData]);
  templateSheet['!cols'] = headers.map(header => ({ wch: header === 'pertanyaan' ? 48 : Math.max(14, header.length + 2) }));
  templateSheet['!rows'] = [{ hpt: 28 }, ...sampleData.map(() => ({ hpt: 72 }))];
  templateSheet['!autofilter'] = { ref: `A1:${XLSX.utils.encode_col(headers.length - 1)}${sampleData.length + 1}` };
  templateSheet['!freeze'] = { xSplit: 0, ySplit: 1 };
  XLSX.utils.book_append_sheet(workbook, templateSheet, 'Template Soal');

  if (selectedExam) {
    const referenceHeaders = ['ujian_id', 'nama_ujian', 'mata_pelajaran', 'tingkat', 'sesi', 'tahun_ajaran', 'semester'];
    const referenceRows = ujianList.map(ujian => [ujian.id, ujian.nama_ujian, ujian.nama_mapel || namaMapel, ujian.tingkat, ujian.sesi, ujian.tahun_ajaran, ujian.semester]);
    const referenceSheet = XLSX.utils.aoa_to_sheet([referenceHeaders, ...referenceRows]);
    referenceSheet['!cols'] = referenceHeaders.map((header, index) => ({ wch: Math.min(42, Math.max(header.length + 2, ...referenceRows.map(row => String(row[index] ?? '').length + 2))) }));
    XLSX.utils.book_append_sheet(workbook, referenceSheet, 'Referensi Ujian');
  }
  const guideRows = [
    ['Equation inline', '\\(x^2 + H_2O\\)'],
    ['Equation blok', '\\[\\frac{a}{b}\\]'],
    ['Superscript', 'x<sup>2</sup>'],
    ['Subscript', 'H<sub>2</sub>O'],
    ['Pangkat', '\\(x^2\\), \\(x^{10}\\), \\(10^{-3}\\)'],
    ['Indeks', '\\(x_1\\), \\(V_{out}\\), \\(x_1^2\\)'],
    ['Pecahan', '\\(\\frac{1}{2}\\)'],
    ['Akar', '\\(\\sqrt{144}\\)'],
    ['Integral', '\\(\\int_0^1 x^2\\,dx\\)'],
    ['Limit', '\\(\\lim_{x \\to 0}\\frac{\\sin x}{x}\\)'],
    ['Summation', '\\(\\sum_{i=1}^{n} i\\)'],
    ['Matriks', '\\[\\begin{bmatrix}1 & 2 \\\\ 3 & 4\\end{bmatrix}\\]'],
    ['Kimia', '\\(H_2SO_4\\), \\(Ca^{2+}\\)'],
    ['Fisika', '\\(E=mc^2\\), \\(v=\\frac{s}{t}\\)'],
    ['Gambar', 'Insert -> Picture, kemudian letakkan anchor kiri atas gambar di cell pertanyaan atau opsi yang dituju. Gunakan format XLSX.'],
  ];
  const guideSheet = XLSX.utils.aoa_to_sheet([['Fitur', 'Cara Penulisan'], ...guideRows]);
  guideSheet['!cols'] = [{ wch: 20 }, { wch: 90 }];
  XLSX.utils.book_append_sheet(workbook, guideSheet, 'Petunjuk Format');
  XLSX.writeFile(workbook, filename, { cellStyles: true });
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

    // Resolve only drawings connected to the first worksheet; drawings on other
    // sheets must never be assigned to question rows with matching coordinates.
    const parser = new DOMParser();
    const resolveZipPath = (baseFile, target) => {
      if (target.startsWith('/')) return target.replace(/^\//, '');
      const parts = `${baseFile.slice(0, baseFile.lastIndexOf('/') + 1)}${target}`.split('/');
      const resolved = [];
      parts.forEach(part => { if (part === '..') resolved.pop(); else if (part !== '.') resolved.push(part); });
      return resolved.join('/');
    };
    const workbookFile = zip.file('xl/workbook.xml');
    const workbookRelsFile = zip.file('xl/_rels/workbook.xml.rels');
    if (!workbookFile || !workbookRelsFile) return rowImages;
    const workbookDoc = parser.parseFromString(await workbookFile.async('string'), 'text/xml');
    const firstSheet = workbookDoc.getElementsByTagNameNS('*', 'sheet')[0];
    const sheetRelationshipId = firstSheet?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || firstSheet?.getAttribute('r:id');
    const workbookRelsDoc = parser.parseFromString(await workbookRelsFile.async('string'), 'text/xml');
    const sheetRelationship = Array.from(workbookRelsDoc.getElementsByTagName('Relationship')).find(item => item.getAttribute('Id') === sheetRelationshipId);
    const worksheetPath = sheetRelationship ? resolveZipPath('xl/workbook.xml', sheetRelationship.getAttribute('Target') || '') : '';
    const worksheetName = worksheetPath.split('/').pop();
    const worksheetRelsFile = worksheetName ? zip.file(`${worksheetPath.slice(0, worksheetPath.lastIndexOf('/'))}/_rels/${worksheetName}.rels`) : null;
    if (!worksheetRelsFile) return rowImages;
    const worksheetRelsDoc = parser.parseFromString(await worksheetRelsFile.async('string'), 'text/xml');
    const drawingPaths = new Set(Array.from(worksheetRelsDoc.getElementsByTagName('Relationship'))
      .filter(item => /\/drawing$/i.test(item.getAttribute('Type') || ''))
      .map(item => resolveZipPath(worksheetPath, item.getAttribute('Target') || '')));
    const drawingFiles = zip.file(/^xl\/drawings\/drawing\d+\.xml$/i).filter(item => drawingPaths.has(item.name));
    if (drawingFiles.length === 0) return rowImages;
    for (const drawingFile of drawingFiles) {
      const number = drawingFile.name.match(/drawing(\d+)\.xml$/i)?.[1];
      const relsFile = number ? zip.file(`xl/drawings/_rels/drawing${number}.xml.rels`) : null;
      if (!relsFile) continue;
      const relsDoc = parser.parseFromString(await relsFile.async('string'), 'text/xml');
      const rels = {};
      Array.from(relsDoc.getElementsByTagName('Relationship')).forEach(element => {
        const target = resolveZipPath(drawingFile.name, element.getAttribute('Target') || '');
        rels[element.getAttribute('Id')] = target;
      });
      const drawDoc = parser.parseFromString(await drawingFile.async('string'), 'text/xml');
      const anchors = Array.from(drawDoc.getElementsByTagNameNS('*', 'twoCellAnchor')).concat(Array.from(drawDoc.getElementsByTagNameNS('*', 'oneCellAnchor')));
      for (const anchor of anchors) {
        const from = anchor.getElementsByTagNameNS('*', 'from')[0];
        const row = from?.getElementsByTagNameNS('*', 'row')[0];
        const column = from?.getElementsByTagNameNS('*', 'col')[0];
        const blip = anchor.getElementsByTagNameNS('*', 'blip')[0];
        const relationshipId = blip?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'embed') || blip?.getAttribute('r:embed');
        if (!row || !column || !relationshipId || !rels[relationshipId]) continue;
        const excelRow = Number(row.textContent);
        const columnIndex = Number(column.textContent);
        if (!Number.isInteger(excelRow) || excelRow < 1 || !Number.isInteger(columnIndex)) continue;
        const mediaPath = rels[relationshipId];
        const mediaFile = zip.file(mediaPath) || zip.file(new RegExp(mediaPath.split('/').pop().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i'))[0];
        if (!mediaFile) continue;
        const ext = mediaFile.name.split('.').pop().toLowerCase();
        const mime = ext === 'png' ? 'image/png' : (ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : (ext === 'gif' ? 'image/gif' : (ext === 'webp' ? 'image/webp' : '')));
        if (!mime) continue;
        const base64 = await mediaFile.async('base64');
        const dataRowIndex = excelRow - 1;
        if (!rowImages[dataRowIndex]) rowImages[dataRowIndex] = {};
        rowImages[dataRowIndex][columnIndex] = `data:${mime};base64,${base64}`;
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
        const matrix = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });
        const headers = (matrix[0] || []).map(value => String(value || '').trim());

        // Merge each drawing into the exact row and content column containing its anchor.
        const imageTargets = { gambar_soal:'pertanyaan', gambar_a:'opsi_a', gambar_b:'opsi_b', gambar_c:'opsi_c', gambar_d:'opsi_d', gambar_e:'opsi_e', gambar_pembahasan:'pembahasan' };
        json.forEach((row, idx) => {
          Object.entries(embeddedImages[idx] || {}).forEach(([columnIndex, image]) => {
            const key = headers[Number(columnIndex)];
            const target = imageTargets[key];
            if (!target) {
              if (!row.__image_warnings) row.__image_warnings = [];
              row.__image_warnings.push(`Gambar ditemukan pada kolom ${key || Number(columnIndex) + 1}; pindahkan ke kolom GAMBAR yang sesuai.`);
              return;
            }
            row[target] = `${String(row[target] || '').trim()}${String(row[target] || '').trim() ? '<br>' : ''}<img src="${image}">`;
          });
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
