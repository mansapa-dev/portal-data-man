import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from './lib/api';
import './styles/exam-admission.css';

export function ExamWaitingRoom({ examId, ticket, examName, onReady, onCancel }: { examId: number; ticket: string; examName: string; onReady: () => Promise<void>; onCancel: () => void }) {
  const ready = useRef(onReady);
  ready.current = onReady;
  const [notice, setNotice] = useState('');
  const [stopped, setStopped] = useState(false);
  const [starting, setStarting] = useState(false);
  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    setNotice(''); setStopped(false);
    const schedule = (delay: number) => { if (!cancelled) timer = window.setTimeout(() => { void poll(); }, delay); };
    async function poll() {
      try {
        const status = await api<{ allowed: boolean }>(`/api/student/exams/${examId}/admission?ticket=${encodeURIComponent(ticket)}`);
        if (cancelled) return;
        setNotice('');
        if (!status.allowed) { schedule(5000 + Math.random() * 5000); return; }
        // Spread the next cohort's starts after its gate opens.
        timer = window.setTimeout(() => {
          if (!cancelled) { setStarting(true); void ready.current().catch(handleError).finally(() => { if (!cancelled) setStarting(false); }); }
        }, Math.random() * 10000);
      } catch (error) { handleError(error); }
    }
    function handleError(error: unknown) {
      if (cancelled) return;
      if (error instanceof ApiError && [401, 403, 404, 409, 422].includes(error.statusCode)) {
        setStopped(true); setNotice(error.message); return;
      }
      setNotice(error instanceof ApiError && error.statusCode === 425 ? '' : 'Koneksi sedang dipulihkan. Mohon tetap di halaman ini.');
      schedule(5000 + Math.random() * 5000);
    }
    void poll();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [examId, ticket]);

  return <section className="exam-waiting-room" aria-labelledby="exam-waiting-title">
    <div className="exam-waiting-card" aria-busy={starting}>
      <div className="exam-waiting-animation" aria-hidden="true"><span/><span/><span/><svg width="38" height="38" viewBox="0 0 40 40" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M10 5h20M10 35h20M12 5v6c0 5 5 7 8 9-3 2-8 4-8 9v6M28 5v6c0 5-5 7-8 9 3 2 8 4 8 9v6"/><path d="m15 11 5 5 5-5M15 30l5-5 5 5"/></svg></div>
      <p className="exam-waiting-eyebrow">RUANG TUNGGU UJIAN</p>
      <h1 id="exam-waiting-title">Silakan tunggu, sesi Anda akan segera dimulai...</h1>
      <p className="exam-waiting-name">{examName}</p>
      <p>Ujian akan terbuka otomatis saat giliran Anda tiba.</p>
      <div className="exam-waiting-dots" aria-hidden="true"><span/><span/><span/></div>
      <p className="exam-waiting-notice" role="status" aria-live="polite">{notice}</p>
      <button className="btn btn-secondary" type="button" disabled={starting} onClick={onCancel}>{stopped ? 'Kembali dan perbarui jadwal' : 'Kembali ke jadwal'}</button>
    </div>
  </section>;
}
