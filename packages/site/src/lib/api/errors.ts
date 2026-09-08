// A failed read is never a value. Every client function returns data or a
// named failure. There is no fallback to zero, no empty array standing in for
// an error, and no default. When a figure cannot be read the UI prints
// "not measured" with the reason.

export type ApiErrorCode =
  | 'not-found'
  | 'unauthorized'
  | 'forbidden'
  | 'invalid-request'
  | 'network'
  | 'server'
  | 'timeout';

export interface ApiError {
  code: ApiErrorCode;
  // What failed.
  message: string;
  // What to do / the state of the money. Optional.
  detail?: string;
}

export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: ApiError };

export const ok = <T>(data: T): ApiResult<T> => ({ ok: true, data });

export const fail = <T>(
  code: ApiErrorCode,
  message: string,
  detail?: string,
): ApiResult<T> => ({ ok: false, error: { code, message, detail } });