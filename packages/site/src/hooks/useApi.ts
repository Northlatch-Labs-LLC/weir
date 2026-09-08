import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiError, ApiResult } from '@/lib/api/errors';

export type LoadStatus = 'loading' | 'error' | 'success';

// A small loader that wraps an async client call. A failed read surfaces as an
// ApiError (status 'error'); there is no fallback value and no silent empty.
export function useApi<T>(fn: () => Promise<ApiResult<T>>, deps: unknown[] = []) {
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  const fnRef = useRef(fn);
  fnRef.current = fn;

  const load = useCallback(async () => {
    setStatus('loading');
    setError(null);
    const res = await fnRef.current();
    if (res.ok) {
      setData(res.data);
      setStatus('success');
    } else {
      setData(null);
      setError(res.error);
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { status, data, error, reload: load };
}