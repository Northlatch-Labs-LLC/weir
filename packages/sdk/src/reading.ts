// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
/**
 * `Reading<T>` — the result of looking at something that might not have answered.
 *
 * # Why this type exists
 *
 * A reader that failed and a reader that measured nothing must not produce the same output. When
 * they do, an outage is indistinguishable from an observation, and people believe the observation.
 * A dashboard showing a creator "0 USDC earned" because the node timed out looks exactly like a
 * creator who has earned nothing, and only one of those is worth acting on.
 *
 * So every chain read in this SDK returns a `Reading<T>`. There is deliberately **no**
 * `unwrapOr(fallback)` and no `.valueOr(0)`. A default value is the precise mechanism that turns a
 * failure into a plausible zero, and providing one would mean every call site can opt out of the
 * distinction this module exists to preserve.
 *
 * To get at a value you must supply both branches — see {@link fold}.
 */

/** Why a read did not produce a value. */
export type FailureKind =
  /** The request never completed: connection refused, DNS, TLS, socket reset. */
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
  | 'budget-exhausted';

export interface Failure {
  kind: FailureKind;
  /** What was being read, for a message a human can act on. */
  source: string;
  /** The underlying error text, unmodified. Never a guess at what it meant. */
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

/**
 * Consume a reading. Both branches are required — that is the entire point.
 *
 * There is no single-branch variant. A caller who genuinely does not care about failure should
 * say so explicitly in `onFailure`, where the next reader can see the decision.
 */
export function fold<T, R>(
  reading: Reading<T>,
  onOk: (value: T, observedAtMs: number) => R,
  onFailure: (failure: Failure) => R,
): R {
  return reading.ok ? onOk(reading.value, reading.observedAtMs) : onFailure(reading.failure);
}

/** Map a successful reading, preserving the failure and the observation time. */
export function map<T, R>(reading: Reading<T>, f: (value: T) => R): Reading<R> {
  return reading.ok ? ok(f(reading.value), reading.observedAtMs) : reading;
}

/**
 * Turn a failure into a thrown error.
 *
 * Provided for call sites where continuing is genuinely impossible — building a transaction that
 * needs a real object id, for instance. Deliberately named to sound like a decision rather than a
 * convenience, because it is one: it discards the distinction the type exists to carry.
 */
export function orThrow<T>(reading: Reading<T>): T {
  if (reading.ok) return reading.value;
  const { kind, source, detail } = reading.failure;
  throw new Error(`could not read ${source} (${kind}): ${detail}`);
}

/**
 * Health of a reader over time.
 *
 * `never-succeeded` is its own state and the loudest one. A reader called ten thousand times that
 * has never once returned data is not "healthy with no results" — it is broken, and only a
 * distinct status can say so.
 */
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

/**
 * Classify a thrown error into a `FailureKind`.
 *
 * Conservative on purpose. Anything not confidently recognised is `transport` with the original
 * text preserved, because a wrong explanation is worse than an opaque one — an opaque one can be
 * searched for.
 */
export function classify(error: unknown, source: string): Failure {
  const detail = error instanceof Error ? error.message : String(error);
  const lower = detail.toLowerCase();

  let kind: FailureKind = 'transport';
  if (lower.includes('deadline') || lower.includes('timeout') || lower.includes('aborted')) {
    kind = 'timeout';
  } else if (
    lower.includes('not found') ||
    lower.includes('notfound') ||
    // gRPC's canonical status name, and the form a Sui node actually returns. Missing it meant
    // every "no such object" was classified as `transport` — so the readers that fold a not-found
    // into a measured absence ("this address has no key", "this handle is free") reported a
    // connection problem instead, and a caller that trusted the classification would tell the user
    // the network was down when the answer was simply "there is none".
    lower.includes('not_found')
  ) {
    kind = 'not-found';
  }

  return { kind, source, detail };
}
