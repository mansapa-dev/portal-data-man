import type { FastifyServerOptions } from 'fastify';

/**
 * Opsi server Fastify yang dipakai bersama.
 *
 * `ignoreTrailingSlash` wajib: reverse proxy (nginx) yang memakai location
 * prefix berakhiran `/` akan mengarahkan `/api/student/exams` ke
 * `/api/student/exams/` dengan 301. Tanpa opsi ini Fastify menjawab 404
 * (`Route GET:/api/student/exams/ not found`) sehingga daftar ujian siswa
 * gagal dimuat. Dengan opsi ini path berganda slash tetap dilayani route yang
 * sama.
 */
export function buildAppOptions(input: { logLevel: string; trustProxy: boolean; requestTimeoutMs: number }): FastifyServerOptions {
  return {
    logger: { level: input.logLevel, redact: ['req.headers.authorization', 'req.headers.cookie', 'req.body.pin', 'req.body.password'] },
    trustProxy: input.trustProxy,
    bodyLimit: 64 * 1024,
    requestTimeout: input.requestTimeoutMs,
    keepAliveTimeout: 5_000,
    maxRequestsPerSocket: 1_000,
    routerOptions: { ignoreTrailingSlash: true },
  };
}
