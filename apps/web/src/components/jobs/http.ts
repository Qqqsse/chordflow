/** Same-origin JSON helpers for the job pages (cookies + Origin header satisfy CSRF checks). */

export interface ApiResult<T> {
  status: number;
  data: T | null;
  error: { code: string; message: string } | null;
}

async function call<T>(method: 'GET' | 'POST', url: string, body?: unknown): Promise<ApiResult<T>> {
  const response = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  const json = (await response.json().catch(() => null)) as {
    data?: T;
    error?: { code: string; message: string };
  } | null;
  return { status: response.status, data: json?.data ?? null, error: json?.error ?? null };
}

export const getJson = <T>(url: string) => call<T>('GET', url);
export const postJson = <T>(url: string, body: unknown) => call<T>('POST', url, body);
