import type { Redis } from 'ioredis';

type RateLimitCallback = (error: Error | null, result?: { current: number; ttl: number }) => void;

interface RateLimitItem {
  current: number;
  ttl: number;
  iterationStartMs: number;
}

export class ArenaRateLimitStore {
  private lru = new Map<string, RateLimitItem>();
  private redis: Redis | null = null;
  private keyPrefix = 'fastify-rate-limit-';
  private continueExceeding = false;
  private exponentialBackoff = false;

  constructor(options?: any) {
    if (options && typeof options === 'object') {
      this.continueExceeding = Boolean(options.continueExceeding);
      this.exponentialBackoff = Boolean(options.exponentialBackoff);
      if (options.redis && typeof options.redis === 'object' && 'status' in options.redis) {
        this.redis = options.redis as Redis;
      }
      if (options.nameSpace) this.keyPrefix = options.nameSpace;
      if (options.keyPrefix) this.keyPrefix = options.keyPrefix;
      if (options.isStudentLogin) {
        activeStudentLoginStore = this;
      }
    }
  }

  incr(key: string, cb: RateLimitCallback, timeWindow: number, max: number): void {
    if (this.redis) {
      // Redis store implementation via fastify-rate-limit custom lua commands
      const fullKey = this.keyPrefix + key;
      (this.redis as any).rateLimit(fullKey, timeWindow, max, this.continueExceeding, this.exponentialBackoff, (err: Error | null, result: [number, number]) => {
        if (err) cb(err);
        else cb(null, { current: result[0], ttl: result[1] });
      });
      return;
    }

    const now = Date.now();
    let current = this.lru.get(key);

    if (!current || current.iterationStartMs + timeWindow <= now) {
      current = { current: 1, ttl: timeWindow, iterationStartMs: now };
    } else {
      current.current++;
      if (this.continueExceeding && current.current > max) {
        current.ttl = timeWindow;
        current.iterationStartMs = now;
      } else {
        current.ttl = timeWindow - (now - current.iterationStartMs);
      }
    }
    this.lru.set(key, current);
    cb(null, { current: current.current, ttl: current.ttl });
  }

  read(key: string, cb: RateLimitCallback, timeWindow: number, max?: number): void {
    if (this.redis) {
      const fullKey = this.keyPrefix + key;
      (this.redis as any).rateLimitRead(fullKey, (err: Error | null, result: [number, number]) => {
        if (err) cb(err);
        else cb(null, { current: result[0], ttl: result[1] });
      });
      return;
    }

    const now = Date.now();
    const current = this.lru.get(key);
    if (!current || current.iterationStartMs + timeWindow <= now) {
      cb(null, { current: 0, ttl: 0 });
      return;
    }
    const ttl = timeWindow - (now - current.iterationStartMs);
    cb(null, { current: current.current, ttl });
  }

  decr(key: string): void {
    if (this.redis) {
      const fullKey = this.keyPrefix + key;
      this.redis.decr(fullKey).catch(() => {});
      return;
    }
    const current = this.lru.get(key);
    if (current && current.current > 0) {
      current.current--;
      if (current.current === 0) {
        this.lru.delete(key);
      }
    }
  }

  child(routeOptions: any): ArenaRateLimitStore {
    const isLogin = Boolean(routeOptions?.routeInfo?.url?.includes('/api/auth/student/login') || routeOptions?.routeInfo?.url?.includes('/login'));
    const childPrefix = this.redis ? `${this.keyPrefix}${routeOptions?.routeInfo?.method ?? ''}${routeOptions?.routeInfo?.url ?? ''}-` : this.keyPrefix;
    const childStore = new ArenaRateLimitStore({
      continueExceeding: routeOptions?.continueExceeding ?? this.continueExceeding,
      exponentialBackoff: routeOptions?.exponentialBackoff ?? this.exponentialBackoff,
      redis: this.redis,
      keyPrefix: childPrefix,
      isStudentLogin: isLogin,
    });
    if (isLogin) {
      activeStudentLoginStore = childStore;
    }
    return childStore;
  }
}

let activeStudentLoginStore: ArenaRateLimitStore | null = null;

export function refundStudentLoginRateLimit(key: string): void {
  if (activeStudentLoginStore) {
    activeStudentLoginStore.decr(key);
  }
}
