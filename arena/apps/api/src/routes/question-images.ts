import { createReadStream } from 'node:fs';
import { mkdir, stat, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireRole } from '../lib/access.js';
import { requirePool } from '../lib/db.js';
import { audit } from '../services/audit.js';

const uploadDir = path.resolve(process.env.ARENA_UPLOAD_DIR ?? path.join(process.cwd(), 'storage', 'question-images'));
const types = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' } as const;
function imageType(bytes: Buffer): keyof typeof types | null {
  if (bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'png';
  if (bytes.subarray(0, 3).equals(Buffer.from([255,216,255]))) return 'jpg';
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  if (['GIF87a','GIF89a'].includes(bytes.subarray(0, 6).toString('ascii'))) return 'gif';
  return null;
}

export async function questionImageRoutes(app: FastifyInstance) {
  app.post('/api/admin/question-images', { bodyLimit: 3 * 1024 * 1024 }, async (request, reply) => {
    const actor = requireRole(request, ['ADMIN'], true);
    const body = z.object({ base64: z.string().min(1).max(2_800_000) }).strict().parse(request.body);
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(body.base64)) throw Object.assign(new Error('Data gambar tidak valid'), { statusCode: 422 });
    const bytes = Buffer.from(body.base64, 'base64');
    if (!bytes.length || bytes.length > 2 * 1024 * 1024) throw Object.assign(new Error('Gambar maksimal 2 MB'), { statusCode: 422 });
    const type = imageType(bytes);
    if (!type) throw Object.assign(new Error('Gunakan gambar PNG, JPEG, WebP, atau GIF'), { statusCode: 422 });
    const filename = `${randomBytes(32).toString('hex')}.${type}`;
    await mkdir(uploadDir, { recursive: true });
    await writeFile(path.join(uploadDir, filename), bytes, { flag: 'wx' });
    await audit(requirePool(), actor.sub, actor.role, 'QUESTION_IMAGE_UPLOADED', 'QuestionImage', filename);
    reply.header('Cache-Control', 'no-store');
    return { url: `/api/question-images/${filename}` };
  });

  app.get<{Params:{filename:string}}>('/api/question-images/:filename', async (request, reply) => {
    const filename = z.string().regex(/^[0-9a-f]{64}\.(png|jpg|webp|gif)$/).parse(request.params.filename);
    const type = filename.split('.').at(-1) as keyof typeof types;
    const filenamePath = path.join(uploadDir, filename);
    try { await stat(filenamePath); } catch { return reply.notFound('Gambar tidak ditemukan'); }
    reply.type(types[type]);
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Cache-Control', 'public, max-age=31536000, immutable');
    return reply.send(createReadStream(filenamePath));
  });
}
