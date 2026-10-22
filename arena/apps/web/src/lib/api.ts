let token: string | null = null;
let csrf: string | null = null;
export class ApiError extends Error { constructor(message:string,readonly statusCode:number){super(message);this.name='ApiError';} }
export function setSession(nextToken: string | null, nextCsrf: string | null) { token = nextToken; csrf = nextCsrf; }
export async function api<T>(path: string, options: { method?: string; body?: unknown; keepalive?: boolean } = {}): Promise<T> {
  const response = await fetch(path, {
    method: options.method ?? 'GET',
    credentials: 'same-origin',
    keepalive: options.keepalive ?? false,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(csrf && options.method && options.method !== 'GET' ? { 'X-CSRF-Token': csrf } : {}),
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const data = await response.json().catch(() => null) as T & { error?: string } | null;
  if (response.status === 401 && path.startsWith('/api/admin/')) window.dispatchEvent(new Event('arena:staff-session-expired'));
  if (!response.ok) throw new ApiError(data?.error ?? `Request gagal (${response.status})`,response.status);
  return data as T;
}
/** Fire-and-forget violation report. Uses fetch keepalive first (headers + CSRF);
 * if the page is unloading or fetch is rejected, falls back to navigator.sendBeacon
 * with the CSRF token inside the JSON body (allowed only for the beacon endpoint). */
export function beacon<T extends object>(path: string, body: T): void {
  const payload = { ...body, csrf_token: csrf ?? '' };
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
