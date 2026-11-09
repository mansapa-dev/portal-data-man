import type { RowDataPacket } from 'mysql2/promise';
import { redis } from '../lib/redis.js';

export type SourceQuestion = RowDataPacket;

// A short, bounded cache coalesces the burst when a class starts the same exam.
// Keys stay on the server; callers must project a public response explicitly.
const ttlMs = Math.max(0, Math.min(30_000, Number(process.env.EXAM_QUESTION_SOURCE_TTL_MS ?? 2_000) || 0));
const maxEntries = Math.max(1, Math.min(100, Number(process.env.EXAM_QUESTION_SOURCE_CACHE_MAX ?? 16) || 16));
const redisTtlMs = Math.max(1_000, Math.min(60_000, Number(process.env.EXAM_QUESTION_REDIS_TTL_MS ?? 2_000) || 2_000));
const cache = new Map<number, { expiresAt: number; rows: SourceQuestion[] }>();
const loading = new Map<number, Promise<SourceQuestion[]>>();
function remember(examId: number, rows: SourceQuestion[]) {
  if (ttlMs <= 0 || !rows.length) return;
  cache.delete(examId);
  cache.set(examId, { expiresAt: Date.now() + ttlMs, rows });
  while (cache.size > maxEntries) cache.delete(cache.keys().next().value!);
}

export async function loadExamQuestionSource(examId: number, fetchRows: () => Promise<SourceQuestion[]>): Promise<SourceQuestion[]> {
  const cached = cache.get(examId);
  if (cached && cached.expiresAt > Date.now()) return cached.rows;
  const pending = loading.get(examId);
  if (pending) return pending;
  let task!: Promise<SourceQuestion[]>;
  task = (async () => {
    let redisKey: string | null = null;
    if (redis?.status === 'ready') {
      try {
        const revision = await redis.get('arena:exam:source:revision') ?? '0';
        redisKey = `arena:exam:source:${revision}:${examId}`;
        const value = await redis.get(redisKey);
        if (value) {
          const parsed = JSON.parse(value) as unknown;
          if (Array.isArray(parsed) && parsed.length) {
            const rows = parsed as SourceQuestion[];
            if (loading.get(examId) === task) remember(examId, rows);
            return rows;
          }
        }
      } catch { redisKey = null; /* DB remains authoritative when Redis is unavailable */ }
    }
    const rows = await fetchRows();
    if (redisKey && rows.length && redis?.status === 'ready') {
      try { await redis.set(redisKey, JSON.stringify(rows), 'PX', redisTtlMs); } catch { /* DB result is still usable */ }
    }
    if (loading.get(examId) === task) remember(examId, rows);
    return rows;
  })();
  loading.set(examId, task);
  try { return await task; }
  finally { if (loading.get(examId) === task) loading.delete(examId); }
}

export function invalidateExamQuestionSource(examId: number) {
  cache.delete(examId);
  loading.delete(examId);
}

export function invalidateAllExamQuestionSources() {
  cache.clear();
  loading.clear();
}
