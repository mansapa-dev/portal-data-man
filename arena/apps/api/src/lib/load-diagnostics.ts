import type { FastifyBaseLogger } from 'fastify';

export type LoadDiagnosticValue = number | string | boolean;

/**
 * Tahap 3 — diagnostik bentuk beban.
 *
 * Agregator ringan tanpa Prometheus: sampel per event dikumpulkan lalu
 * dilog sebagai satu jendela (default 60 dtk) berisi hitungan outcome dan
 * p50/p95/p99/max untuk setiap field numerik. Nonaktif secara default
 * (`ARENA_LOAD_DIAGNOSTICS=true` untuk mengaktifkan) supaya jalur produksi
 * tidak berubah sampai operator memintanya.
 */
export class LoadDiagnostics {
  private logger?: Pick<FastifyBaseLogger, 'warn'>;
  private enabled = false;
  private readonly samples = new Map<string, Record<string, LoadDiagnosticValue>[]>();
  private timer?: NodeJS.Timeout;
  constructor(private readonly windowMs = 60_000, private readonly maxSamples = 2048) {}

  start(logger: Pick<FastifyBaseLogger, 'warn'>, enabled = process.env.ARENA_LOAD_DIAGNOSTICS === 'true') {
    this.logger = logger;
    this.enabled = enabled;
    return this;
  }

  record(event: string, values: Record<string, LoadDiagnosticValue>) {
    if (!this.enabled || !this.logger) return;
    const samples = this.samples.get(event) ?? [];
    samples.push(values);
    this.samples.set(event, samples);
    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.windowMs);
      this.timer.unref();
    }
    if (samples.length >= this.maxSamples) this.flush();
  }

  flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    for (const [event, samples] of this.samples) {
      if (!samples.length) continue;
      const numericKeys = [...new Set(samples.flatMap((sample) => Object.entries(sample).filter(([, value]) => typeof value === 'number').map(([key]) => key)))];
      const percentile = (key: string, p: number) => {
        const values = samples.map((sample) => sample[key]).filter((value): value is number => typeof value === 'number').sort((a, b) => a - b);
        return values.length ? Number(values[Math.min(values.length - 1, Math.ceil(values.length * p) - 1)]!.toFixed(2)) : null;
      };
      const outcomes: Record<string, number> = {};
      for (const sample of samples) {
        const outcome = String(sample.outcome ?? 'ok');
        outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
      }
      this.logger?.warn({ event, samples: samples.length, outcomes, timings_ms: Object.fromEntries(numericKeys.map((key) => [key, { p50: percentile(key, 0.5), p95: percentile(key, 0.95), p99: percentile(key, 0.99), max: percentile(key, 1) }])) }, 'load-shape diagnostic window');
      this.samples.set(event, []);
    }
  }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.flush();
    this.enabled = false;
  }
}

export const loadDiagnostics = new LoadDiagnostics();
