import { opaqueDetail } from './opaque';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { db, normaliseAddress } from './db';

export interface Budget {
  limit: number;
  windowMs: number;
}

export const BUDGETS = {
  simulate: { limit: 20, windowMs: 60_000 },
  write: { limit: 40, windowMs: 60_000 },
  read: { limit: 200, windowMs: 60_000 },
} as const satisfies Record<string, Budget>;

export type BudgetName = keyof typeof BUDGETS;

export function clientKey(request: Request): string {
  if ((process.env['PROJECTX_SOCIAL_BEHIND_CLOUDFLARE'] ?? '') === 'true') {
    const expected = (process.env['PROJECTX_SOCIAL_EDGE_SECRET'] ?? '').trim();
    if (expected !== '' && (request.headers.get('x-edge-secret') ?? '').trim() !== expected) {
      return 'unattributed';
    }

    const visitor = request.headers.get('cf-connecting-ip');
    if (visitor !== null && visitor.trim() !== '') return visitor.trim();
    return 'unattributed';
  }

  const real = request.headers.get('x-real-ip');
  if (real !== null && real.trim() !== '') return real.trim();

  return 'unattributed';
}

const hits = new Map<string, number[]>();

const MAX_KEYS = 10_000;

function prune(): void {
  if (hits.size < MAX_KEYS) return;
  const entries = [...hits.entries()];
  entries.sort((a, b) => (a[1][a[1].length - 1] ?? 0) - (b[1][b[1].length - 1] ?? 0));
  for (const [key] of entries.slice(0, Math.floor(MAX_KEYS / 3))) hits.delete(key);
}

export function consume(
  key: string,
  budget: Budget,
  now: number = Date.now(),
): { allowed: boolean; remaining: number; retryAfterSeconds: number } {
  prune();

  const since = now - budget.windowMs;
  const recent = (hits.get(key) ?? []).filter((at) => at > since);

  if (recent.length >= budget.limit) {
    hits.set(key, recent);
    const oldest = recent[0] ?? now;
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((oldest + budget.windowMs - now) / 1000)),
    };
  }

  recent.push(now);
  hits.set(key, recent);
  return { allowed: true, remaining: budget.limit - recent.length, retryAfterSeconds: 0 };
}

export function rateLimit(request: Request, name: BudgetName): Response | null {
  const budget = BUDGETS[name];
  const outcome = consume(`${name}:${clientKey(request)}`, budget);
  if (outcome.allowed) return null;

  return Response.json(
    {
      error:
        'too many requests from this address. This limit exists to keep a shared node available to ' +
        'everybody, and it resets on its own.',
      retryAfterSeconds: outcome.retryAfterSeconds,
    },
    {
      status: 429,
      headers: {
        'retry-after': String(outcome.retryAfterSeconds),
        'x-ratelimit-limit': String(budget.limit),
        'x-ratelimit-remaining': '0',
      },
    },
  );
}

export async function sharedLimit(request: Request, name: QuotaName): Promise<Response | null> {
  const outcome = await spendShared(clientKey(request), name);
  if (outcome.allowed) return null;

  if (outcome.kind === 'unavailable') {
    return Response.json(
      {
        error:
          'this request could not be counted against a shared limit, so it was not accepted. A ' +
          'limit that stops applying when the store is unreachable is not a limit.',
        retryAfterSeconds: 5,
      },
      { status: 503, headers: { 'retry-after': '5' } },
    );
  }

  return Response.json(
    {
      error:
        'too many requests. This ceiling is shared across every instance of this deployment, so it ' +
        'is the same limit wherever the request lands, and it refills on its own.',
      bucket: name,
      remaining: outcome.remaining,
      retryAfterSeconds: outcome.retryAfterSeconds,
    },
    {
      status: 429,
      headers: {
        'retry-after': String(outcome.retryAfterSeconds),
        'x-ratelimit-limit': String(QUOTAS[name].capacity),
        'x-ratelimit-remaining': String(outcome.remaining),
      },
    },
  );
}

export function resetRateLimits(): void {
  hits.clear();
}

const SPEND_SQL = `INSERT INTO agent_quotas AS q (address, bucket, tokens, refilled_at_ms)
       VALUES ($1, $2, $3::int - $4::int, $5::bigint)
       ON CONFLICT (address, bucket) DO UPDATE
          SET tokens = LEAST(
                $3::bigint,
                q.tokens::bigint + (GREATEST(0, $5::bigint - q.refilled_at_ms) / $6::bigint)
              )::int - $4::int,
              refilled_at_ms =
                q.refilled_at_ms
                + (GREATEST(0, $5::bigint - q.refilled_at_ms) / $6::bigint) * $6::bigint
        WHERE LEAST(
                $3::bigint,
                q.tokens::bigint + (GREATEST(0, $5::bigint - q.refilled_at_ms) / $6::bigint)
              ) >= $4::bigint
       RETURNING q.tokens`;

export interface Quota {
  capacity: number;
  msPerToken: number;
}

export const QUOTAS = {
  read: { capacity: 600, msPerToken: 100 },
  write: { capacity: 120, msPerToken: 1_000 },
  purchase: { capacity: 10, msPerToken: 360_000 },
  onramp: { capacity: 5, msPerToken: 600_000 },
  simulate: { capacity: 60, msPerToken: 2_000 },
  publish: { capacity: 20, msPerToken: 120_000 },
  message: { capacity: 60, msPerToken: 10_000 },
} as const satisfies Record<string, Quota>;

export type QuotaName = keyof typeof QUOTAS;

export interface BucketState {
  tokens: number;
  refilledAtMs: number;
}

export type QuotaOutcome =
  | { allowed: true; remaining: number }
  | { allowed: false; kind: 'over-quota'; remaining: number; retryAfterSeconds: number }
  | { allowed: false; kind: 'unavailable'; reason: string };

export function projectBucket(state: BucketState, quota: Quota, nowMs: number): BucketState {
  const elapsed = Math.max(0, nowMs - state.refilledAtMs);
  const earned = Math.floor(elapsed / quota.msPerToken);
  return {
    tokens: Math.min(quota.capacity, state.tokens + earned),
    refilledAtMs: state.refilledAtMs + earned * quota.msPerToken,
  };
}

export function msUntilAffordable(
  projected: BucketState,
  quota: Quota,
  cost: number,
  nowMs: number,
): number {
  const short = cost - projected.tokens;
  if (short <= 0) return 0;
  return Math.max(0, projected.refilledAtMs + short * quota.msPerToken - nowMs);
}

const SWEEP_EVERY_MS = 60_000;
let sweptAtMs = 0;

const SWEEP_AFTER_MS = Math.max(...Object.values(QUOTAS).map((q) => q.capacity * q.msPerToken));

async function sweep(nowMs: number): Promise<void> {
  if (nowMs - sweptAtMs < SWEEP_EVERY_MS) return;
  sweptAtMs = nowMs;
  try {
    await db().query(
      `DELETE FROM agent_quotas
        WHERE (address, bucket) IN (
          SELECT address, bucket FROM agent_quotas
           WHERE refilled_at_ms < $1 AND bucket = ANY($2::text[]) LIMIT 500
        )`,
      [nowMs - SWEEP_AFTER_MS, Object.keys(QUOTAS)],
    );
  } catch {
    // A failed sweep is storage, not correctness. It must never turn a permitted request into a
    // refused one, so it is swallowed here rather than thrown into the caller's path.
  }
}

export async function spendQuota(
  address: string,
  name: QuotaName,
  options: { cost?: number; now?: number } = {},
): Promise<QuotaOutcome> {
  let key: string;
  try {
    key = normaliseAddress(address);
  } catch {
    return { allowed: false, kind: 'unavailable', reason: 'that is not an address' };
  }
  return spendBucketKey(key, name, QUOTAS[name], options);
}

export async function simulateLimit(request: Request): Promise<Response | null> {
  const burst = rateLimit(request, 'simulate');
  if (burst !== null) return burst;

  const outcome = await spendShared(clientKey(request), 'simulate');
  if (outcome.allowed) return null;

  if (outcome.kind === 'unavailable') {
    return Response.json(
      {
        error:
          'this request could not be counted against the shared ceiling, so it was not accepted.',
        retryAfterSeconds: 5,
      },
      { status: 503, headers: { 'retry-after': '5' } },
    );
  }

  const retryAfterSeconds = Math.max(1, Math.ceil(QUOTAS.simulate.msPerToken / 1000));
  return Response.json(
    {
      error:
        'too many quotes from this address. Each one builds a transaction and asks a fullnode ' +
        'about it, so the ceiling is on how often rather than on who.',
      retryAfterSeconds,
    },
    { status: 429, headers: { 'retry-after': String(retryAfterSeconds) } },
  );
}

export async function spendShared(
  clientKeyValue: string,
  name: QuotaName,
  options: { cost?: number; now?: number } = {},
): Promise<QuotaOutcome> {
  return spendBucketKey(`ip:${clientKeyValue}`, name, QUOTAS[name], options);
}

export async function spendConfiguredQuota(
  address: string,
  bucket: ConfiguredBucket,
  quota: Quota,
  options: { cost?: number; now?: number } = {},
): Promise<QuotaOutcome> {
  let key: string;
  try {
    key = normaliseAddress(address);
  } catch {
    return { allowed: false, kind: 'unavailable', reason: 'that is not an address' };
  }
  return spendBucketKey(key, bucket, quota, options);
}

export const CONFIGURED_BUCKETS = ['mind'] as const;
export type ConfiguredBucket = (typeof CONFIGURED_BUCKETS)[number];

async function spendBucketKey(
  key: string,
  name: QuotaName | ConfiguredBucket,
  quota: Quota,
  options: { cost?: number; now?: number } = {},
): Promise<QuotaOutcome> {
  const cost = options.cost ?? 1;
  const nowMs = options.now ?? Date.now();

  if (!Number.isInteger(cost) || cost < 1 || cost > quota.capacity) {
    throw new Error(
      `a cost of ${cost} cannot be spent from the ${name} quota, whose capacity is ${quota.capacity}`,
    );
  }

  try {
    const spent = await db().query<{ tokens: number }>(SPEND_SQL, [
      key,
      name,
      quota.capacity,
      cost,
      nowMs,
      quota.msPerToken,
    ]);

    if (spent.rowCount === 1) {
      await sweep(nowMs);
      return { allowed: true, remaining: spent.rows[0]?.tokens ?? 0 };
    }

    const row = await db().query<{ tokens: number; refilled_at_ms: string }>(
      'SELECT tokens, refilled_at_ms FROM agent_quotas WHERE address = $1 AND bucket = $2',
      [key, name],
    );
    const stored = row.rows[0];
    const state: BucketState =
      stored === undefined
        ?
          { tokens: 0, refilledAtMs: nowMs }
        : { tokens: stored.tokens, refilledAtMs: Number(stored.refilled_at_ms) };

    const projected = projectBucket(state, quota, nowMs);
    const waitMs = msUntilAffordable(projected, quota, cost, nowMs);
    return {
      allowed: false,
      kind: 'over-quota',
      remaining: projected.tokens,
      retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000)),
    };
  } catch (error) {
    return {
      allowed: false,
      kind: 'unavailable',
      reason: opaqueDetail('the quota store', error),
    };
  }
}

export async function quotaLimit(
  address: string,
  name: QuotaName,
  options: { cost?: number; now?: number } = {},
): Promise<Response | null> {
  const quota = QUOTAS[name];

  const breaker = await tripBreaker(name, options);
  if (breaker.tripped) return breakerResponse(name, breaker);

  const outcome = await spendQuota(address, name, options);
  return quotaRefusal(name, quota, outcome);
}

export async function quotaLimitConfigured(
  address: string,
  bucket: ConfiguredBucket,
  quota: Quota,
  options: { cost?: number; now?: number } = {},
): Promise<Response | null> {
  const outcome = await spendConfiguredQuota(address, bucket, quota, options);
  return quotaRefusal(bucket, quota, outcome);
}

function quotaRefusal(name: string, quota: Quota, outcome: QuotaOutcome): Response | null {
  if (outcome.allowed) return null;

  if (outcome.kind === 'unavailable') {
    return Response.json(
      {
        error:
          'this request could not be counted against your quota, so it was not accepted. A quota ' +
          'that stops applying when the store is unreachable is not a quota.',
        retryAfterSeconds: 5,
      },
      { status: 503, headers: { 'retry-after': '5' } },
    );
  }

  return Response.json(
    {
      error:
        `too many ${name} requests from this address. The limit is shared across every instance ` +
        'of this deployment, and it refills on its own.',
      bucket: name,
      capacity: quota.capacity,
      msPerToken: quota.msPerToken,
      remaining: outcome.remaining,
      retryAfterSeconds: outcome.retryAfterSeconds,
    },
    {
      status: 429,
      headers: {
        'retry-after': String(outcome.retryAfterSeconds),
        'x-ratelimit-bucket': name,
        'x-ratelimit-limit': String(quota.capacity),
        'x-ratelimit-remaining': String(outcome.remaining),
      },
    },
  );
}

const BREAKER_KEY = '*deployment*';

export const BREAKER_ENV = {
  read: 'PROJECTX_SOCIAL_BREAKER_READ_PER_MINUTE',
  write: 'PROJECTX_SOCIAL_BREAKER_WRITE_PER_MINUTE',
  purchase: 'PROJECTX_SOCIAL_BREAKER_PURCHASE_PER_HOUR',
  onramp: 'PROJECTX_SOCIAL_BREAKER_ONRAMP_PER_HOUR',
  simulate: 'PROJECTX_SOCIAL_BREAKER_SIMULATE_PER_MINUTE',
  publish: 'PROJECTX_SOCIAL_BREAKER_PUBLISH_PER_HOUR',
  message: 'PROJECTX_SOCIAL_BREAKER_MESSAGE_PER_MINUTE',
} as const satisfies Record<QuotaName, string>;

export const BREAKER_WINDOW_MS = {
  read: 60_000,
  write: 60_000,
  purchase: 3_600_000,
  onramp: 3_600_000,
  simulate: 60_000,
  publish: 3_600_000,
  message: 60_000,
} as const satisfies Record<QuotaName, number>;

export const BREAKER_DEFAULTS = {
  read: 12_000,
  write: 1_200,
  purchase: 60,
  onramp: 60,
  simulate: 600,
  publish: 600,
  message: 1_200,
} as const satisfies Record<QuotaName, number>;

export type BreakerSetting =
  | { state: 'open'; ceiling: number; windowMs: number; msPerToken: number }
  | { state: 'closed'; reason: string };

export function breakerSetting(
  name: QuotaName,
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): BreakerSetting {
  const windowMs = BREAKER_WINDOW_MS[name];
  const raw = env[BREAKER_ENV[name]]?.trim();

  let ceiling: number;
  if (raw === undefined || raw === '') {
    ceiling = BREAKER_DEFAULTS[name];
  } else if (/^\d+$/.test(raw)) {
    ceiling = Number(raw);
  } else {
    return {
      state: 'closed',
      reason:
        `${BREAKER_ENV[name]} is "${raw}", which is not a whole number of requests. The breaker is ` +
        'closed until it is one — an unreadable ceiling is not a ceiling.',
    };
  }

  if (ceiling === 0) {
    return {
      state: 'closed',
      reason: `${BREAKER_ENV[name]} is 0, so ${name} requests from identified callers are stopped.`,
    };
  }

  const capped = Math.min(ceiling, windowMs);
  return {
    state: 'open',
    ceiling: capped,
    windowMs,
    msPerToken: Math.max(1, Math.floor(windowMs / capped)),
  };
}

export type BreakerOutcome =
  | { tripped: false }
  | { tripped: true; kind: 'closed'; reason: string }
  | { tripped: true; kind: 'over-ceiling'; ceiling: number; windowMs: number; retryAfterSeconds: number }
  | { tripped: true; kind: 'unavailable'; reason: string };

export async function tripBreaker(
  name: QuotaName,
  options: { cost?: number; now?: number; env?: Record<string, string | undefined> } = {},
): Promise<BreakerOutcome> {
  const setting = breakerSetting(name, options.env);
  if (setting.state === 'closed') return { tripped: true, kind: 'closed', reason: setting.reason };

  const cost = options.cost ?? 1;
  const nowMs = options.now ?? Date.now();

  if (!Number.isInteger(cost) || cost < 1) {
    throw new Error(`a breaker cost of ${cost} is not a whole number of requests`);
  }
  if (cost > setting.ceiling) {
    return {
      tripped: true,
      kind: 'over-ceiling',
      ceiling: setting.ceiling,
      windowMs: setting.windowMs,
      retryAfterSeconds: Math.max(1, Math.ceil(setting.windowMs / 1000)),
    };
  }

  const quota: Quota = { capacity: setting.ceiling, msPerToken: setting.msPerToken };

  try {
    const spent = await db().query<{ tokens: number }>(SPEND_SQL, [
      BREAKER_KEY,
      name,
      quota.capacity,
      cost,
      nowMs,
      quota.msPerToken,
    ]);

    if (spent.rowCount === 1) return { tripped: false };

    const row = await db().query<{ tokens: number; refilled_at_ms: string }>(
      'SELECT tokens, refilled_at_ms FROM agent_quotas WHERE address = $1 AND bucket = $2',
      [BREAKER_KEY, name],
    );
    const stored = row.rows[0];
    const state: BucketState =
      stored === undefined
        ? { tokens: 0, refilledAtMs: nowMs }
        : { tokens: stored.tokens, refilledAtMs: Number(stored.refilled_at_ms) };
    const waitMs = msUntilAffordable(projectBucket(state, quota, nowMs), quota, cost, nowMs);

    return {
      tripped: true,
      kind: 'over-ceiling',
      ceiling: setting.ceiling,
      windowMs: setting.windowMs,
      retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000)),
    };
  } catch (error) {
    return {
      tripped: true,
      kind: 'unavailable',
      reason: opaqueDetail('the quota store', error),
    };
  }
}

function breakerResponse(name: QuotaName, outcome: Extract<BreakerOutcome, { tripped: true }>): Response {
  const retryAfterSeconds =
    outcome.kind === 'over-ceiling' ? outcome.retryAfterSeconds : outcome.kind === 'closed' ? 60 : 5;

  return Response.json(
    {
      error:
        outcome.kind === 'closed'
          ? 'this deployment is not accepting agent traffic of this kind at the moment. This is a ' +
            'deliberate operator setting, not a judgement about you or your address.'
          : outcome.kind === 'unavailable'
            ? 'this request could not be counted against the deployment ceiling, so it was not ' +
              'accepted. A ceiling that stops applying when the store is unreachable is not a ceiling.'
            : 'this deployment is over its ceiling for this kind of request, across every caller. ' +
              'Your own quota is unaffected; wait and retry.',
      breaker: name,
      kind: outcome.kind,
      ...(outcome.kind === 'over-ceiling'
        ? { ceiling: outcome.ceiling, windowMs: outcome.windowMs }
        : {}),
      retryAfterSeconds,
    },
    {
      status: 503,
      headers: {
        'retry-after': String(retryAfterSeconds),
        'x-weir-breaker': `${name};${outcome.kind}`,
      },
    },
  );
}

export function resetQuotaSweep(): void {
  sweptAtMs = 0;
}
