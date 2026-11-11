import type { RowDataPacket } from 'mysql2/promise';
import { redis as defaultRedis } from '../lib/redis.js';

export type SourceQuestion = RowDataPacket;

/**
 * Sumber soal ujian dengan alamat cache berbasis revision authoritative.
 *
 * MySQL adalah satu-satunya sumber kebenaran invalidasi: `exams.source_revision`
 * dinaikkan oleh trigger dalam transaksi yang sama dengan mutasi soal
 * (migrasi 015). Pembaca selalu membaca revision terkini langsung dari MySQL
 * (gratis lewat `SELECT e.*` pada jalur claim), lalu mengambil payload pada
 * key `arena:exam:source:v2:{revision}:{examId}`. Konsekuensinya:
 * - Redis restart / unavailable / pulih tidak pernah menyajikan soal stale —
 *   key lama menempel pada revision lama yang tidak pernah diminta lagi.
 * - TTL Redis hanya pembersih memori, bukan jaminan kebenaran.
 * - Payload menyertakan revision dan diverifikasi saat dibaca (anti korupsi).
 * correct_answer tetap server-only: payload ini tidak pernah diproyeksikan
 * ke response client (lihat StudentExamService.startOnce).
 *
 * Kalau revision tidak tersedia (mis. aplikasi ter-deploy sebelum migrasi 015),
 * loader otomatis mem-bypass cache dan selalu membaca MySQL — aman, hanya
 * lebih lambat. Ini membuat urutan deploy bebas dari jendela cache stale.
 */

const localTtlMs = Math.max(0, Math.min(30_000, Number(process.env.EXAM_QUESTION_SOURCE_TTL_MS ?? 2_000) || 0));
const maxEntries = Math.max(1, Math.min(100, Number(process.env.EXAM_QUESTION_SOURCE_CACHE_MAX ?? 16) || 16));
// TTL panjang aman karena kebenaran ditanggung revision di MySQL, bukan TTL.
// Clamp 1 jam default, maksimum 24 jam.
const defaultRedisTtlMs = Math.max(1_000, Math.min(24 * 60 * 60 * 1_000, Number(process.env.EXAM_QUESTION_REDIS_TTL_MS ?? 3_600_000) || 3_600_000));

export type RedisLike = {
  status: string;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'PX', ttl: number): Promise<unknown>;
};

type CacheEntry = { revision: number; expiresAt: number; rows: SourceQuestion[] };
type StoredPayload = { revision?: unknown; rows?: unknown };

export type ExamQuestionSourceDeps = {
  redis?: RedisLike | null;
  now?: () => number;
  localTtlMs?: number;
  redisTtlMs?: number;
};

export type ExamQuestionSource = {
  /** revision wajib berasal dari exams.source_revision; undefined => bypass cache. */
  load(examId: number, fetchRows: () => Promise<SourceQuestion[]>, revision?: number): Promise<SourceQuestion[]>;
};

export function payloadKey(revision: number, examId: number): string {
  return `arena:exam:source:v2:${revision}:${examId}`;
}

export function parseStoredPayload(value: string, expectedRevision: number): SourceQuestion[] | null {
  let parsed: StoredPayload;
  try { parsed = JSON.parse(value) as StoredPayload; } catch { return null; }
  if (parsed?.revision !== expectedRevision) return null;
  if (!Array.isArray(parsed.rows) || !parsed.rows.length) return null;
  return parsed.rows as SourceQuestion[];
}

function ttlWithJitter(base: number): number {
  // Jitter ±10% agar payload yang diisi bersamaan tidak expired serempak.
  return Math.round(base * (1 + Math.random() * 0.1));
}

export function createExamQuestionSource(deps: ExamQuestionSourceDeps = {}): ExamQuestionSource {
  const redis = deps.redis ?? null;
  const now = deps.now ?? Date.now;
  const localTtl = deps.localTtlMs ?? localTtlMs;
  const redisTtl = deps.redisTtlMs ?? defaultRedisTtlMs;
  const cache = new Map<number, CacheEntry>();
  // Single-flight per (examId, revision): request bersamaan berbagi satu fetch.
  const loading = new Map<string, Promise<SourceQuestion[]>>();

  function remember(examId: number, revision: number, rows: SourceQuestion[]) {
    if (localTtl <= 0 || !rows.length) return;
    // Jangan menurunkan revision: read in-flight revision lama yang selesai
    // belakangan tidak boleh menimpa entry revision yang lebih baru — revision
    // hanya bertambah, jadi entry revision terbaru selalu yang paling bernilai.
    const existing = cache.get(examId);
    if (existing && existing.revision > revision) return;
    cache.delete(examId);
    cache.set(examId, { revision, expiresAt: now() + localTtl, rows });
    while (cache.size > maxEntries) cache.delete(cache.keys().next().value!);
  }

  async function readThrough(examId: number, flightKey: string, fetchRows: () => Promise<SourceQuestion[]>, revision: number): Promise<SourceQuestion[]> {
    let task!: Promise<SourceQuestion[]>;
    task = (async () => {
      if (redis && redis.status === 'ready') {
        try {
          const value = await redis.get(payloadKey(revision, examId));
          if (value) {
            const rows = parseStoredPayload(value, revision);
            if (rows) {
              if (loading.get(flightKey) === task) remember(examId, revision, rows);
              return rows;
            }
          }
        } catch { /* MySQL tetap authoritative saat Redis bermasalah */ }
      }
      const rows = await fetchRows();
      if (redis && redis.status === 'ready') {
        try { await redis.set(payloadKey(revision, examId), JSON.stringify({ revision, rows }), 'PX', ttlWithJitter(redisTtl)); } catch { /* DB result tetap dipakai */ }
      }
      if (loading.get(flightKey) === task) remember(examId, revision, rows);
      return rows;
    })();
    loading.set(flightKey, task);
    try { return await task; }
    finally { if (loading.get(flightKey) === task) loading.delete(flightKey); }
  }

  return {
    async load(examId, fetchRows, revision) {
      // Tanpa revision authoritative: bypass total (tanpa cache lokal/Redis)
      // supaya tidak pernah menyajikan data yang tidak bisa divalidasi.
      if (!Number.isSafeInteger(revision) || (revision as number) < 0) {
        const flightKey = `${examId}:unrevisioned`;
        const pending = loading.get(flightKey);
        if (pending) return pending;
        const task = fetchRows();
        loading.set(flightKey, task);
        try { return await task; }
        finally { if (loading.get(flightKey) === task) loading.delete(flightKey); }
      }
      const cached = cache.get(examId);
      if (cached && cached.revision === revision && cached.expiresAt > now()) return cached.rows;
      const flightKey = `${examId}:${revision}`;
      const pending = loading.get(flightKey);
      if (pending) return pending;
      return readThrough(examId, flightKey, fetchRows, revision as number);
    },
  };
}

/** Instance proses: memakai koneksi Redis singleton aplikasi. */
export const examQuestionSource = createExamQuestionSource({ redis: defaultRedis ? (defaultRedis as unknown as RedisLike) : null });

export function loadExamQuestionSource(examId: number, fetchRows: () => Promise<SourceQuestion[]>, revision?: number): Promise<SourceQuestion[]> {
  return examQuestionSource.load(examId, fetchRows, revision);
}
