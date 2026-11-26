import { useCallback, useEffect, useState } from 'react';
import { api } from './lib/api';

type LiveSessionV2 = {
  public_id: string;
  status: string;
  started_at: string;
  expires_at: string;
  violation_count: number;
  face_status?: string;
  student_id: number;
  nisn: string;
  name_snapshot: string;
  class_snapshot: string | null;
  exam_id: number;
  exam_name: string;
  device_category?: string | null;
  browser_family?: string | null;
  os_family?: string | null;
  camera_available?: number | boolean | null;
  recording_capable?: number | boolean | null;
  recording_status?: string | null;
  uploaded_segments?: number;
  total_segments?: number;
  missing_segments?: number;
  risk_score: number;
  security_event_count: number;
  last_seen_at: string | null;
};

type SecurityEventRow = {
  id: number;
  event_key: string;
  event_type: string;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  risk_weight: number;
  server_occurred_at: string;
  duration_ms: number | null;
  review_status: 'PENDING' | 'REVIEWED' | 'DISMISSED' | 'ESCALATED';
  review_notes: string | null;
  nisn: string;
  name_snapshot: string;
  attempt_public_id: string;
};

type RecordingSegment = {
  id: number;
  sequence_number: number;
  mime_type: string;
  file_size_bytes: number | null;
  upload_status: 'PENDING' | 'UPLOADED' | 'FAILED' | 'MISSING';
  segment_started_at: string | null;
  segment_ended_at: string | null;
};

type FilterKey =
  | 'all'
  | 'active'
  | 'camera_unavailable'
  | 'face_absent'
  | 'recording_interrupted'
  | 'high_risk'
  | 'mobile'
  | 'desktop';

const FILTER_LABELS: Array<{ key: FilterKey; label: string }> = [
  { key: 'all', label: 'Semua' },
  { key: 'active', label: 'Sedang Ujian' },
  { key: 'high_risk', label: 'Risiko Tinggi' },
  { key: 'face_absent', label: 'Wajah Tidak Terlihat' },
  { key: 'camera_unavailable', label: 'Kamera Bermasalah' },
  { key: 'recording_interrupted', label: 'Rekaman Terputus' },
  { key: 'mobile', label: 'Perangkat Mobile' },
  { key: 'desktop', label: 'Desktop' },
];

export function StaffSecurityReview() {
  const [filter, setFilter] = useState<FilterKey>('all');
  const [search, setSearch] = useState('');
  const [sessions, setSessions] = useState<LiveSessionV2[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Selected attempt for timeline & video review
  const [selected, setSelected] = useState<LiveSessionV2 | null>(null);
  const [events, setEvents] = useState<SecurityEventRow[]>([]);
  const [segments, setSegments] = useState<RecordingSegment[]>([]);
  const [playbackUrl, setPlaybackUrl] = useState<string>('');
  const [activeSegmentId, setActiveSegmentId] = useState<number | null>(null);
  const [reviewBusy, setReviewBusy] = useState(false);

  const loadSessions = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api<LiveSessionV2[]>(`/api/teacher/live-sessions-v2?filter=${filter}&page=1`);
      setSessions(data);
    } catch (err) {
      setError((err as Error).message || 'Gagal memuat sesi pengawasan');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  const inspectAttempt = async (session: LiveSessionV2) => {
    setSelected(session);
    setPlaybackUrl('');
    setActiveSegmentId(null);
    try {
      const [evRes, recRes] = await Promise.all([
        api<{ events: SecurityEventRow[] }>(
          `/api/teacher/exams/${session.exam_id}/security-events?attempt_public_id=${encodeURIComponent(session.public_id)}&limit=50`,
        ).catch(() => ({ events: [] })),
        api<{ segments: RecordingSegment[] }>(
          `/api/teacher/recording/${encodeURIComponent(session.public_id)}`,
        ).catch(() => ({ segments: [] })),
      ]);
      setEvents(evRes.events ?? []);
      setSegments(recRes.segments ?? []);
    } catch {
      setEvents([]);
      setSegments([]);
    }
  };

  const playSegment = async (segmentId: number) => {
    try {
      const res = await api<{ url: string }>(`/api/teacher/recording/segment/${segmentId}/url`);
      setPlaybackUrl(res.url);
      setActiveSegmentId(segmentId);
    } catch (err) {
      setError((err as Error).message || 'Gagal membuka URL pemutaran');
    }
  };

  const reviewEvent = async (eventId: number, reviewStatus: 'REVIEWED' | 'DISMISSED' | 'ESCALATED') => {
    setReviewBusy(true);
    try {
      await api(`/api/staff/security-events/${eventId}/review`, {
        method: 'PATCH',
        body: { review_status: reviewStatus },
      });
      setEvents((prev) =>
        prev.map((ev) => (ev.id === eventId ? { ...ev, review_status: reviewStatus } : ev)),
      );
    } catch (err) {
      setError((err as Error).message || 'Gagal menyimpan tinjauan');
    } finally {
      setReviewBusy(false);
    }
  };

  const searchNeedle = search.trim().toLowerCase();
  const visibleSessions = searchNeedle
    ? sessions.filter((s) => {
        const haystack = `${s.name_snapshot} ${s.nisn} ${s.class_snapshot ?? ''} ${s.exam_name}`.toLowerCase();
        return haystack.includes(searchNeedle);
      })
    : sessions;

  return (
    <section className="staff-security-review" aria-label="Pengawasan Keamanan dan Rekaman">
      <div className="staff-security-toolbar" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem', alignItems: 'center' }}>
        {FILTER_LABELS.map((item) => (
          <button
            key={item.key}
            type="button"
            className={filter === item.key ? 'btn btn-primary' : 'btn btn-secondary'}
            onClick={() => setFilter(item.key)}
          >
            {item.label}
          </button>
        ))}
        <button type="button" className="btn btn-secondary" onClick={() => void loadSessions()} disabled={loading}>
          {loading ? 'Memuat…' : 'Segarkan'}
        </button>
        <div style={{ display: 'flex', gap: 8, marginLeft: 'auto', flexWrap: 'wrap' }}>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari nama, NISN, kelas, atau ujian"
            aria-label="Cari sesi tinjauan keamanan"
            style={{ minWidth: 260 }}
          />
          <button type="button" className="btn btn-secondary" onClick={() => setSearch((v) => v.trim())}>
            <i className="fa-solid fa-magnifying-glass" /> Cari
          </button>
        </div>
      </div>

      {error && <p className="exam-warning" role="alert">{error}</p>}

      <div className="arena-table-container">
        <table className="arena-data-table">
          <thead>
            <tr>
              <th>Peserta</th>
              <th>Ujian</th>
              <th>Perangkat</th>
              <th>Kamera / Wajah</th>
              <th>Rekaman</th>
              <th>Skor Risiko</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            {visibleSessions.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: '1.5rem' }}>
                  {loading ? 'Memuat data pengawasan…' : 'Tidak ada sesi yang cocok dengan filter/pencarian.'}
                </td>
              </tr>
            ) : (
              visibleSessions.map((s) => (
                <tr key={s.public_id}>
                  <td>
                    <strong>{s.name_snapshot}</strong>
                    <div style={{ fontSize: '0.8rem', color: '#64748b' }}>{s.nisn} · {s.class_snapshot ?? '—'}</div>
                  </td>
                  <td>{s.exam_name}</td>
                  <td>
                    <span>{s.device_category ?? 'UNKNOWN'}</span>
                    {s.browser_family && <div style={{ fontSize: '0.8rem', color: '#64748b' }}>{s.browser_family} ({s.os_family ?? '—'})</div>}
                  </td>
                  <td>{s.face_status ?? 'UNKNOWN'}</td>
                  <td>
                    {s.recording_status
                      ? `${s.recording_status} (${s.uploaded_segments ?? 0}/${s.total_segments ?? 0})`
                      : 'Tidak aktif'}
                  </td>
                  <td>
                    <strong style={{ color: s.risk_score >= 20 ? '#dc2626' : s.risk_score >= 8 ? '#d97706' : '#16a34a' }}>
                      {s.risk_score}
                    </strong>
                    <span style={{ fontSize: '0.8rem', color: '#64748b' }}> ({s.security_event_count} kejadian)</span>
                  </td>
                  <td>
                    <button type="button" className="btn-table" onClick={() => void inspectAttempt(s)}>
                      Tinjau
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {selected && (
        <div className="staff-security-detail" style={{ marginTop: '1.5rem', padding: '1rem', border: '1px solid #e2e8f0', borderRadius: '8px', background: '#fff' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h3 style={{ margin: 0 }}>
              Tinjauan Sesi: {selected.name_snapshot} ({selected.nisn})
            </h3>
            <button type="button" className="btn btn-secondary" onClick={() => setSelected(null)}>Tutup</button>
          </div>

          <h4>Segmen Rekaman ({segments.length})</h4>
          {segments.length === 0 ? (
            <p style={{ color: '#64748b' }}>Belum ada segmen rekaman untuk sesi ini.</p>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
              {segments.map((seg) => (
                <button
                  key={seg.id}
                  type="button"
                  disabled={seg.upload_status !== 'UPLOADED'}
                  className={activeSegmentId === seg.id ? 'btn btn-primary' : 'btn btn-secondary'}
                  onClick={() => void playSegment(seg.id)}
                >
                  Segmen #{seg.sequence_number + 1} ({seg.upload_status})
                </button>
              ))}
            </div>
          )}

          {playbackUrl && (
            <div style={{ marginBottom: '1rem' }}>
              <video src={playbackUrl} controls autoPlay style={{ width: '100%', maxWidth: '480px', borderRadius: '8px', background: '#000' }} />
            </div>
          )}

          <h4>Linimasa Kejadian ({events.length})</h4>
          {events.length === 0 ? (
            <p style={{ color: '#64748b' }}>Tidak ada kejadian keamanan yang tercatat.</p>
          ) : (
            <div className="arena-table-container">
              <table className="arena-data-table">
                <thead>
                  <tr>
                    <th>Waktu</th>
                    <th>Jenis Kejadian</th>
                    <th>Tingkat</th>
                    <th>Bobot</th>
                    <th>Status Tinjauan</th>
                    <th>Tindakan</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((ev) => (
                    <tr key={ev.id}>
                      <td>{new Date(ev.server_occurred_at).toLocaleString('id-ID')}</td>
                      <td>{ev.event_type}</td>
                      <td>{ev.severity}</td>
                      <td>{ev.risk_weight}</td>
                      <td>{ev.review_status}</td>
                      <td>
                        <div style={{ display: 'flex', gap: '0.25rem' }}>
                          <button type="button" className="btn-table" disabled={reviewBusy} onClick={() => void reviewEvent(ev.id, 'REVIEWED')}>Tandai Ditinjau</button>
                          <button type="button" className="btn-table" disabled={reviewBusy} onClick={() => void reviewEvent(ev.id, 'DISMISSED')}>Abaikan</button>
                          <button type="button" className="btn-table btn-table-danger" disabled={reviewBusy} onClick={() => void reviewEvent(ev.id, 'ESCALATED')}>Eskalasi</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
