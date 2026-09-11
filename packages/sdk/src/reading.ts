// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

export type FailureKind =
  | 'transport'
  /** The request exceeded its deadline. Distinct from `transport` because a timeout may succeed on retry. */
  | 'timeout'
  /** A response arrived but did not have the expected shape. Usually a version skew, not an outage. */
  | 'malformed'
  /** Nothing was configured to read from. A deliberate, calm absence — not a fault. */
  | 'unconfigured'
  /** We looked, and the thing genuinely does not exist. A 404, not a 503. */
  | 'not-found'
  /** A bound was hit before the answer was complete. See `truncated` on paged reads. */
  | 'budget-exhausted'
  /**
   * We asked, we were understood, and the answer was "not yet". Something the caller can read
   * has to change first — a paused platform, a closed vault, an unfunded wallet, a moved price, an
   * expired session. Not `transport` (retrying blindly is exactly wrong), not `not-found` (the thing
   * exists), not `malformed` (nothing about the request was wrong). `detail` names the condition.
   */
  | 'precondition'
  /**
   * We asked, we were understood, and the answer was "no". The thing exists and is readable by the
   * people entitled to it; the caller is not one of them. A paywall, a 403, a key server refusing a
   * key. Reporting this as `not-found` is how "you have not bought this" becomes "this is gone".
   */
  | 'denied';

export const FAILURE_KINDS = [
  'transport',
  'timeout',
  'malformed',
  'unconfigured',
  'not-found',
  'budget-exhausted',
  'precondition',
  'denied',
] as const satisfies readonly FailureKind[];

export type RetryAdvice = 'retry' | 'wait' | 'stop';

export function retryAdvice(kind: FailureKind): RetryAdvice {
  switch (kind) {
    case 'transport':
    case 'timeout':
      return 'retry';
    case 'precondition':
      return 'wait';
    case 'malformed':
    case 'unconfigured':
    case 'not-found':
    case 'budget-exhausted':
    case 'denied':
      return 'stop';
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

export function describeFailureKind(kind: FailureKind): string {
  switch (kind) {
    case 'transport':
      return 'the request never completed';
    case 'timeout':
      return 'the request exceeded its deadline';
    case 'malformed':
      return 'a response arrived but did not have the expected shape';
    case 'unconfigured':
      return 'nothing was configured to read from';
    case 'not-found':
      return 'we looked, and the thing does not exist';
    case 'budget-exhausted':
      return 'a bound was hit before the answer was complete';
    case 'precondition':
      return 'the answer was "not yet": something has to change first';
    case 'denied':
      return 'the answer was "no": this is not available to this caller';
    default: {
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

export interface Failure {
  kind: FailureKind;
  source: string;
  detail: string;
}

export type Reading<T> =
  | { readonly ok: true; readonly value: T; readonly observedAtMs: number }
  | { readonly ok: false; readonly failure: Failure };

export function ok<T>(value: T, observedAtMs: number = Date.now()): Reading<T> {
  return { ok: true, value, observedAtMs };
}

export function fail<T>(kind: FailureKind, source: string, detail: string): Reading<T> {
  return { ok: false, failure: { kind, source, detail } };
}

export function fold<T, R>(
  reading: Reading<T>,
  onOk: (value: T, observedAtMs: number) => R,
  onFailure: (failure: Failure) => R,
): R {
  return reading.ok ? onOk(reading.value, reading.observedAtMs) : onFailure(reading.failure);
}

export function map<T, R>(reading: Reading<T>, f: (value: T) => R): Reading<R> {
  return reading.ok ? ok(f(reading.value), reading.observedAtMs) : reading;
}

export function orThrow<T>(reading: Reading<T>): T {
  if (reading.ok) return reading.value;
  const { kind, source, detail } = reading.failure;
  throw new Error(`could not read ${source} (${kind}): ${detail}`);
}

export type ReaderHealth = 'idle' | 'never-succeeded' | 'failing' | 'degraded' | 'healthy';

export interface ReaderStats {
  attempts: number;
  successes: number;
  consecutiveFailures: number;
  lastSuccessAtMs: number | null;
}

export function readerHealth(stats: ReaderStats): ReaderHealth {
  if (stats.attempts === 0) return 'idle';
  if (stats.successes === 0) return 'never-succeeded';
  if (stats.consecutiveFailures >= 3) return 'failing';
  if (stats.consecutiveFailures > 0) return 'degraded';
  return 'healthy';
}

export function classify(error: unknown, source: string): Failure {
  const detail = error instanceof Error ? error.message : String(error);
  const lower = detail.toLowerCase();

  let kind: FailureKind = 'transport';
  if (lower.includes('deadline') || lower.includes('timeout') || lower.includes('aborted')) {
    kind = 'timeout';
  } else if (
    lower.includes('forbidden') ||
    lower.includes('permission denied') ||
    lower.includes('permission_denied') ||
    lower.includes('does not have access') ||
    lower.includes('unauthorized') ||
    lower.includes('unauthorised')
  ) {
    kind = 'denied';
  } else if (
    lower.includes('not found') ||
    lower.includes('notfound') ||
    lower.includes('not_found')
  ) {
    kind = 'not-found';
  }

  return { kind, source, detail };
}
