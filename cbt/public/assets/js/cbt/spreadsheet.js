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

function downloadTemplateSoal(namaMapel = '', ujianList = [], existingQuestions = []) {
  let headers = ['id_soal', 'ujian_id', 'nama_ujian', 'no', 'pertanyaan', 'opsi_a', 'opsi_b', 'opsi_c', 'opsi_d', 'opsi_e', 'jawaban_benar', 'poin'];
  const selectedExam = Array.isArray(ujianList) && ujianList.length ? ujianList[0] : null;
  let sampleData = [
    [
      '',
      selectedExam?.id || '',
      selectedExam?.nama_ujian || (namaMapel ? '' : 'Kimia Kelas XII'),
      1,
      'Nilai dari persamaan berikut adalah ... (buat melalui Insert -> Equation di cell ini)',
      'Etanol',
      'Metanol',
      'Propanol',
      'Butanol',
      'Pentanol',
      'A',
      1
    ],
    [
      '',
      selectedExam?.id || '',
      selectedExam?.nama_ujian || (namaMapel ? '' : 'Biologi Kelas X'),
      2,
      'Pilih jawaban yang benar. Equation/simbol dapat dibuat melalui menu Insert -> Equation.',
      'Mitokondria',
      'Ribosom',
      'Lisosom',
      'Badan Golgi',
      'Kloroplas',
      'A',
      1
    ]
  ];
  const examNumbers = new Map();
  const existingData = (Array.isArray(existingQuestions) ? existingQuestions : [])
    .slice()
    .sort((a, b) => Number(a.exam_id || a.ujian_id || 0) - Number(b.exam_id || b.ujian_id || 0) || Number(a.id || 0) - Number(b.id || 0))
    .map(question => {
      const examId = question.exam_id || question.ujian_id || '';
      const number = (examNumbers.get(String(examId)) || 0) + 1;
      examNumbers.set(String(examId), number);
      return [
        question.id || '',
        examId,
        question.nama_ujian || '',
        number,
        question.pertanyaan || '',
        question.opsi_a || '',
        question.opsi_b || '',
        question.opsi_c || '',
        question.opsi_d || '',
        question.opsi_e || '',
        String(question.jawaban_benar || '').toUpperCase(),
        question.poin || 1
      ];
    });
  const templateRows = existingData.length ? existingData : sampleData;
  const filename = namaMapel ? `template_soal_${namaMapel.toLowerCase().replace(/\s+/g, '_')}.xlsx` : 'template_soal.xlsx';
  const workbook = XLSX.utils.book_new();
  const templateSheet = XLSX.utils.aoa_to_sheet([headers, ...templateRows]);
  templateSheet['!cols'] = headers.map(header => ({ wch: header === 'pertanyaan' ? 48 : Math.max(14, header.length + 2) }));
  templateSheet['!rows'] = [{ hpt: 28 }, ...templateRows.map(() => ({ hpt: 72 }))];
  templateSheet['!autofilter'] = { ref: `A1:${XLSX.utils.encode_col(headers.length - 1)}${templateRows.length + 1}` };
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
    ['Soal yang sudah ada', 'Jika bank soal sudah berisi data, template otomatis memuat seluruh soal aktif. Jangan mengubah id_soal jika baris tersebut hendak diperbarui. Kosongkan id_soal hanya untuk soal baru.'],
    ['Equation & simbol', 'Klik cell pertanyaan/jawaban, pilih Insert -> Equation, lalu susun equation dari menu Excel. Tidak perlu menulis LaTeX.'],
    ['Posisi equation', 'Letakkan seluruh kotak equation di dalam cell tujuan. Cell pada sudut kiri atas objek menentukan pertanyaan/jawaban pemiliknya.'],
    ['Properti equation', 'Buka Format Object -> Size & Properties -> Properties, lalu pilih Move and size with cells.'],
    ['Superscript & subscript', 'Gunakan struktur Script pada menu Equation, atau format Superscript/Subscript bawaan Excel.'],
    ['Gambar', 'Pilih Insert -> Pictures langsung pada cell pertanyaan atau opsi_a sampai opsi_e, lalu pilih Move and size with cells.'],
    ['Kolom yang didukung', 'Objek hanya boleh ditempel pada pertanyaan, opsi_a, opsi_b, opsi_c, opsi_d, atau opsi_e.'],
  ];
  const guideSheet = XLSX.utils.aoa_to_sheet([['Fitur', 'Cara Penulisan'], ...guideRows]);
  guideSheet['!cols'] = [{ wch: 20 }, { wch: 90 }];
  XLSX.utils.book_append_sheet(workbook, guideSheet, 'Petunjuk Format');
  XLSX.writeFile(workbook, filename, { cellStyles: true });
}

function downloadTemplateSoalDenganData() {
  showLoading('Menyiapkan template beserta soal yang sudah ada...');
  cbtApi
    .withSuccessHandler(ujianList => {
      hideLoading();
      downloadTemplateSoal('', ujianList || [], cacheAdminSoalRows);
    })
    .withFailureHandler(error => {
      hideLoading();
      showCustomAlert('Template Gagal Dibuat', error?.message || 'Daftar jadwal ujian tidak dapat dimuat.', 'error');
    })
    .getAdminUjianList(stPengelola);
}

function downloadTemplateAkun() {
  let headers = ['username', 'nama_lengkap', 'role', 'password'];
  let sampleData = [['guru_kimia', 'Dra. Hj. Nurul', 'guru', '123456']];
  exportToExcel('template_akun_pengguna.xlsx', 'Template Akun', headers, sampleData);
}

function escapeMathMlText(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
  })[character]);
}

async function optimizeQuestionImageDataUrl(dataUrl) {
  const source = String(dataUrl || '');
  const estimatedBytes = Math.ceil((source.split(',')[1] || '').length * 0.75);
  const browserSafe = /^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(source);
  if (browserSafe && estimatedBytes <= 750000) return source;
  const image = new Image();
  await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('Format gambar Excel tidak dapat dikonversi.')); image.src = source; });
  const scale = Math.min(1, 1600 / Math.max(image.naturalWidth || 1, image.naturalHeight || 1));
  const canvas = document.createElement('canvas');canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d');context.fillStyle = '#fff';context.fillRect(0, 0, canvas.width, canvas.height);context.drawImage(image, 0, 0, canvas.width, canvas.height);
  let quality = .88, result = canvas.toDataURL('image/jpeg', quality);
  while (Math.ceil((result.split(',')[1] || '').length * .75) > 1200000 && quality > .48) { quality -= .1; result = canvas.toDataURL('image/jpeg', quality); }
  return result;
}

// Convert the Office Math (OMML) stored by Excel's Insert -> Equation menu to
// browser-native MathML. This deliberately happens during import; authors do
// not need to type or understand LaTeX.
function officeMathToMathMl(root) {
  const elements = node => Array.from(node?.childNodes || []).filter(child => child.nodeType === 1);
  const name = node => String(node?.localName || node?.nodeName || '').replace(/^.*:/, '');
  const direct = (node, wanted) => elements(node).find(child => name(child) === wanted);
  const descendants = (node, wanted) => Array.from(node?.getElementsByTagNameNS?.('*', wanted) || []);
  const propertyNames = new Set(['oMathParaPr','ctrlPr','rPr','fPr','radPr','dPr','naryPr','accPr','barPr','groupChrPr','limLowPr','limUppPr','funcPr','sSubPr','sSupPr','sSubSupPr','mPr','eqArrPr','borderBoxPr','boxPr','phantPr']);
  const attributeValue = (node, childName, fallback = '') => {
    const child = direct(node, childName) || descendants(node, childName)[0];
    return child?.getAttribute('val') || child?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/math', 'val') || child?.getAttribute('m:val') || fallback;
  };
  const content = node => elements(node).filter(child => !propertyNames.has(name(child))).map(convert).join('');
  const slot = (node, slotName) => content(direct(node, slotName));
  const row = value => `<mrow>${value || '<mtext></mtext>'}</mrow>`;
  const tokenise = value => {
    const chunks = String(value || '').match(/[0-9]+(?:[.,][0-9]+)?|[A-Za-z\u00C0-\uFFFF]+|\s+|./gu) || [];
    return chunks.map(chunk => {
      if (/^\s+$/u.test(chunk)) return '<mspace width="0.25em"></mspace>';
      if (/^[0-9]/u.test(chunk)) return `<mn>${escapeMathMlText(chunk)}</mn>`;
      if (/^[A-Za-z\u00C0-\uFFFF]/u.test(chunk)) return `<mi>${escapeMathMlText(chunk)}</mi>`;
      return `<mo>${escapeMathMlText(chunk)}</mo>`;
    }).join('');
  };
  const convert = node => {
    if (!node) return '';
    const local = name(node);
    if (propertyNames.has(local)) return '';
    if (local === 'r') return tokenise(descendants(node, 't').map(item => item.textContent || '').join(''));
    if (local === 't') return tokenise(node.textContent || '');
    if (local === 'f') {
      const fractionType = attributeValue(node, 'type', 'bar');
      if (fractionType === 'lin') return `<mrow>${slot(node, 'num')}<mo>/</mo>${slot(node, 'den')}</mrow>`;
      const attributes = fractionType === 'noBar' ? ' linethickness="0"' : (fractionType === 'skw' ? ' bevelled="true"' : '');
      return `<mfrac${attributes}>${row(slot(node, 'num'))}${row(slot(node, 'den'))}</mfrac>`;
    }
    if (local === 'sSup') return `<msup>${row(slot(node, 'e'))}${row(slot(node, 'sup'))}</msup>`;
    if (local === 'sSub') return `<msub>${row(slot(node, 'e'))}${row(slot(node, 'sub'))}</msub>`;
    if (local === 'sSubSup') return `<msubsup>${row(slot(node, 'e'))}${row(slot(node, 'sub'))}${row(slot(node, 'sup'))}</msubsup>`;
    if (local === 'sPre') return `<mmultiscripts>${row(slot(node, 'e'))}<mprescripts></mprescripts>${row(slot(node, 'sub'))}${row(slot(node, 'sup'))}</mmultiscripts>`;
    if (local === 'rad') {
      const degree = slot(node, 'deg');
      return degree ? `<mroot>${row(slot(node, 'e'))}${row(degree)}</mroot>` : `<msqrt>${slot(node, 'e')}</msqrt>`;
    }
    if (local === 'd') {
      const start = attributeValue(node, 'begChr', '(');
      const end = attributeValue(node, 'endChr', ')');
      return `<mrow><mo>${escapeMathMlText(start)}</mo>${slot(node, 'e')}<mo>${escapeMathMlText(end)}</mo></mrow>`;
    }
    if (local === 'nary') {
      const operator = attributeValue(node, 'chr', '∫');
      const base = `<mo>${escapeMathMlText(operator)}</mo>`;
      const sub = slot(node, 'sub');
      const sup = slot(node, 'sup');
      const scripted = sub && sup ? `<munderover>${base}${row(sub)}${row(sup)}</munderover>` : (sub ? `<munder>${base}${row(sub)}</munder>` : (sup ? `<mover>${base}${row(sup)}</mover>` : base));
      return `<mrow>${scripted}${slot(node, 'e')}</mrow>`;
    }
    if (local === 'limLow') return `<munder>${row(slot(node, 'e'))}${row(slot(node, 'lim'))}</munder>`;
    if (local === 'limUpp') return `<mover>${row(slot(node, 'e'))}${row(slot(node, 'lim'))}</mover>`;
    if (local === 'acc' || local === 'bar' || local === 'groupChr') {
      const mark = attributeValue(node, 'chr', local === 'acc' ? '\u0302' : '\u00AF');
      const position = attributeValue(node, 'pos', 'top');
      return position === 'bot'
        ? `<munder accentunder="true">${row(slot(node, 'e'))}<mo>${escapeMathMlText(mark)}</mo></munder>`
        : `<mover accent="true">${row(slot(node, 'e'))}<mo>${escapeMathMlText(mark)}</mo></mover>`;
    }
    if (local === 'func') return `<mrow>${slot(node, 'fName')}<mo>\u2061</mo>${slot(node, 'e')}</mrow>`;
    if (local === 'borderBox') return `<menclose notation="box">${slot(node, 'e')}</menclose>`;
    if (local === 'box') return `<mpadded>${slot(node, 'e')}</mpadded>`;
    if (local === 'phant') return `<mphantom>${slot(node, 'e')}</mphantom>`;
    if (local === 'm') {
      const rows = elements(node).filter(child => name(child) === 'mr');
      return `<mtable>${rows.map(matrixRow => `<mtr>${elements(matrixRow).filter(cell => name(cell) === 'e').map(cell => `<mtd>${content(cell)}</mtd>`).join('')}</mtr>`).join('')}</mtable>`;
    }
    if (local === 'eqArr') return `<mtable>${elements(node).filter(child => name(child) === 'e').map(item => `<mtr><mtd>${content(item)}</mtd></mtr>`).join('')}</mtable>`;
    return content(node);
  };

  const converted = content(root);
  return converted ? `<math xmlns="http://www.w3.org/1998/Math/MathML" display="block">${converted}</math>` : '';
}

// EXTRACT IMAGES AND NATIVE EXCEL EQUATIONS INSERTED INSIDE .XLSX
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
    const worksheetFile = worksheetPath ? zip.file(worksheetPath) : null;
    const worksheetDoc = worksheetFile ? parser.parseFromString(await worksheetFile.async('string'), 'text/xml') : null;
    const worksheetName = worksheetPath.split('/').pop();
    const worksheetRelsFile = worksheetName ? zip.file(`${worksheetPath.slice(0, worksheetPath.lastIndexOf('/'))}/_rels/${worksheetName}.rels`) : null;
    const worksheetRelsDoc = worksheetRelsFile ? parser.parseFromString(await worksheetRelsFile.async('string'), 'text/xml') : null;
    const drawingPaths = new Set(Array.from(worksheetRelsDoc?.getElementsByTagName('Relationship') || [])
      .filter(item => /\/drawing$/i.test(item.getAttribute('Type') || ''))
      .map(item => resolveZipPath(worksheetPath, item.getAttribute('Target') || '')));
    const drawingFiles = zip.file(/^xl\/drawings\/drawing\d+\.xml$/i).filter(item => drawingPaths.has(item.name));
    for (const drawingFile of drawingFiles) {
      const number = drawingFile.name.match(/drawing(\d+)\.xml$/i)?.[1];
      const relsFile = number ? zip.file(`xl/drawings/_rels/drawing${number}.xml.rels`) : null;
      const relsDoc = relsFile ? parser.parseFromString(await relsFile.async('string'), 'text/xml') : null;
      const rels = {};
      Array.from(relsDoc?.getElementsByTagName('Relationship') || []).forEach(element => {
        const target = resolveZipPath(drawingFile.name, element.getAttribute('Target') || '');
        rels[element.getAttribute('Id')] = target;
      });
      const drawDoc = parser.parseFromString(await drawingFile.async('string'), 'text/xml');
      const anchors = Array.from(drawDoc.getElementsByTagNameNS('*', 'twoCellAnchor')).concat(Array.from(drawDoc.getElementsByTagNameNS('*', 'oneCellAnchor')));
      for (const anchor of anchors) {
        const from = anchor.getElementsByTagNameNS('*', 'from')[0];
        const row = from?.getElementsByTagNameNS('*', 'row')[0];
        const column = from?.getElementsByTagNameNS('*', 'col')[0];
        if (!row || !column) continue;
        const excelRow = Number(row.textContent);
        const columnIndex = Number(column.textContent);
        if (!Number.isInteger(excelRow) || excelRow < 1 || !Number.isInteger(columnIndex)) continue;
        const dataRowIndex = excelRow - 1;
        if (!rowImages[dataRowIndex]) rowImages[dataRowIndex] = {};
        const fragments = [];
        const officeMath = anchor.getElementsByTagNameNS('*', 'oMathPara')[0] || anchor.getElementsByTagNameNS('*', 'oMath')[0];
        if (officeMath) {
          const mathMl = officeMathToMathMl(officeMath);
          if (mathMl) fragments.push(mathMl);
        }
        const blip = anchor.getElementsByTagNameNS('*', 'blip')[0];
        const relationshipId = blip?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'embed') || blip?.getAttribute('r:embed');
        if (relationshipId && rels[relationshipId]) {
          const mediaPath = rels[relationshipId];
          const mediaFile = zip.file(mediaPath) || zip.file(new RegExp(mediaPath.split('/').pop().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i'))[0];
          if (mediaFile) {
            const ext = mediaFile.name.split('.').pop().toLowerCase();
            const mime = ext === 'png' ? 'image/png' : (ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : (ext === 'gif' ? 'image/gif' : (ext === 'webp' ? 'image/webp' : (ext === 'svg' ? 'image/svg+xml' : (ext === 'bmp' ? 'image/bmp' : '')))));
            if (mime) fragments.push(`<img src="${await optimizeQuestionImageDataUrl(`data:${mime};base64,${await mediaFile.async('base64')}`)}">`);
          }
        }
        if (fragments.length) rowImages[dataRowIndex][columnIndex] = `${rowImages[dataRowIndex][columnIndex] || ''}${fragments.join('<br>')}`;
      }
    }

    // Excel 365 can store Insert -> Pictures -> Place in Cell images in
    // xl/cellimages.xml and reference them with DISPIMG formulas instead of a
    // worksheet drawing anchor. Resolve that newer representation as well.
    const cellImagesFile = zip.file('xl/cellimages.xml');
    const cellImagesRelsFile = zip.file('xl/_rels/cellimages.xml.rels');
    if (worksheetDoc && cellImagesFile && cellImagesRelsFile) {
      const cellImagesDoc = parser.parseFromString(await cellImagesFile.async('string'), 'text/xml');
      const cellImagesRelsDoc = parser.parseFromString(await cellImagesRelsFile.async('string'), 'text/xml');
      const cellImageRels = {};
      Array.from(cellImagesRelsDoc.getElementsByTagName('Relationship')).forEach(element => {
        cellImageRels[element.getAttribute('Id')] = resolveZipPath('xl/cellimages.xml', element.getAttribute('Target') || '');
      });
      const imagesById = {};
      for (const picture of Array.from(cellImagesDoc.getElementsByTagNameNS('*', 'pic'))) {
        const properties = picture.getElementsByTagNameNS('*', 'cNvPr')[0];
        const imageId = properties?.getAttribute('name') || properties?.getAttribute('descr') || '';
        const blip = picture.getElementsByTagNameNS('*', 'blip')[0];
        const relationshipId = blip?.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'embed') || blip?.getAttribute('r:embed');
        const mediaPath = relationshipId ? cellImageRels[relationshipId] : '';
        const mediaFile = mediaPath ? (zip.file(mediaPath) || zip.file(new RegExp(mediaPath.split('/').pop().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i'))[0]) : null;
        if (!imageId || !mediaFile) continue;
        const ext = mediaFile.name.split('.').pop().toLowerCase();
        const mime = ext === 'png' ? 'image/png' : (ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : (ext === 'gif' ? 'image/gif' : (ext === 'webp' ? 'image/webp' : (ext === 'svg' ? 'image/svg+xml' : (ext === 'bmp' ? 'image/bmp' : '')))));
        if (mime) imagesById[imageId] = `<img src="${await optimizeQuestionImageDataUrl(`data:${mime};base64,${await mediaFile.async('base64')}`)}">`;
      }
      Array.from(worksheetDoc.getElementsByTagNameNS('*', 'c')).forEach(cell => {
        const formula = cell.getElementsByTagNameNS('*', 'f')[0]?.textContent || '';
        const imageId = formula.match(/DISPIMG\(\s*"([^"]+)"/i)?.[1];
        const coordinate = cell.getAttribute('r') || '';
        const match = coordinate.match(/^([A-Z]+)(\d+)$/i);
        if (!imageId || !imagesById[imageId] || !match) return;
        const columnIndex = match[1].toUpperCase().split('').reduce((value, character) => value * 26 + character.charCodeAt(0) - 64, 0) - 1;
        const dataRowIndex = Number(match[2]) - 2;
        if (dataRowIndex < 0) return;
        if (!rowImages[dataRowIndex]) rowImages[dataRowIndex] = {};
        rowImages[dataRowIndex][columnIndex] = `${rowImages[dataRowIndex][columnIndex] || ''}${imagesById[imageId]}`;
      });
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
        const contentColumns = new Set(['pertanyaan','opsi_a','opsi_b','opsi_c','opsi_d','opsi_e']);
        json.forEach((row, idx) => {
          Object.entries(embeddedImages[idx] || {}).forEach(([columnIndex, embeddedContent]) => {
            const key = headers[Number(columnIndex)];
            if (!contentColumns.has(key)) {
              if (!row.__image_warnings) row.__image_warnings = [];
              row.__image_warnings.push(`Gambar/equation ditemukan pada kolom ${key || Number(columnIndex) + 1}; pindahkan langsung ke cell pertanyaan atau pilihan.`);
              return;
            }
            row[key] = `${String(row[key] || '').trim()}${String(row[key] || '').trim() ? '<br>' : ''}${embeddedContent}`;
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
