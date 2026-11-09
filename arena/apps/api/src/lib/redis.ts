import { Redis } from 'ioredis';

// One connection per API process, shared with rate limiting and exam source cache.
export const redis = process.env.REDIS_URL
  ? new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1, enableOfflineQueue: false, commandTimeout: Number(process.env.REDIS_COMMAND_TIMEOUT_MS ?? 1_000) })
  : null;
