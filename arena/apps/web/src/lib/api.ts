let token: string | null = null;
let csrf: string | null = null;
export function setSession(nextToken: string | null, nextCsrf: string | null) { token = nextToken; csrf = nextCsrf; }
export async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  const response = await fetch(path, {
    method: options.method ?? 'GET',
    credentials: 'omit',
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(csrf && options.method && options.method !== 'GET' ? { 'X-CSRF-Token': csrf } : {}),
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const data = await response.json().catch(() => null) as T & { error?: string } | null;
  if (!response.ok) throw new Error(data?.error ?? `Request gagal (${response.status})`);
  return data as T;
}
export const mutationId = () => crypto.randomUUID().replaceAll('-', '');
