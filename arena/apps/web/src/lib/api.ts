let token: string | null = null;
let csrf: string | null = null;
export class ApiError extends Error { constructor(message:string,readonly statusCode:number){super(message);this.name='ApiError';} }
export function setSession(nextToken: string | null, nextCsrf: string | null) { token = nextToken; csrf = nextCsrf; }
export async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(path, {
    method: options.method ?? 'GET',
    credentials: 'same-origin',
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
export const mutationId = () => crypto.randomUUID().replaceAll('-', '');
