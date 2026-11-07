import { useEffect, useState } from 'react';
import { api } from './lib/api';
import { exportExcel } from './lib/spreadsheet';
import { escapePrint, schoolLogoPath } from './lib/print-format';

type StudentCard = {
  id: number;
  nisn: string;
  name_snapshot: string;
  class_snapshot: string | null;
  grade_snapshot: string | null;
  academic_year_snapshot: string | null;
  pin: string;
};
type ClassRow = { portal_class_id: string; name: string; grade: string };

// The preview and print window use the same card markup and styles.
const cardCss = `
  .student-card-preview-wrap {
    max-width: 100%;
    margin: 16px 0;
    padding: 12px;
    overflow-x: auto;
    border: 1px solid #dce5dd;
    border-radius: 10px;
    background: #f5faf6;
  }
  .student-card-preview {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
    width: 174mm;
    margin: 0;
    align-items: stretch;
  }
  .student-card-preview .card-ujian-print {
    box-sizing: border-box;
    display: block;
    min-width: 0;
    min-height: 178px;
    padding: 12px;
    border: 1.5px solid #315b3e;
    border-radius: 8px;
    background: #fff;
    color: #172620;
    font: 11px/1.4 Arial, sans-serif;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .card-ujian-print .card-print-letterhead {
    display: grid;
    grid-template-columns: 42px minmax(0, 1fr);
    align-items: center;
    gap: 8px;
    min-height: 48px;
    margin-bottom: 10px;
    padding-bottom: 7px;
    border-bottom: 1.5px solid #315b3e;
  }
  .card-ujian-print .card-print-letterhead img {
    display: block;
    width: 42px;
    height: 42px;
    object-fit: contain;
  }
  .card-ujian-print .card-print-letterhead b {
    display: block;
    color: #0b5134;
    font-size: 11px;
    line-height: 1.25;
  }
  .card-ujian-print .card-print-letterhead span {
    display: block;
    margin-top: 2px;
    font-size: 8px;
    line-height: 1.3;
  }
  .card-ujian-print .card-details {
    display: grid;
    gap: 5px;
    margin: 0;
  }
  .card-ujian-print .card-field {
    display: grid;
    grid-template-columns: 92px minmax(0, 1fr);
    gap: 7px;
    align-items: baseline;
    min-width: 0;
  }
  .card-ujian-print .card-field dt,
  .card-ujian-print .card-field dd { margin: 0; }
  .card-ujian-print .card-field dt { color: #53645a; }
  .card-ujian-print .card-field dd { overflow-wrap: anywhere; }
  .card-ujian-print .card-field strong { font-size: 11px; font-weight: 700; }
  .card-ujian-print .card-field .pin { font-size: 13px; font-weight: 800; letter-spacing: .08em; }
`;

const schoolPrintCss = `
  * { box-sizing: border-box; }
  body { margin: 12px auto; width: 174mm; color: #172620; font: 11px Arial, sans-serif; }
  .print-only-screen { margin-bottom: 12px; padding: 8px 13px; }
  @page { size: A4 portrait; margin: 16mm 18mm; }
  @media print {
    body { margin: 0; }
    .print-only-screen { display: none !important; }
    .card-ujian-print { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
  }
`;

function renderCards(items: StudentCard[]) {
  const safe = (value: unknown) => escapePrint(value ?? '');
  return items.map((student) => `
    <article class="card-ujian-print">
      <header class="card-print-letterhead">
        <img src="${schoolLogoPath}" alt="Lambang MAN 1 Palembang">
        <div><b>KARTU PESERTA UJIAN</b><span>MADRASAH ALIYAH NEGERI 1 PALEMBANG</span></div>
      </header>
      <dl class="card-details">
        <div class="card-field"><dt>No. Peserta</dt><dd><strong>${safe(student.nisn)}</strong></dd></div>
        <div class="card-field"><dt>Nama Siswa</dt><dd><strong>${safe(student.name_snapshot)}</strong></dd></div>
        <div class="card-field"><dt>Kelas / Tingkat</dt><dd>${safe(student.class_snapshot || '—')} / ${safe(student.grade_snapshot || '—')}</dd></div>
        <div class="card-field"><dt>PIN Ujian</dt><dd><strong class="pin">${safe(student.pin)}</strong></dd></div>
      </dl>
    </article>
  `).join('');
}

export function StudentCards() {
  const [grade, setGrade] = useState('');
  const [classId, setClassId] = useState('');
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [students, setStudents] = useState<StudentCard[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    void api<ClassRow[]>('/api/admin/portal-classes').then(setClasses).catch(() => undefined);
  }, []);

  async function loadCards() {
    setBusy(true);
    setNotice('');
    try {
      const params = new URLSearchParams({ limit: '5000' });
      if (grade) params.set('grade', grade);
      if (classId) params.set('class_id', classId);
      const result = await api<{ items: StudentCard[]; total: number }>(`/api/admin/student-cards?${params}`);
      setStudents(result.items);
      if (result.total === 5000) setNotice('Ditampilkan maksimal 5.000 kartu. Pilih tingkat atau kelas untuk memproses kelompok lebih besar.');
      else if (!result.items.length) setNotice('Belum ada siswa dengan PIN tersimpan yang cocok. PIN lama berbentuk hash harus diterbitkan ulang sebelum dapat dicetak.');
    } catch (error) {
      setStudents([]);
      setNotice(error instanceof Error ? error.message : 'Kartu peserta gagal dimuat');
    } finally {
      setBusy(false);
    }
  }

  function printCards() {
    if (!students.length) { setNotice('Tampilkan kartu terlebih dahulu.'); return; }
    const popup = window.open('', 'arena-cards', 'width=900,height=700');
    if (!popup) { setNotice('Izinkan pop-up untuk mencetak kartu.'); return; }
    popup.document.open();
    popup.document.write(`<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>Kartu Peserta Ujian</title><style>${schoolPrintCss}${cardCss}</style></head><body><button class="print-only-screen" onclick="window.print()">Cetak Kartu</button><main class="student-card-preview">${renderCards(students)}</main></body></html>`);
    popup.document.close();
  }

  async function exportCards() {
    if (!students.length) { setNotice('Tampilkan kartu terlebih dahulu.'); return; }
    setBusy(true);
    try {
      const rows = [['No', 'Nomor Peserta', 'Nama Siswa', 'Kelas', 'Tingkat', 'PIN Ujian', 'Tahun Ajaran'], ...students.map((item, index) => [index + 1, item.nisn, item.name_snapshot, item.class_snapshot ?? '', item.grade_snapshot ?? '', item.pin, item.academic_year_snapshot ?? ''])];
      await exportExcel('kartu_peserta_ujian.xlsx', [{ name: 'Kartu Peserta', rows, widths: [8, 22, 36, 24, 12, 16, 18] }]);
      setNotice(students.length + ' kartu peserta diekspor beserta PIN. Simpan file dengan aman.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Ekspor gagal');
    } finally {
      setBusy(false);
    }
  }

  const filteredClasses = classes.filter((item) => !grade || item.grade === grade);
  return (
    <section className="admin-page-card">
      <style>{cardCss}</style>
      <header className="admin-card-heading">
        <div>
          <span className="section-kicker">IDENTITAS PESERTA</span>
          <h2>Cetak kartu peserta ujian</h2>
          <p>Pratinjau memakai ukuran dan tata letak yang sama dengan kartu cetak.</p>
        </div>
        <div className="operations-monitor-actions">
          <button type="button" className="btn btn-primary" disabled={busy || !students.length} onClick={printCards}>Cetak kartu</button>
          <button type="button" className="btn btn-secondary" disabled={busy || !students.length} onClick={() => void exportCards()}>Unduh Excel</button>
        </div>
      </header>
      {notice && <p role="status" className="arena-notice">{notice}</p>}
      <form className="admin-result-filters" onSubmit={(event) => { event.preventDefault(); void loadCards(); }}>
        <label>Tingkat
          <select value={grade} onChange={(event) => { setGrade(event.target.value); setClassId(''); }}>
            <option value="">Semua tingkat</option>
            {['X', 'XI', 'XII'].map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <label>Kelas
          <select value={classId} onChange={(event) => setClassId(event.target.value)}>
            <option value="">Semua kelas</option>
            {filteredClasses.map((item) => <option key={item.portal_class_id} value={item.portal_class_id}>{item.name}</option>)}
          </select>
        </label>
        <button className="btn btn-secondary" disabled={busy}>{busy ? 'Memuat…' : 'Tampilkan'}</button>
      </form>
      {students.length > 0 && <>
        <div className="student-card-preview-wrap">
          <div className="student-card-preview" dangerouslySetInnerHTML={{ __html: renderCards(students.slice(0, 12)) }} />
        </div>
        <p>{students.length} kartu siap dicetak{students.length > 12 ? ' · pratinjau menampilkan 12 kartu pertama' : ''}.</p>
      </>}
      {!students.length && !busy && <p className="operations-empty">Belum ada kartu yang dimuat.</p>}
    </section>
  );
}
