import mysql from 'mysql2/promise';

const databaseUrl = process.env.DATABASE_URL;
export const pool = databaseUrl
  ? mysql.createPool({ uri: databaseUrl, connectionLimit: Number(process.env.DB_POOL_SIZE ?? 20), waitForConnections: true, queueLimit: Number(process.env.DB_QUEUE_LIMIT ?? 500), enableKeepAlive: true, timezone: 'Z', namedPlaceholders: true })
  : null;

export function requirePool() {
  if (!pool) throw Object.assign(new Error('Database is not configured'), { statusCode: 503 });
  return pool;
}
