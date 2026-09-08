// The real HTTP backend path. Only used when API_MODE === 'http'. Requests hit
// the endpoints named in the contract; responses are validated against the same
// types the mock path produces. A failed read is an ApiError, never a value.

import { API_BASE } from './config';
import { ok, fail, type ApiErrorCode, type ApiResult } from './errors';

async function request<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<ApiResult<T>> {
  let url = `${API_BASE}${path}`;
  const init: RequestInit = { method, headers: { Accept: 'application/json' } };
  if (body !== undefined) {
    init.headers = { ...init.headers, 'Content-Type': 'application/json' };
    init.body = JSON.stringify(body);
  }

  try {
    const res = await fetch(url, init);
    let text = '';
    try {
      text = await res.text();
    } catch {
      // body unreadable
    }
    if (!res.ok) {
      return fail<T>(codeFromStatus(res.status), text || `Request failed with ${res.status}.`);
    }
    if (!text) return ok<T>(undefined as unknown as T);
    const data = JSON.parse(text) as T;
    return ok(data);
  } catch (e) {
    const isAbort = e instanceof DOMException && e.name === 'AbortError';
    return fail<T>(
      isAbort ? 'timeout' : 'network',
      isAbort ? 'The request timed out.' : 'The request could not reach the server.',
      'Check your connection and try again.',
    );
  }
}

function codeFromStatus(status: number): ApiErrorCode {
  if (status === 404) return 'not-found';
  if (status === 401) return 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 400 || status === 422) return 'invalid-request';
  return 'server';
}

export const httpGet = <T>(path: string): Promise<ApiResult<T>> => request<T>('GET', path);
export const httpPost = <T>(path: string, body?: unknown): Promise<ApiResult<T>> =>
  request<T>('POST', path, body);

/**
 * A read whose response has to be reshaped before this app can use it.
 *
 * The back end answers listings in an envelope — `{ kind, items, nextCursor }` — because a listing
 * that can be continued has to say so. The screens here want the list. `pick` is where that
 * translation lives, once per endpoint, instead of inside the components.
 *
 * A `pick` that cannot find what it needs returns `null`, and that becomes a named failure rather
 * than an empty array: "the server answered in a shape we do not understand" and "there is nothing
 * here" are different facts, and a screen that shows the empty state for the first one is lying.
 */
export async function httpGetShaped<T>(
  path: string,
  pick: (body: unknown) => T | null,
): Promise<ApiResult<T>> {
  const raw = await httpGet<unknown>(path);
  if (!raw.ok) return raw;
  const shaped = pick(raw.data);
  if (shaped === null) {
    return fail<T>('server', 'The server answered in a shape this page does not understand.', path);
  }
  return ok(shaped);
}

/** `{ items: [...] }`, the back end's listing envelope. */
export const items =
  <T>() =>
  (body: unknown): T[] | null => {
    if (typeof body !== 'object' || body === null) return null;
    const list = (body as { items?: unknown }).items;
    return Array.isArray(list) ? (list as T[]) : null;
  };

/** One named array off an object, for endpoints that name their list something other than `items`. */
export const listAt =
  <T>(key: string) =>
  (body: unknown): T[] | null => {
    if (typeof body !== 'object' || body === null) return null;
    const list = (body as Record<string, unknown>)[key];
    return Array.isArray(list) ? (list as T[]) : null;
  };