import { useEffect, useState } from 'react';
import { api } from './lib/api';
import './styles/exam-admission.css';

type Status = { enabled: boolean; current_grade: 'XII' | 'XI' | 'X'; threshold: number; counts: Record<'XII' | 'XI' | 'X', number> };
type Exam = { id: number; name: string; grade: string; session_number: number; starts_at: string; status: string };

export function ExamAdmissionControl() {
  const [exams, setExams] = useState<Exam[]>([]);
  const [examId, setExamId] = useState('');
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => { let active = true; void api<Exam[]>('/api/admin/exams').then(rows => { if (active) setExams(rows.filter(exam => exam.status === 'ACTIVE')); }).catch(error => { if (active) setNotice(error instanceof Error ? error.message : 'Jadwal gagal dimuat'); }); return () => { active = false; }; }, []);
  async function refresh() {
    if (!examId) return;
    setBusy(true); setNotice('');
    try { setStatus(await api<Status>(`/api/admin/exam-admission?exam_id=${examId}`)); }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Status antrean gagal dimuat'); }
    finally { setBusy(false); }
  }
  async function advance() {
    if (!status || !examId) return;
    setBusy(true); setNotice('');
    try { setStatus(await api<Status>('/api/admin/exam-admission/advance', { method: 'POST', body: { exam_id: Number(examId), expected_grade: status.current_grade } })); }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Tingkat berikutnya belum dibuka'); }
    finally { setBusy(false); }
  }
  return <section className="exam-admission-control" aria-labelledby="exam-admission-heading">
    <h3 id="exam-admission-heading">Giliran mulai ujian</h3>
    <p>XII dimulai lebih dahulu. Setelah 300 siswa XII berhasil mulai, XI terbuka; setelah 300 siswa XI mulai, X terbuka. Hitungan dibagi berdasarkan tanggal, sesi, tahun ajaran, dan semester.</p>
    <div className="exam-admission-actions"><label>Jadwal dalam sesi yang dipantau<select disabled={busy} value={examId} onChange={event => { setExamId(event.target.value); setStatus(null); }}><option value="">Pilih jadwal aktif</option>{exams.map(exam => <option key={exam.id} value={exam.id}>{exam.name} · {exam.grade} · Sesi {exam.session_number} · {new Date(exam.starts_at).toLocaleDateString('id-ID', { timeZone: 'Asia/Jakarta' })}</option>)}</select></label><button type="button" className="btn btn-secondary" disabled={busy || !examId} onClick={() => void refresh()}>Perbarui status</button></div>
    {status && <><div className="exam-admission-counts">{(['XII','XI','X'] as const).map(grade => <span key={grade}>{grade}: {status.counts[grade]} siswa mulai</span>)}</div><p>{status.enabled ? `Tingkat yang sudah dibuka: ${status.current_grade === 'XII' ? 'XII' : status.current_grade === 'XI' ? 'XII dan XI' : 'XII, XI, dan X'}. Ambang: ${status.threshold} siswa per tingkat.` : 'Antrean tingkat dinonaktifkan pada konfigurasi aplikasi.'}</p><button type="button" className="btn btn-primary" disabled={busy || !status.enabled || status.current_grade === 'X'} onClick={() => void advance()}>Buka tingkat berikutnya</button><p><small>Gunakan bila jumlah peserta tingkat sebelumnya kurang dari ambang atau petugas perlu melanjutkan sesi. Pembukaan tidak menutup tingkat sebelumnya.</small></p></>}
    {notice && <p role="status">{notice}</p>}
  </section>;
}
