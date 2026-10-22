import { useEffect, useState } from 'react';
import { api } from './lib/api';

type Row = Record<string, unknown>;
type Route = 'exams' | 'questions' | 'students' | 'results' | 'followups' | 'sessions' | 'tickets';

const parseNumber = (val: unknown): number => Number(val ?? 0) || 0;

interface AdminOverviewProps {
  summary: Row;
  onNavigate: (route: Route) => void;
  onCreateExam: () => void;
}

export function AdminOverview({ summary, onNavigate, onCreateExam }: AdminOverviewProps) {
  const [exams, setExams] = useState<Row[] | null>(null);
  const [results, setResults] = useState<Row[] | null>(null);
  const [followups, setFollowups] = useState<Row[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);

    const tasks = [
      api<Row[]>('/api/admin/exams'),
      api<{ items: Row[] }>('/api/admin/results?limit=200'),
      api<{ schedules: Row[] }>('/api/admin/follow-ups'),
    ] as const;

    void Promise.allSettled(tasks).then((items) => {
      if (!active) return;
      const [examResult, resultResult, followupResult] = items;

      if (examResult.status === 'fulfilled') setExams(examResult.value);
      if (resultResult.status === 'fulfilled') setResults(resultResult.value.items ?? []);
      if (followupResult.status === 'fulfilled') setFollowups(followupResult.value.schedules ?? []);

      if (items.some((item) => item.status === 'rejected')) {
        setNotice('Sebagian ringkasan belum tersedia. Buka menu terkait untuk melihat data terbaru.');
      }
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, []);

  const now = Date.now();
  const schedule = (exams ?? [])
    .filter((exam) => String(exam.status) === 'ACTIVE' && new Date(String(exam.ends_at)).getTime() >= now)
    .sort((a, b) => new Date(String(a.starts_at)).getTime() - new Date(String(b.starts_at)).getTime())
    .slice(0, 5);

  const bands = Array.from({ length: 5 }, (_, index) => {
    const min = index * 20;
    const max = index * 20 + 19;
    const count = (results ?? []).filter((row) => {
      const score = Number(row.score);
      return Number.isFinite(score) && score >= min && (index === 4 ? score <= 100 : score < min + 20);
    }).length;
    return { label: `${min}–${index === 4 ? 100 : max}`, count };
  });

  const maxBand = Math.max(1, ...bands.map((band) => band.count));
  const followupCount = (type: string) => (followups ?? []).filter((row) => row.type === type).length;
  const followupLabel = (type: string) => (followups === null ? 'Belum tersedia' : `${followupCount(type)} jadwal terdaftar`);

  return (
    <div className="arena-admin-overview staff-workspace-container">
      {/* 1. Hero Section */}
      <section className="arena-overview-hero" aria-label="Ringkasan Utama">
        <div>
          <span className="section-kicker">RUANG KERJA CBT · PUSAT KONTROL</span>
          <h2>Dashboard Pengelola & Guru</h2>
          <p>Kelola jadwal ujian, pantau koneksi peserta real-time, dan unduh rekap nilai dengan mudah.</p>
        </div>
        <div className="arena-overview-actions">
          <button className="btn btn-primary" type="button" onClick={onCreateExam}>
            <i className="fa-solid fa-plus" /> Buat Ujian Baru
          </button>
          <button className="btn btn-secondary" type="button" onClick={() => onNavigate('results')}>
            <i className="fa-solid fa-file-excel" /> Rekap Nilai
          </button>
        </div>
      </section>

      {/* 2. Panduan Alur Kerja CBT untuk Orang Awam */}
      <section aria-labelledby="cbt-flow-title">
        <div style={{ marginBottom: '8px' }}>
          <span className="section-kicker">ALUR KERJA CBT</span>
          <h3 id="cbt-flow-title" style={{ margin: '4px 0 0', fontSize: '16px', fontWeight: 800 }}>
            Panduan Cepat Pelaksanaan Ujian
          </h3>
        </div>
        <div className="staff-workflow-guide">
          <button type="button" className="staff-workflow-step" onClick={onCreateExam}>
            <span className="staff-workflow-step-num">1</span>
            <strong>Buat Jadwal Ujian</strong>
            <span>Tentukan waktu, tingkat kelas, durasi, dan mata pelajaran.</span>
          </button>
          <button type="button" className="staff-workflow-step" onClick={() => onNavigate('questions')}>
            <span className="staff-workflow-step-num">2</span>
            <strong>Isi Bank Soal</strong>
            <span>Masukkan butir soal, kunci jawaban, dan pembahasan materi.</span>
          </button>
          <button type="button" className="staff-workflow-step" onClick={() => onNavigate('sessions')}>
            <span className="staff-workflow-step-num">3</span>
            <strong>Pantau Sesi Ujian</strong>
            <span>Lihat siswa yang sedang aktif ujian dan bantu kendala teknis.</span>
          </button>
          <button type="button" className="staff-workflow-step" onClick={() => onNavigate('results')}>
            <span className="staff-workflow-step-num">4</span>
            <strong>Unduh Nilai & Laporan</strong>
            <span>Cetak rekap nilai resmi atau ekspor ke format Microsoft Excel.</span>
          </button>
        </div>
      </section>

      {/* 3. Kartu Metrik Utama */}
      <section className="staff-metric-grid" aria-label="Statistik Asesmen">
        <button className="staff-metric primary" type="button" onClick={() => onNavigate('students')}>
          <i className="fa-solid fa-users" />
          <div>
            <small>Siswa Aktif</small>
            <strong>{parseNumber(summary.active_students).toLocaleString('id-ID')}</strong>
            <span>{parseNumber(summary.student_count).toLocaleString('id-ID')} total siswa terdata</span>
          </div>
        </button>

        <button className="staff-metric" type="button" onClick={() => onNavigate('exams')}>
          <i className="fa-solid fa-file-lines" />
          <div>
            <small>Ujian Terjadwal</small>
            <strong>{parseNumber(summary.active_exams)}</strong>
            <span>{parseNumber(summary.exam_count)} total arsip ujian</span>
          </div>
        </button>

        <button className="staff-metric" type="button" onClick={() => onNavigate('sessions')}>
          <i className="fa-solid fa-signal" />
          <div>
            <small>Sesi Berlangsung</small>
            <strong>{parseNumber(summary.in_progress)}</strong>
            <span>Peserta sedang mengerjakan</span>
          </div>
        </button>

        <button className="staff-metric" type="button" onClick={() => onNavigate('tickets')}>
          <i className="fa-solid fa-headset" />
          <div>
            <small>Tiket Bantuan</small>
            <strong>{parseNumber(summary.open_tickets)}</strong>
            <span>Menunggu tindakan pengawas</span>
          </div>
        </button>
      </section>

      {/* 4. Akses Cepat Menu */}
      <nav className="arena-overview-quick" aria-label="Akses Cepat Pengelola">
        <button type="button" onClick={() => onNavigate('exams')}>
          <i className="fa-solid fa-calendar-check" />
          <span>Kelola Jadwal Ujian</span>
        </button>
        <button type="button" onClick={() => onNavigate('questions')}>
          <i className="fa-solid fa-clipboard-question" />
          <span>Kelola Bank Soal</span>
        </button>
        <button type="button" onClick={() => onNavigate('students')}>
          <i className="fa-solid fa-id-card" />
          <span>Kontrol Siswa & PIN</span>
        </button>
        <button type="button" onClick={() => onNavigate('results')}>
          <i className="fa-solid fa-square-poll-vertical" />
          <span>Rekap Hasil Asesmen</span>
        </button>
      </nav>

      {notice && (
        <p className="arena-notice" role="status">
          <i className="fa-solid fa-circle-info" style={{ marginRight: '8px' }} />
          {notice}
        </p>
      )}

      {/* 5. Ujian Khusus (Susulan & Remedial) */}
      <section className="arena-overview-special" aria-labelledby="arena-special-title">
        <div>
          <span className="section-kicker">PELAKSANAAN LANJUTAN</span>
          <h3 id="arena-special-title" style={{ margin: '4px 0 0', fontSize: '16px', fontWeight: 800 }}>
            Jadwal Susulan & Remedial
          </h3>
          <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--text-muted)' }}>
            Kelola peserta yang berhalangan hadir atau memerlukan perbaikan nilai asesmen.
          </p>
        </div>
        <div className="arena-overview-special-cards">
          <button type="button" onClick={() => onNavigate('followups')}>
            <i className="fa-solid fa-calendar-plus" />
            <div>
              <strong>Ujian Susulan</strong>
              <span>{loading ? 'Memuat data…' : followupLabel('SUSULAN')}</span>
            </div>
            <small>
              Kelola <i className="fa-solid fa-arrow-right" />
            </small>
          </button>
          <button type="button" onClick={() => onNavigate('followups')}>
            <i className="fa-solid fa-rotate-right" />
            <div>
              <strong>Ujian Remedial</strong>
              <span>{loading ? 'Memuat data…' : followupLabel('REMEDIAL')}</span>
            </div>
            <small>
              Kelola <i className="fa-solid fa-arrow-right" />
            </small>
          </button>
        </div>
      </section>

      {/* 6. Panel Visual: Distribusi Nilai & Jadwal Ujian Terdekat */}
      <div className="arena-overview-panels">
        <section className="arena-overview-panel" aria-labelledby="arena-scores-title">
          <header>
            <div>
              <h3 id="arena-scores-title">Distribusi Nilai Terkini</h3>
              <p>{results?.length ?? 0} data nilai terbaru peserta</p>
            </div>
            <button className="btn btn-secondary" type="button" onClick={() => onNavigate('results')}>
              Buka Rekap
            </button>
          </header>
          {loading ? (
            <p className="operations-empty">Memuat data sebaran nilai…</p>
          ) : results === null ? (
            <p className="operations-empty">Data nilai belum dapat dimuat.</p>
          ) : results.length ? (
            <div className="arena-score-bars">
              {bands.map((band) => (
                <div key={band.label}>
                  <span>Rentang {band.label}</span>
                  <div className="arena-score-track">
                    <span style={{ width: `${(band.count / maxBand) * 100}%` }} />
                  </div>
                  <strong>{band.count} siswa</strong>
                </div>
              ))}
            </div>
          ) : (
            <div className="operations-empty">
              <i className="fa-solid fa-chart-simple" />
              <strong>Belum ada nilai ujian tersimpan</strong>
              <span>Hasil penilaian siswa akan tampil di sini setelah ujian diselesaikan.</span>
            </div>
          )}
        </section>

        <section className="arena-overview-panel" aria-labelledby="arena-schedule-title">
          <header>
            <div>
              <h3 id="arena-schedule-title">Jadwal Ujian Aktif</h3>
              <p>Ujian yang sedang atau akan segera berlangsung</p>
            </div>
            <button className="btn btn-secondary" type="button" onClick={() => onNavigate('exams')}>
              Semua Jadwal
            </button>
          </header>
          {loading ? (
            <p className="operations-empty">Memuat jadwal ujian…</p>
          ) : exams === null ? (
            <p className="operations-empty">Data jadwal belum dapat dimuat.</p>
          ) : schedule.length ? (
            <ol className="arena-schedule-list">
              {schedule.map((exam) => (
                <li key={String(exam.id)}>
                  <div>
                    <span>{String(exam.name ?? 'Ujian CBT')}</span>
                    <br />
                    <small>
                      Tingkat {String(exam.grade ?? '—')} · Sesi {String(exam.session_number ?? 1)}
                    </small>
                  </div>
                  <small style={{ fontWeight: 700, color: 'var(--primary-dark)' }}>
                    {new Date(String(exam.starts_at)).toLocaleString('id-ID', {
                      timeZone: 'Asia/Jakarta',
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}{' '}
                    WIB
                  </small>
                </li>
              ))}
            </ol>
          ) : (
            <div className="operations-empty">
              <i className="fa-regular fa-calendar-xmark" />
              <strong>Tidak ada ujian aktif saat ini</strong>
              <span>Klik tombol "Buat Ujian Baru" untuk menjadwalkan asesmen.</span>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
