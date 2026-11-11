let token: string | null = null;
let csrf: string | null = null;
const examTokens=new Map<number,string>();
export function setExamToken(examId:number,value:string){examTokens.set(examId,value);}
export function getExamToken(examId:number){return examTokens.get(examId);}
function examTokenForPath(path:string){const match=path.match(/^\/api\/student\/exams\/(\d+)(?:\/|$)/);return match?examTokens.get(Number(match[1])):undefined;}
export class ApiError extends Error { constructor(message:string,readonly statusCode:number,readonly retryAfterMs?:number){super(message);this.name='ApiError';} }
export function setSession(nextToken: string | null, nextCsrf: string | null) { if(csrf!==nextCsrf)examTokens.clear();token = nextToken; csrf = nextCsrf; }
export async function api<T>(path: string, options: { method?: string; body?: unknown; keepalive?: boolean; timeoutMs?: number } = {}): Promise<T> {
  const controller = options.timeoutMs ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), options.timeoutMs) : null;
  try {
    const response = await fetch(path, {
      method: options.method ?? 'GET',
      credentials: 'same-origin',
      keepalive: options.keepalive ?? false,
      signal: controller?.signal,
      headers: {
        ...(examTokenForPath(path)?{'X-Exam-Token':examTokenForPath(path)!}:{}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(csrf && options.method && options.method !== 'GET' ? { 'X-CSRF-Token': csrf } : {}),
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const data = await response.json().catch(error => { if (controller?.signal.aborted) throw error; return null; }) as T & { error?: string } | null;
    if (response.status === 401 && path.startsWith('/api/admin/')) window.dispatchEvent(new Event('arena:staff-session-expired'));
    if (!response.ok) {
      // Retry-After (detik atau HTTP-date) dipakai login untuk backoff terarah.
      let retryAfterMs: number | undefined;
      const header = response.headers?.get?.('retry-after') ?? null;
      if (header) {
        const seconds = Number(header);
        if (Number.isFinite(seconds) && seconds >= 0) retryAfterMs = seconds * 1000;
        else {
          const at = Date.parse(header);
          if (Number.isFinite(at)) retryAfterMs = Math.max(0, at - Date.now());
        }
      }
      throw new ApiError(data?.error ?? `Request gagal (${response.status})`, response.status, retryAfterMs);
    }
    return data as T;
  } catch (error) {
    if (controller?.signal.aborted) throw new ApiError('Server belum merespons dalam batas waktu. Silakan coba lagi.', 504);
    throw error;
  } finally { if (timeout !== null) clearTimeout(timeout); }
}
/** Fire-and-forget violation report. Uses fetch keepalive first (headers + CSRF);
 * if the page is unloading or fetch is rejected, falls back to navigator.sendBeacon
 * with the CSRF token inside the JSON body (allowed only for the beacon endpoint). */
export function beacon<T extends object>(path: string, body: T): void {
  const payload = { ...body, csrf_token: csrf ?? '', ...(examTokenForPath(path)?{exam_token:examTokenForPath(path)}:{}) };
  try {
    const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
    if (typeof navigator.sendBeacon === 'function' && navigator.sendBeacon(path, blob)) return;
  } catch { /* fall through to keepalive fetch */ }
  try {
    void fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => { /* best effort only */ });
  } catch { /* nothing else we can do while unloading */ }
}
export const mutationId = () => crypto.randomUUID().replaceAll('-', '');
