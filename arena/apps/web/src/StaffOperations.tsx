import React, { useEffect, useRef, useState } from 'react';
import { api } from './lib/api';
import { exportExcel, safeFilename } from './lib/spreadsheet';
import { AdminOverview } from './AdminOverview';

type Row = Record<string, unknown>;

function getRowValue(row: Row, key: string): string {
  return String(row[key] ?? '—');
}

function formatTeacherDate(value: unknown): string {
  if (!value) return 'Jadwal belum ditentukan';
  const date = new Date(String(value));
  return Number.isNaN(date.getTime())
    ? 'Jadwal belum ditentukan'
    : new Intl.DateTimeFormat('id-ID', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: 'Asia/Jakarta',
      }).format(date) + ' WIB';
}

function getStatusLabel(value: unknown): string {
  const status = String(value ?? '').toUpperCase();
  const map: Record<string, string> = {
    ACTIVE: 'Aktif',
    DRAFT: 'Draf',
    INACTIVE: 'Nonaktif',
    ARCHIVED: 'Arsip',
    COMPLETED: 'Selesai',
    IN_PROGRESS: 'Sedang Mengerjakan',
    TERMINATED: 'Dihentikan',
  };
  return map[status] ?? (status || 'Belum Ditentukan');
}

function getViolationLabel(value: unknown): string {
  const type = String(value ?? '');
  const map: Record<string, string> = {
    TAB_HIDDEN: 'Berpindah tab / buka aplikasi lain',
    WINDOW_BLUR: 'Jendela ujian kehilangan fokus',
    MULTI_TAB: 'Tab ujian kedua pada perangkat yang sama',
    TEXT_SELECTION: 'Seleksi teks soal (long-press) diblokir',
    FULLSCREEN_EXIT: 'Keluar dari mode layar penuh',
    SCREENSHOT_ATTEMPT: 'Mencoba mengambil screenshot',
    COPY_ATTEMPT: 'Mencoba menyalin teks soal',
    PASTE_ATTEMPT: 'Mencoba menempelkan teks',
    CUT_ATTEMPT: 'Mencoba memotong teks',
    CONTEXT_MENU_ATTEMPT: 'Membuka menu klik kanan',
    DEVTOOLS_SHORTCUT: 'Membuka Developer Tools',
    BROWSER_SHORTCUT: 'Shortcut navigasi browser',
    SPLIT_SCREEN_SUSPECTED: 'Terindikasi layar ganda (split-screen)',
    OTHER: 'Aktivitas mencurigakan lainnya',
  };
  return map[type] ?? type;
}

function isSessionConnected(row: Row): boolean {
  return Boolean(
    row.last_seen_at && Date.now() - new Date(String(row.last_seen_at)).getTime() < 90_000
  );
}

// Sub-komponen Ringkasan untuk Pengawas Ujian
function ProctorOverview({
  canProctor,
  onNavigate,
  compact = false,
}: {
  canProctor: boolean;
  onNavigate?: (route: 'sessions' | 'tickets') => void;
  compact?: boolean;
}) {
  const [summary, setSummary] = useState({ sessions: 0, online: 0, open: 0, handling: 0 });
  const [error, setError] = useState('');

  useEffect(() => {
    if (!canProctor) return;
    let active = true;

    const refresh = () => {
      if (document.hidden) return;
      void Promise.all([
        api<Row[]>('/api/teacher/live-sessions?page=1'),
        api<Row[]>('/api/staff/support-tickets'),
      ])
        .then(([sessions, tickets]) => {
          if (!active) return;
          setSummary({
            sessions: sessions.filter((row) => row.status === 'IN_PROGRESS').length,
            online: sessions.filter(
              (row) =>
                row.status === 'IN_PROGRESS' &&
                row.last_seen_at &&
                Date.now() - new Date(String(row.last_seen_at)).getTime() < 90_000
            ).length,
            open: tickets.filter((row) => row.status === 'OPEN').length,
            handling: tickets.filter((row) => row.status === 'IN_PROGRESS').length,
          });
        })
        .catch((e) => {
          if (active) setError((e as Error).message);
        });
    };

    refresh();
    const timer = window.setInterval(refresh, 45_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [canProctor]);

  return (
    <div className="teacher-home staff-workspace-container">
      {compact ? (
        <div style={{ margin: '16px 0 8px' }}>
          <span className="section-kicker">PENGAWASAN CBT</span>
          <h3 style={{ margin: '4px 0 0', fontSize: '18px', fontWeight: 800 }}>Ringkasan Tugas Pengawas</h3>
        </div>
      ) : (
        <section className="teacher-welcome-card">
          <div>
            <span className="section-kicker">PORTAL PETUGAS · MANSAPA ARENA</span>
            <h2>Ruang Pantau Ujian CBT</h2>
            <p>Pantau koneksi peserta secara berkala dan bantu siswa yang mengalami kendala teknis.</p>
          </div>
          <div className="teacher-welcome-icon">
            <i className="fa-solid fa-headset" />
          </div>
        </section>
      )}

      {error && (
        <p className="arena-notice" role="alert">
          <i className="fa-solid fa-triangle-exclamation" style={{ marginRight: '8px' }} />
          {error}
        </p>
      )}

      {canProctor ? (
        <>
          <section className="staff-metric-grid" aria-label="Ringkasan Petugas">
            <article className="staff-metric primary">
              <i className="fa-solid fa-users" />
              <div>
                <small>Sesi Aktif</small>
                <strong>{summary.sessions}</strong>
                <span>Peserta sedang mengerjakan</span>
              </div>
            </article>

            <article className="staff-metric">
              <i className="fa-solid fa-wifi" />
              <div>
                <small>Koneksi Terhubung</small>
                <strong>{summary.online}</strong>
                <span>Aktif dalam 90 detik terakhir</span>
              </div>
            </article>

            <article className="staff-metric">
              <i className="fa-solid fa-bell" />
              <div>
                <small>Tiket Menunggu</small>
                <strong>{summary.open}</strong>
                <span>Perlu ditangani petugas</span>
              </div>
            </article>

            <article className="staff-metric">
              <i className="fa-solid fa-user-clock" />
              <div>
                <small>Sedang Ditangani</small>
                <strong>{summary.handling}</strong>
                <span>Proses oleh tim pengawas</span>
              </div>
            </article>
          </section>

          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <button className="btn btn-primary" type="button" onClick={() => onNavigate?.('sessions')}>
              <i className="fa-solid fa-desktop" /> Pantau Sesi Langsung
            </button>
            <button className="btn btn-secondary" type="button" onClick={() => onNavigate?.('tickets')}>
              <i className="fa-solid fa-headset" /> Buka Tiket Bantuan
            </button>
          </div>
        </>
      ) : (
        <div className="teacher-empty-state">
          <i className="fa-solid fa-user-lock" style={{ fontSize: '24px' }} />
          <strong>Belum Ada Akses Pengawas</strong>
          <p>Hubungi Administrator untuk mengaktifkan akses pemantauan ujian pada akun Anda.</p>
        </div>
      )}
    </div>
  );
}

interface StaffOperationsProps {
  view: string;
  admin: boolean;
  canTeach?: boolean;
  canProctor?: boolean;
  onNavigate?: (route: 'exams' | 'questions' | 'students' | 'results' | 'followups' | 'sessions' | 'tickets') => void;
  onCreateExam?: () => void;
}

export function StaffOperations({
  view,
  admin,
  canTeach = true,
  canProctor = false,
  onNavigate,
  onCreateExam,
}: StaffOperationsProps) {
  const [rows, setRows] = useState<Row[]>([]);
  const [exams, setExams] = useState<Row[]>([]);
  const [people, setPeople] = useState<{ teachers: Row[]; employees: Row[] }>({ teachers: [], employees: [] });
  const [results, setResults] = useState<Row[]>([]);
  const [selectedExam, setSelectedExam] = useState('');
  const [page, setPage] = useState(1);
  const [resultPage, setResultPage] = useState(1);
  const [personType, setPersonType] = useState<'teacher' | 'employee'>('teacher');
  const [personId, setPersonId] = useState('');
  const [assignedExam, setAssignedExam] = useState('');
  const [duty, setDuty] = useState<'TEACHER' | 'PROCTOR'>('TEACHER');
  const [editingAssignmentId, setEditingAssignmentId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [lastLoaded, setLastLoaded] = useState<Date | null>(null);

  // Filter Monitoring Sesi
  const [sessionExam, setSessionExam] = useState('');
  const [sessionClass, setSessionClass] = useState('');
  const [sessionGrade, setSessionGrade] = useState('');
  const [sessionSubject, setSessionSubject] = useState('');
  const [sessionStatus, setSessionStatus] = useState('IN_PROGRESS');
  const [sessionConnection, setSessionConnection] = useState('ALL');

  const pageRef = useRef(1);
  const resultCursors = useRef<number[]>([0]);

  const path =
    view === 'dashboard'
      ? admin
        ? '/api/admin/dashboard'
        : '/api/teacher/dashboard'
      : view === 'teacherExams' || view === 'teacherResults'
      ? '/api/teacher/dashboard'
      : view === 'sessions'
      ? admin
        ? '/api/admin/live-sessions'
        : '/api/teacher/live-sessions'
      : view === 'violations'
      ? admin
        ? '/api/admin/violations'
        : '/api/staff/violations'
      : '/api/admin/teacher-assignments';

  async function load(nextPage = pageRef.current) {
    if (document.hidden) return;
    try {
      const response = await api<unknown>(
        ['sessions', 'violations'].includes(view) ? `${path}?page=${nextPage}&limit=100` : path
      );
      const normalized = Array.isArray(response)
        ? response
        : ((response as { exams?: Row[]; items?: Row[] }).exams ??
          (response as { items?: Row[] }).items ??
          []);

      if (view === 'dashboard' && admin && typeof response === 'object' && response !== null && !Array.isArray(response)) {
        const summary = response as Row;
        setRows([
          {
            id: 'summary',
            kind: 'summary',
            student_count: summary.students,
            active_students: summary.active_students,
            exam_count: summary.exams,
            active_exams: summary.active_exams,
            attempts: summary.attempts,
            in_progress: summary.in_progress,
            terminated: summary.terminated,
            open_tickets: summary.open_tickets,
          },
        ]);
      } else {
        setRows(normalized);
      }

      pageRef.current = nextPage;
      setPage(nextPage);
      setLastLoaded(new Date());
    } catch (e) {
      setNotice((e as Error).message);
    }
  }

  useEffect(() => {
    setRows([]);
    setNotice('');
    void load(1);

    if (view === 'assignments' && admin) {
      void Promise.all([api<Row[]>('/api/admin/exams'), api<typeof people>('/api/admin/personnel')])
        .then(([examRows, staffRows]) => {
          setExams(examRows);
          setPeople(staffRows);
        })
        .catch((e) => setNotice((e as Error).message));
    }

    const onVisible = () => {
      if (!document.hidden) void load();
    };
    document.addEventListener('visibilitychange', onVisible);

    const timer =
      view === 'sessions' || view === 'violations'
        ? window.setInterval(() => {
            if (!document.hidden) void load();
          }, 45_000)
        : 0;

    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      if (timer) clearInterval(timer);
    };
  }, [path, view, admin]);

  async function report(id: string, nextPage = 1) {
    setSelectedExam(id);
    if (!id) {
      setResults([]);
      resultCursors.current = [0];
      return;
    }
    setBusy(true);
    try {
      const cursor = nextPage === 1 ? 0 : resultCursors.current[nextPage - 1] ?? 0;
      const data = await api<{ items: Row[]; next_cursor: number | null }>(
        `/api/teacher/exams/${id}/results?cursor=${cursor}`
      );
      setResults(data.items);
      setResultPage(nextPage);
      if (nextPage === 1) resultCursors.current = [0];
      if (data.next_cursor !== null) resultCursors.current[nextPage] = data.next_cursor;
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function exportResults() {
    const exam = rows.find((row) => String(row.id) === selectedExam);
    const name = String(exam?.name ?? `ujian-${selectedExam}`);
    setBusy(true);
    setNotice('Menyiapkan seluruh hasil ujian peserta…');
    try {
      const all: Row[] = [];
      let cursor = 0;
      for (let next = 0; next < 10000; next++) {
        const response = await api<{ items: Row[]; next_cursor: number | null }>(
          `/api/teacher/exams/${selectedExam}/results?cursor=${cursor}`
        );
        all.push(...response.items);
        if (response.next_cursor === null) break;
        cursor = response.next_cursor;
      }
      await exportExcel(`hasil-${safeFilename(name)}.xlsx`, [
        {
          name: 'Hasil Ujian',
          rows: [
            ['NISN', 'Nama Siswa', 'Kelas', 'Status', 'Nilai', 'Benar', 'Salah', 'Kosong', 'Waktu Selesai'],
            ...all.map((row) => [
              row.nisn,
              row.name_snapshot,
              row.class_snapshot,
              row.status,
              row.score,
              row.correct_count,
              row.wrong_count,
              row.blank_count,
              row.completed_at,
            ]),
          ],
          widths: [18, 32, 18, 16, 12, 10, 10, 10, 24],
        },
      ]);
      setNotice(`${all.length} hasil ujian peserta berhasil diekspor ke Excel.`);
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function addAssignment(event: React.FormEvent) {
    event.preventDefault();
    if (!personId) return;
    setBusy(true);
    try {
      const body = {
        teacher_id: personType === 'teacher' ? Number(personId) : null,
        employee_id: personType === 'employee' ? Number(personId) : null,
        exam_id: assignedExam ? Number(assignedExam) : null,
        duty_role: duty,
      };
      await api(editingAssignmentId ? `/api/admin/teacher-assignments/${editingAssignmentId}` : '/api/admin/teacher-assignments', {
        method: editingAssignmentId ? 'PUT' : 'POST',
        body,
      });
      setNotice(editingAssignmentId ? 'Perubahan penugasan tersimpan' : 'Penugasan guru / piket tersimpan');
      setEditingAssignmentId(null);
      setPersonId('');
      setAssignedExam('');
      setDuty('TEACHER');
      await load();
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function editAssignment(row: Row) {
    setEditingAssignmentId(Number(row.id));
    setPersonType(row.teacher_id ? 'teacher' : 'employee');
    setPersonId(String(row.teacher_id ?? row.employee_id ?? ''));
    setAssignedExam(String(row.exam_id ?? ''));
    setDuty(String(row.duty_role) === 'PROCTOR' ? 'PROCTOR' : 'TEACHER');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function removeAssignment(id: number) {
    if (!confirm('Apakah Anda yakin ingin menghapus penugasan ini?')) return;
    setBusy(true);
    try {
      await api(`/api/admin/teacher-assignments/${id}`, { method: 'DELETE' });
      setNotice('Penugasan berhasil dihapus.');
      await load();
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function terminateSession(id: string) {
    if (!confirm('Akhiri sesi peserta ini dan hitung nilai berdasarkan jawaban yang sudah tersimpan?')) return;
    setBusy(true);
    setNotice('');
    try {
      await api(`/api/admin/live-sessions/${encodeURIComponent(id)}/terminate`, { method: 'POST', body: {} });
      setNotice('Sesi peserta dihentikan dan jawaban berhasil difinalisasi.');
      await load();
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function resetAttempt(studentId: number, examId: number) {
    const reason = window.prompt('Tuliskan alasan membuka kembali sesi siswa (misal: gangguan perangkat):');
    if (!reason?.trim()) return;
    setBusy(true);
    setNotice('');
    try {
      await api(`/api/staff/students/${studentId}/reset`, {
        method: 'POST',
        body: { exam_id: examId, reason: reason.trim() },
      });
      setNotice('Sesi CBT berhasil dibuka kembali. Jawaban dan sisa waktu peserta tetap aman.');
      await load();
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleEligibility(person: Row) {
    setBusy(true);
    try {
      await api(`/api/admin/teachers/${person.id}/proctor-eligibility`, {
        method: 'POST',
        body: { eligible: !Boolean(person.proctor_eligible) },
      });
      setPeople((prev) => ({
        ...prev,
        teachers: prev.teachers.map((row) =>
          row.id === person.id ? { ...row, proctor_eligible: !Boolean(row.proctor_eligible) } : row
        ),
      }));
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const examRows = rows.map((row) => ({
    id: row.id,
    name: row.name ?? row.nama_ujian,
    grade: row.grade ?? row.tingkat,
    starts_at: row.starts_at,
    ends_at: row.ends_at,
    status: row.status,
    attempts: row.attempts,
    in_progress: row.in_progress,
  }));

  const sessionExams = [...new Map(rows.map((row) => [String(row.exam_id), String(row.exam_name)])).entries()];
  const sessionClasses = [...new Set(rows.map((row) => String(row.class_snapshot ?? '')).filter(Boolean))].sort();
  const sessionGrades = [...new Set(rows.map((row) => String(row.grade ?? '')).filter(Boolean))].sort();
  const sessionSubjects = [...new Set(rows.map((row) => String(row.subject_name ?? '')).filter(Boolean))].sort();

  const visibleSessions = rows.filter(
    (row) =>
      (!sessionExam || String(row.exam_id) === sessionExam) &&
      (!sessionClass || String(row.class_snapshot) === sessionClass) &&
      (!sessionGrade || String(row.grade) === sessionGrade) &&
      (!sessionSubject || String(row.subject_name) === sessionSubject) &&
      (sessionStatus === 'ALL' || String(row.status) === sessionStatus) &&
      (sessionConnection === 'ALL' || (sessionConnection === 'ONLINE') === isSessionConnected(row))
  );

  const viewTitles: Record<string, string> = {
    dashboard: 'Ringkasan & Beranda',
    sessions: 'Pemantauan Sesi Berlangsung',
    violations: 'Catatan Pelanggaran Siswa',
    assignments: 'Penugasan Guru & Piket',
    teacherExams: 'Ujian yang Diampu',
    teacherResults: 'Rekap Nilai Siswa',
  };

  const viewSubtitles: Record<string, string> = {
    dashboard: 'Pantau aktivitas dan status pelaksanaan ujian di Arena secara menyeluruh.',
    sessions: 'Pantau keaktifan peserta, status koneksi internet, dan kendala teknis secara langsung.',
    violations: 'Tinjau riwayat sinyal kecurangan seperti berpindah tab atau keluar dari layar penuh.',
    assignments: 'Atur guru pengampu mata pelajaran, jadwal pengawas ruang, dan kelayakan petugas.',
    teacherExams: 'Daftar asesmen dan ujian yang ditugaskan untuk mata pelajaran Anda.',
    teacherResults: 'Pilih ujian untuk melihat hasil penilaian, butir jawaban, dan unduh ke format Excel.',
  };

  return (
    <div className="operations-page staff-workspace-container">
      {/* Heading Bar */}
      <div className="operations-heading">
        <div>
          <span className="section-kicker">{admin ? 'AREA PENGELOLA & PROKTOR' : 'PORTAL GURU & PENGAWAS'}</span>
          <h2>{viewTitles[view] ?? 'Ruang Kerja Arena'}</h2>
          <p>{viewSubtitles[view] ?? 'Pantau pelaksanaan ujian dan hasil asesmen peserta.'}</p>
        </div>
        <button className="btn btn-secondary" disabled={busy} onClick={() => void load()}>
          <i className="fa-solid fa-rotate-right" /> Perbarui Data
        </button>
      </div>

      {lastLoaded && (
        <div className="operations-refresh-note">
          <i className="fa-regular fa-clock" style={{ marginRight: '6px' }} />
          Terakhir diperbarui: {lastLoaded.toLocaleTimeString('id-ID')} WIB
          {view === 'sessions' || view === 'violations' ? ' · Diperbarui otomatis tiap 45 detik' : ''}
        </div>
      )}

      {notice && (
        <p role="status" className="arena-notice">
          <i className="fa-solid fa-circle-info" style={{ marginRight: '8px' }} />
          {notice}
        </p>
      )}

      {/* View: Dashboard Admin */}
      {view === 'dashboard' && admin && (
        <AdminOverview
          summary={rows[0] ?? {}}
          onNavigate={onNavigate ?? (() => undefined)}
          onCreateExam={onCreateExam ?? (() => onNavigate?.('exams'))}
        />
      )}

      {/* View: Dashboard Pengawas Non-Guru */}
      {view === 'dashboard' && !admin && !canTeach && <ProctorOverview canProctor={canProctor} onNavigate={onNavigate} />}

      {/* View: Dashboard Guru yang Juga Pengawas */}
      {view === 'dashboard' && !admin && canTeach && canProctor && (
        <ProctorOverview canProctor onNavigate={onNavigate} compact />
      )}

      {/* View: Dashboard Guru / Ujian Guru / Hasil Belajar */}
      {['dashboard', 'teacherExams', 'teacherResults'].includes(view) && !admin && canTeach && (
        <div className="teacher-home staff-workspace-container">
          <section className="teacher-welcome-card">
            <div>
              <span className="section-kicker">PORTAL GURU · MANSAPA ARENA</span>
              <h2>
                {view === 'teacherResults'
                  ? 'Rekap Hasil Belajar Siswa'
                  : view === 'teacherExams'
                  ? 'Daftar Ujian Mata Pelajaran Anda'
                  : 'Selamat Datang di Portal Guru'}
              </h2>
              <p>Kelola asesmen belajar, pantau kehadiran siswa, dan tinjau capaian nilai dengan praktis.</p>
            </div>
            <div className="teacher-welcome-icon">
              <i className="fa-solid fa-chalkboard-user" />
            </div>
          </section>

          <section className="staff-metric-grid" aria-label="Ringkasan Ujian Guru">
            <article className="staff-metric primary">
              <i className="fa-solid fa-book-open" />
              <div>
                <small>Ujian Diampu</small>
                <strong>{examRows.length}</strong>
                <span>Total penugasan aktif</span>
              </div>
            </article>

            <article className="staff-metric">
              <i className="fa-solid fa-users" />
              <div>
                <small>Peserta Terdata</small>
                <strong>{examRows.reduce((sum, row) => sum + Number(row.attempts ?? 0), 0)}</strong>
                <span>Total siswa mengerjakan</span>
              </div>
            </article>

            <article className="staff-metric">
              <i className="fa-solid fa-chart-line" />
              <div>
                <small>Sedang Mengerjakan</small>
                <strong>{examRows.reduce((sum, row) => sum + Number(row.in_progress ?? 0), 0)}</strong>
                <span>Sesi aktif sekarang</span>
              </div>
            </article>
          </section>

          <section className="teacher-exam-section">
            <header className="teacher-exam-section-head">
              <div>
                <span className="section-kicker">DAFTAR PENUGASAN</span>
                <h3>{view === 'teacherResults' ? 'Pilih Ujian untuk Melihat Nilai' : 'Ujian yang Anda Kelola'}</h3>
                <p>
                  {examRows.length
                    ? `${examRows.length} ujian tersedia untuk akun Anda.`
                    : 'Ujian yang ditugaskan oleh admin akan muncul di bagian ini.'}
                </p>
              </div>
              {view === 'dashboard' && (
                <button type="button" className="btn btn-secondary" onClick={() => onNavigate?.('results')}>
                  Lihat Rekap Lengkap <i className="fa-solid fa-arrow-right" style={{ marginLeft: '6px' }} />
                </button>
              )}
            </header>

            {examRows.length ? (
              <div className="teacher-exam-grid">
                {examRows.map((row) => (
                  <article className="teacher-exam-card" key={String(row.id)}>
                    <div className="teacher-exam-card-top">
                      <span className={`badge-status is-${String(row.status ?? '').toLowerCase()}`}>
                        <i className="fa-solid fa-circle" /> {getStatusLabel(row.status)}
                      </span>
                      <span className="teacher-exam-session">ID #{String(row.id)}</span>
                    </div>
                    <h4>{getRowValue(row, 'name')}</h4>
                    <div className="teacher-exam-schedule">
                      <i className="fa-regular fa-calendar" />
                      <span>{formatTeacherDate(row.starts_at)}</span>
                    </div>
                    <div className="teacher-exam-stats">
                      <span>
                        <strong>{Number(row.attempts ?? 0)}</strong> peserta terdata
                      </span>
                      <span>
                        <strong>{Number(row.in_progress ?? 0)}</strong> sedang ujian
                      </span>
                    </div>
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={busy}
                      onClick={() => void report(String(row.id))}
                    >
                      Buka Hasil Nilai <i className="fa-solid fa-arrow-right" style={{ marginLeft: '6px' }} />
                    </button>
                  </article>
                ))}
              </div>
            ) : (
              <div className="teacher-empty-state">
                <i className="fa-regular fa-folder-open" style={{ fontSize: '26px' }} />
                <strong>Belum Ada Ujian yang Ditugaskan</strong>
                <p>Ujian mata pelajaran Anda akan tampil di sini setelah ditetapkan oleh pengelola kurikulum.</p>
              </div>
            )}
          </section>

          {/* Tabel Hasil Peserta yang Dipilih */}
          {selectedExam && (
            <section className="operations-filter-card" style={{ marginTop: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap', marginBottom: '16px' }}>
                <div>
                  <span className="section-kicker">HASIL ASESMEN</span>
                  <h3 style={{ margin: '4px 0 0', fontSize: '18px', fontWeight: 800 }}>
                    Hasil Ujian · {String(examRows.find((row) => String(row.id) === selectedExam)?.name ?? `#${selectedExam}`)}
                  </h3>
                  <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>
                    Rincian nilai dan statistik jawaban benar, salah, dan kosong dari peserta.
                  </p>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={busy || !results.length}
                  onClick={() => void exportResults()}
                >
                  <i className="fa-solid fa-file-excel" /> Unduh Format Excel
                </button>
              </div>

              <div className="arena-table-container">
                <table className="arena-data-table">
                  <thead>
                    <tr>
                      <th>NISN</th>
                      <th>Nama Siswa</th>
                      <th>Kelas</th>
                      <th>Status Ujian</th>
                      <th>Nilai Akhir</th>
                      <th>Benar</th>
                      <th>Salah</th>
                      <th>Kosong</th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.map((row, index) => (
                      <tr key={`${String(row.nisn)}-${index}`}>
                        <td><strong>{getRowValue(row, 'nisn')}</strong></td>
                        <td>{getRowValue(row, 'name_snapshot')}</td>
                        <td>{getRowValue(row, 'class_snapshot')}</td>
                        <td>
                          <span className={`badge-status is-${String(row.status ?? '').toLowerCase()}`}>
                            {getStatusLabel(row.status)}
                          </span>
                        </td>
                        <td>
                          <span style={{ fontSize: '15px', fontWeight: 800, color: 'var(--primary-dark)' }}>
                            {getRowValue(row, 'score')}
                          </span>
                        </td>
                        <td style={{ color: '#16a34a', fontWeight: 700 }}>{getRowValue(row, 'correct_count')}</td>
                        <td style={{ color: '#dc2626', fontWeight: 700 }}>{getRowValue(row, 'wrong_count')}</td>
                        <td style={{ color: '#6b7280' }}>{getRowValue(row, 'blank_count')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!results.length && (
                  <div className="operations-empty">
                    <i className="fa-regular fa-folder" />
                    <strong>Belum Ada Hasil Tersimpan</strong>
                    <span>Hasil penilaian peserta akan muncul setelah siswa menyelesaikan ujian.</span>
                  </div>
                )}
              </div>

              <div className="operations-pagination">
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={busy || resultPage <= 1}
                  onClick={() => void report(selectedExam, resultPage - 1)}
                >
                  <i className="fa-solid fa-chevron-left" /> Halaman Sebelumnya
                </button>
                <span style={{ fontWeight: 700 }}>Halaman {resultPage}</span>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={busy || results.length < 100}
                  onClick={() => void report(selectedExam, resultPage + 1)}
                >
                  Halaman Berikutnya <i className="fa-solid fa-chevron-right" />
                </button>
              </div>
            </section>
          )}
        </div>
      )}

      {/* View: Monitoring Sesi Berlangsung */}
      {view === 'sessions' && (
        <div className="operations-monitor staff-workspace-container">
          {/* Status Pills */}
          <div className="operations-status-summary-bar">
            <span className="status-pill neutral">
              <i className="fa-solid fa-users" /> <strong>{rows.filter((r) => r.status === 'IN_PROGRESS').length}</strong> Sesi Berjalan
            </span>
            <span className="status-pill online">
              <i className="fa-solid fa-circle" /> <strong>{rows.filter((r) => r.status === 'IN_PROGRESS' && isSessionConnected(r)).length}</strong> Terhubung (Online)
            </span>
            <span className="status-pill offline">
              <i className="fa-solid fa-circle-exclamation" /> <strong>{rows.filter((r) => r.status === 'IN_PROGRESS' && !isSessionConnected(r)).length}</strong> Terputus (Offline)
            </span>
            <span className="status-pill terminated">
              <i className="fa-solid fa-ban" /> <strong>{rows.filter((r) => r.status === 'TERMINATED').length}</strong> Dihentikan (24 jam)
            </span>
          </div>

          {/* Form Filter Responsif */}
          <div className="operations-filter-card">
            <div className="operations-filter-grid">
              <label>
                Pilih Ujian
                <select value={sessionExam} onChange={(e) => setSessionExam(e.target.value)}>
                  <option value="">Semua Ujian</option>
                  {sessionExams.map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Kelas
                <select value={sessionClass} onChange={(e) => setSessionClass(e.target.value)}>
                  <option value="">Semua Kelas</option>
                  {sessionClasses.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Tingkat
                <select value={sessionGrade} onChange={(e) => setSessionGrade(e.target.value)}>
                  <option value="">Semua Tingkat</option>
                  {sessionGrades.map((grade) => (
                    <option key={grade} value={grade}>
                      Tingkat {grade}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Mata Pelajaran
                <select value={sessionSubject} onChange={(e) => setSessionSubject(e.target.value)}>
                  <option value="">Semua Mapel</option>
                  {sessionSubjects.map((sub) => (
                    <option key={sub} value={sub}>
                      {sub}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Status Peserta
                <select value={sessionStatus} onChange={(e) => setSessionStatus(e.target.value)}>
                  <option value="IN_PROGRESS">Sedang Mengerjakan</option>
                  <option value="TERMINATED">Dihentikan</option>
                  <option value="ALL">Semua Status</option>
                </select>
              </label>

              <label>
                Kondisi Koneksi
                <select value={sessionConnection} onChange={(e) => setSessionConnection(e.target.value)}>
                  <option value="ALL">Semua Koneksi</option>
                  <option value="ONLINE">Terhubung (Aktif)</option>
                  <option value="OFFLINE">Terputus (&gt;90s)</option>
                </select>
              </label>
            </div>
          </div>

          {/* Tabel Sesi Peserta */}
          <div className="arena-table-container">
            <table className="arena-data-table">
              <thead>
                <tr>
                  <th>Peserta</th>
                  <th>Kelas</th>
                  <th>Ujian & Sesi</th>
                  <th>Status</th>
                  <th>Waktu Mulai</th>
                  <th>Batas Waktu</th>
                  <th>Pelanggaran</th>
                  <th>Kondisi Koneksi</th>
                  <th>Aktivitas Terakhir</th>
                  {admin && <th>Aksi Proktor</th>}
                </tr>
              </thead>
              <tbody>
                {visibleSessions.map((row) => {
                  const connected = isSessionConnected(row);
                  return (
                    <tr key={String(row.public_id)}>
                      <td>
                        <strong>{getRowValue(row, 'name_snapshot')}</strong>
                        <br />
                        <small style={{ color: 'var(--text-muted)' }}>NISN: {getRowValue(row, 'nisn')}</small>
                      </td>
                      <td>{getRowValue(row, 'class_snapshot')}</td>
                      <td>{getRowValue(row, 'exam_name')}</td>
                      <td>
                        <span className={`badge-status is-${String(row.status).toLowerCase()}`}>
                          {getStatusLabel(row.status)}
                        </span>
                      </td>
                      <td>
                        <small>{new Date(String(row.started_at)).toLocaleTimeString('id-ID')} WIB</small>
                      </td>
                      <td>
                        <small>{new Date(String(row.expires_at)).toLocaleTimeString('id-ID')} WIB</small>
                      </td>
                      <td>
                        <span style={{ fontWeight: 800, color: Number(row.violation_count ?? 0) > 0 ? '#dc2626' : 'inherit' }}>
                          {getRowValue(row, 'violation_count')}
                        </span>
                      </td>
                      <td>
                        {row.status === 'TERMINATED' ? (
                          <span className="badge-status is-archived">Dihentikan</span>
                        ) : connected ? (
                          <span className="badge-status is-connected">
                            <i className="fa-solid fa-circle" /> Terhubung
                          </span>
                        ) : (
                          <span className="badge-status is-disconnected">
                            <i className="fa-solid fa-circle" /> Terputus
                          </span>
                        )}
                      </td>
                      <td>
                        <small>
                          {row.last_seen_at
                            ? new Date(String(row.last_seen_at)).toLocaleTimeString('id-ID') + ' WIB'
                            : '—'}
                        </small>
                      </td>
                      {admin && (
                        <td>
                          {row.status === 'IN_PROGRESS' && (
                            <button
                              type="button"
                              className="btn-table btn-table-danger"
                              disabled={busy}
                              onClick={() => void terminateSession(String(row.public_id))}
                            >
                              <i className="fa-solid fa-stop" /> Akhiri Sesi
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!visibleSessions.length && (
              <div className="operations-empty">
                <i className="fa-solid fa-filter-circle-xmark" />
                <strong>Tidak Ada Sesi Peserta Sesuai Filter</strong>
                <span>Ubah pilihan ujian, kelas, atau status untuk melihat data sesi.</span>
              </div>
            )}
          </div>

          <div className="operations-pagination">
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy || page <= 1}
              onClick={() => void load(page - 1)}
            >
              <i className="fa-solid fa-chevron-left" /> Halaman Sebelumnya
            </button>
            <span style={{ fontWeight: 700 }}>Halaman {page}</span>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy || rows.length < 100}
              onClick={() => void load(page + 1)}
            >
              Halaman Berikutnya <i className="fa-solid fa-chevron-right" />
            </button>
          </div>
        </div>
      )}

      {/* View: Log Pelanggaran */}
      {view === 'violations' && (
        <div className="operations-violations staff-workspace-container">
          <div className="arena-table-container">
            <table className="arena-data-table">
              <thead>
                <tr>
                  <th>Waktu Kejadian</th>
                  <th>Peserta & NISN</th>
                  <th>Ujian</th>
                  <th>Jenis Pelanggaran</th>
                  {admin && <th>Perangkat & IP</th>}
                  <th>Frekuensi</th>
                  <th>Status Sesi</th>
                  <th>Aksi Pemulihan</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={String(row.id)}>
                    <td>
                      <small>
                        {new Date(String(row.occurred_at)).toLocaleString('id-ID', {
                          timeZone: 'Asia/Jakarta',
                          day: 'numeric',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}{' '}
                        WIB
                      </small>
                    </td>
                    <td>
                      <strong>{getRowValue(row, 'name_snapshot')}</strong>
                      <br />
                      <small style={{ color: 'var(--text-muted)' }}>NISN: {getRowValue(row, 'nisn')}</small>
                    </td>
                    <td>{getRowValue(row, 'exam_name')}</td>
                    <td>
                      <span className="badge-status is-disconnected">
                        <i className="fa-solid fa-triangle-exclamation" /> {getViolationLabel(row.type)}
                      </span>
                      {row.question_no != null && (
                        <small style={{ display: 'block', color: 'var(--text-muted)' }}>
                          Soal #{Number(row.question_no)}
                        </small>
                      )}
                    </td>
                    {admin && (
                      <td>
                        <small style={{ fontFamily: 'monospace' }}>{getRowValue(row, 'ip_address')}</small>
                      </td>
                    )}
                    <td>
                      <span style={{ fontSize: '14px', fontWeight: 800, color: '#dc2626' }}>
                        {getRowValue(row, 'violation_count')}x
                      </span>
                    </td>
                    <td>
                      <span className={`badge-status is-${String(row.attempt_status).toLowerCase()}`}>
                        {getStatusLabel(row.attempt_status)}
                      </span>
                    </td>
                    <td>
                      {admin &&
                        row.attempt_status === 'TERMINATED' &&
                        Number(row.violation_count) >= 2 && (
                          <button
                            type="button"
                            className="btn-table btn-table-warning"
                            disabled={busy}
                            onClick={() => void resetAttempt(Number(row.student_id), Number(row.exam_id))}
                          >
                            <i className="fa-solid fa-unlock" /> Buka Kunci Siswa
                          </button>
                        )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!rows.length && (
              <div className="operations-empty">
                <i className="fa-solid fa-shield-check" style={{ color: '#16a34a' }} />
                <strong>Tidak Ada Catatan Pelanggaran</strong>
                <span>Semua sesi ujian berlangsung tertib tanpa laporan indikasi pelanggaran.</span>
              </div>
            )}
          </div>

          <div className="operations-pagination">
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy || page <= 1}
              onClick={() => void load(page - 1)}
            >
              <i className="fa-solid fa-chevron-left" /> Halaman Sebelumnya
            </button>
            <span style={{ fontWeight: 700 }}>Halaman {page}</span>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy || rows.length < 100}
              onClick={() => void load(page + 1)}
            >
              Halaman Berikutnya <i className="fa-solid fa-chevron-right" />
            </button>
          </div>
        </div>
      )}

      {/* View: Penugasan Guru & Piket */}
      {view === 'assignments' && admin && (
        <div className="operations-assignments staff-workspace-container">
          <form className="operations-filter-card" onSubmit={(e) => void addAssignment(e)}>
            <div style={{ marginBottom: '14px' }}>
              <span className="section-kicker">MANAJEMEN PETUGAS</span>
              <h3 style={{ margin: '4px 0 0', fontSize: '18px', fontWeight: 800 }}>
                {editingAssignmentId ? 'Ubah Penugasan Guru / Piket' : 'Tetapkan Penugasan Guru / Pengawas'}
              </h3>
              <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>
                Tentukan guru pengampu ujian atau proktor ruang untuk memantau pelaksanaan ujian.
              </p>
            </div>

            <div className="operations-filter-grid">
              <label>
                Kategori Personel
                <select
                  value={personType}
                  onChange={(e) => {
                    setPersonType(e.target.value as 'teacher' | 'employee');
                    setPersonId('');
                  }}
                >
                  <option value="teacher">Dewan Guru</option>
                  <option value="employee">Staf / Pegawai</option>
                </select>
              </label>

              <label>
                Pilih Nama Personel
                <select required value={personId} onChange={(e) => setPersonId(e.target.value)}>
                  <option value="">-- Pilih Guru / Pegawai --</option>
                  {(personType === 'teacher' ? people.teachers : people.employees)
                    .filter((person) => person.status === 'ACTIVE' || String(person.id) === personId)
                    .map((person) => (
                      <option key={String(person.id)} value={String(person.id)}>
                        {getRowValue(person, 'name')}
                      </option>
                    ))}
                </select>
              </label>

              <label>
                Peran Tugas
                <select value={duty} onChange={(e) => setDuty(e.target.value as 'TEACHER' | 'PROCTOR')}>
                  <option value="TEACHER">Guru Pengampu Mata Pelajaran</option>
                  <option value="PROCTOR">Pengawas Ujian (Proktor)</option>
                </select>
              </label>

              <label>
                Target Ujian
                <select value={assignedExam} onChange={(e) => setAssignedExam(e.target.value)}>
                  <option value="">Semua Ujian (Khusus Pengawas)</option>
                  {exams.map((exam) => (
                    <option key={String(exam.id)} value={String(exam.id)}>
                      {getRowValue(exam, 'name')}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div style={{ marginTop: '16px', display: 'flex', gap: '10px' }}>
              <button className="btn btn-primary" disabled={busy || !personId || (!assignedExam && duty === 'TEACHER')}>
                <i className="fa-solid fa-floppy-disk" /> Simpan Penugasan
              </button>
              {editingAssignmentId && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={busy}
                  onClick={() => {
                    setEditingAssignmentId(null);
                    setPersonId('');
                    setAssignedExam('');
                    setDuty('TEACHER');
                  }}
                >
                  Batal Edit
                </button>
              )}
            </div>
          </form>

          {/* Tabel Penugasan Aktif */}
          <div className="arena-table-container">
            <table className="arena-data-table">
              <thead>
                <tr>
                  <th>Nama Personel</th>
                  <th>Peran Penugasan</th>
                  <th>Ujian Terkait</th>
                  <th>Tindakan</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={String(row.id)}>
                    <td>
                      <strong>{String(row.teacher_name ?? row.employee_name)}</strong>
                    </td>
                    <td>
                      <span className={`badge-status is-${String(row.duty_role).toLowerCase()}`}>
                        {String(row.duty_role) === 'PROCTOR' ? 'Pengawas Ruang' : 'Guru Pengampu'}
                      </span>
                    </td>
                    <td>{row.exam_name ? String(row.exam_name) : 'Seluruh Jadwal Ujian'}</td>
                    <td>
                      <div className="table-action-group">
                        <button
                          type="button"
                          className="btn-table"
                          disabled={busy}
                          onClick={() => editAssignment(row)}
                        >
                          <i className="fa-solid fa-pen-to-square" /> Ubah
                        </button>
                        <button
                          type="button"
                          className="btn-table btn-table-danger"
                          disabled={busy}
                          onClick={() => void removeAssignment(Number(row.id))}
                        >
                          <i className="fa-solid fa-trash" /> Hapus
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!rows.length && (
              <div className="operations-empty">
                <i className="fa-solid fa-user-plus" />
                <strong>Belum Ada Penugasan Terdaftar</strong>
                <span>Gunakan formulir di atas untuk menetapkan guru pengampu dan pengawas ujian.</span>
              </div>
            )}
          </div>

          {/* Kelayakan Pengawas */}
          <section className="operations-filter-card" style={{ marginTop: '20px' }}>
            <div style={{ marginBottom: '12px' }}>
              <span className="section-kicker">IZIN PENGAWAS</span>
              <h3 style={{ margin: '4px 0 0', fontSize: '16px', fontWeight: 800 }}>
                Kelayakan Pengawas bagi Guru
              </h3>
              <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>
                Centang nama guru yang diizinkan memantau sesi dan mengambil tiket bantuan peserta.
              </p>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '8px' }}>
              {people.teachers.map((person) => (
                <label
                  key={String(person.id)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '8px 12px',
                    border: '1px solid var(--border)',
                    borderRadius: '10px',
                    background: 'var(--surface)',
                    cursor: 'pointer',
                    fontSize: '12.5px',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={Boolean(person.proctor_eligible)}
                    disabled={busy}
                    onChange={() => void toggleEligibility(person)}
                  />
                  <span>{getRowValue(person, 'name')}</span>
                </label>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
