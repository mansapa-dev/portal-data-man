import mysql from 'mysql2/promise';

const databaseUrl = process.env.DATABASE_URL;
const common = {
  waitForConnections: true,
  connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT_MS ?? 10_000),
  enableKeepAlive: true,
  timezone: 'Z',
  namedPlaceholders: true,
} as const;

export const pool = databaseUrl
  // A missing env var must retain admission control. A 10,000-request default
  // turns a transient MySQL stall into an in-memory queue and retry cascade.
  ? mysql.createPool({ uri: databaseUrl, ...common, connectionLimit: Number(process.env.DB_POOL_SIZE ?? 12), queueLimit: Number(process.env.DB_QUEUE_LIMIT ?? 240) })
  : null;

// Bulkhead login: query autentikasi memakai pool kecil sendiri supaya lonjakan
// 1.200 login tidak menghabiskan koneksi yang dipakai autosave/submit ujian.
// Pool utama tetap untuk seluruh trafik ujian dan operasional.
//
// Dibuat lazy: proses finalization/waiting yang mengimpor modul ini tidak
// membuka koneksi auth yang tidak pernah dipakai.
const authPoolSize = Number(process.env.AUTH_DB_POOL_SIZE ?? 4);
const authQueueLimit = Number(process.env.AUTH_DB_QUEUE_LIMIT ?? 240);
let authPoolInstance: mysql.Pool | null = null;

export function getAuthPool() {
  if (!databaseUrl) return null;
  if (!authPoolInstance) {
    authPoolInstance = mysql.createPool({
      uri: databaseUrl,
      ...common,
      connectionLimit: Number.isSafeInteger(authPoolSize) && authPoolSize > 0 ? Math.min(authPoolSize, 32) : 4,
      queueLimit: Number.isSafeInteger(authQueueLimit) && authQueueLimit > 0 ? authQueueLimit : 240,
    });
  }
  return authPoolInstance;
}

export function requirePool() {
  if (!pool) throw Object.assign(new Error('Database is not configured'), { statusCode: 503 });
  return pool;
}

export function requireAuthPool() {
  const authPool = getAuthPool();
  if (!authPool) throw Object.assign(new Error('Database is not configured'), { statusCode: 503 });
  return authPool;
}

export async function closeAuthPool() {
  const authPool = authPoolInstance;
  authPoolInstance = null;
  await authPool?.end();
}
