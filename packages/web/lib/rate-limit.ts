// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
/**
 * A ceiling on how often one caller may hit an endpoint.
 *
 * # What this defends, and what it does not
 *
 * Not authentication. Every route worth protecting already proves who the caller is, or needs no
 * proof because it writes nothing. What was missing is a limit on *volume*: the simulate and
 * prepare routes each build a transaction and call a fullnode, so an unauthenticated loop spends
 * this deployment's CPU and its share of a public, rate-limited RPC endpoint until real visitors
 * start seeing failures. There is nothing to steal there; there is plenty to exhaust.
 *
 * # Why the state lives here rather than in `proxy.ts`
 *
 * A proxy is the obvious single place to put this, and Next's own documentation rules it out: a
 * proxy "in optimized cases [is] deployed to your CDN" and must not "rely on shared modules or
 * globals". A counter is nothing but shared state, so it would be correct on one deployment and
 * silently useless on another. Route handlers run in the Node runtime, where module state does
 * persist for the life of an instance.
 *
 * # The honest limitation
 *
 * Serverless multiplies instances, and each instance counts on its own. A caller spread across many
 * instances gets more than `limit` requests, and an attacker who can force new instances gets
 * proportionally more. This stops a naive loop against a warm instance — the common case, and the
 * cheap one to stop — and it is **not** a substitute for a platform firewall at the edge. Anything
 * stronger belongs in front of the application rather than inside it.
 */

/** How many requests, over how long. */
export interface Budget {
  limit: number;
  windowMs: number;
}

/**
 * Three classes, priced by what a request actually costs this deployment.
 *
 * `simulate` is the expensive one: it builds a transaction and calls a fullnode, so it is the class
 * that can exhaust something. `write` touches Postgres and is already signature-gated, so its
 * ceiling is about runaway clients rather than abuse. `read` is generous because one person loading
 * one page legitimately makes several.
 */
export const BUDGETS = {
  simulate: { limit: 20, windowMs: 60_000 },
  write: { limit: 40, windowMs: 60_000 },
  read: { limit: 200, windowMs: 60_000 },
} as const satisfies Record<string, Budget>;

export type BudgetName = keyof typeof BUDGETS;

/**
 * The only client identifier this trusts, and one shared bucket when it is absent.
 *
 * `x-real-ip` is set by the platform in front of this application and cannot be forged by a caller
 * reaching it through that platform. Nothing else qualifies.
 *
 * # `x-forwarded-for` was read here, and it undid the limiter
 *
 * The header is client-settable. This used to fall back to its **first** entry, on the reasoning
 * that an edge network puts the origin address there — true, and irrelevant, because a caller who
 * sends the header themselves chooses that entry. Sending a different value per request bought an
 * unlimited budget on every route.
 *
 * It was worse than a bypass. Each fabricated key took a slot in `hits`, and `prune` evicts the
 * least-recently-used third once the table is full — so the same requests that escaped the limit
 * also **forgave** the real callers who were being limited by it. An attacker turned the limiter
 * off for everybody, not just themselves.
 *
 * The docstring this replaces already contained the argument: "trusting a spoofable header is a
 * limit that is not a limit at all". It then trusted one.
 *
 * # Why the fallback is one shared bucket
 *
 * A direct local request, or a platform that sets neither header, now shares a single bucket with
 * every other such caller. That is deliberately too strict rather than too permissive: an
 * over-strict limit is visible the moment it bites, while a limit that can be shrugged off is
 * indistinguishable from a working one until someone tries.
 */
export function clientKey(request: Request): string {
  /*
    Behind Cloudflare, `x-real-ip` is Cloudflare.

    Vercel sets `x-real-ip` at *its* edge. Put Cloudflare in front and that edge is no longer the
    one the visitor reached, so the header carries a Cloudflare address and every visitor on earth
    collapses into one bucket — a global 40/min write limit that reads as an outage rather than as a
    limiter. `CF-Connecting-IP` is the visitor, and Cloudflare overwrites it on every request it
    proxies, so a client cannot set it from outside.

    Gated on configuration, and unset means do not trust it. That is the whole point: this header is
    only unforgeable while something is guaranteed to overwrite it. Trusting it when nothing is in
    front would reintroduce, exactly, the `x-forwarded-for` bypass removed from this function — a
    caller could rotate it per request and mint unlimited buckets. So the flag must be set only once
    the proxy is actually on, and turning the proxy off means turning the flag off in the same
    change.
  */
  if ((process.env['PROJECTX_SOCIAL_BEHIND_CLOUDFLARE'] ?? '') === 'true') {
    const visitor = request.headers.get('cf-connecting-ip');
    if (visitor !== null && visitor.trim() !== '') return visitor.trim();
    // Configured as proxied but the header is absent: the request did not come through Cloudflare.
    // One shared bucket rather than falling back to a header that now means the proxy, not the
    // caller — and rather than concluding everybody is a different caller.
    return 'unattributed';
  }

  const real = request.headers.get('x-real-ip');
  if (real !== null && real.trim() !== '') return real.trim();

  return 'unattributed';
}

/** Hit timestamps per bucket, newest last. */
const hits = new Map<string, number[]>();

/**
 * A ceiling on the table itself.
 *
 * Without one, a caller rotating through addresses grows this map until the instance dies — memory
 * exhaustion delivered through the thing meant to prevent exhaustion. When the cap is reached the
 * least recently used third is dropped, which briefly forgives whoever was evicted. Forgiving a few
 * callers is the right failure; the alternative is the process ending.
 */
const MAX_KEYS = 10_000;

function prune(): void {
  if (hits.size < MAX_KEYS) return;
  const entries = [...hits.entries()];
  entries.sort((a, b) => (a[1][a[1].length - 1] ?? 0) - (b[1][b[1].length - 1] ?? 0));
  for (const [key] of entries.slice(0, Math.floor(MAX_KEYS / 3))) hits.delete(key);
}

/**
 * Record one request and say whether it is over the limit.
 *
 * Exported separately from {@link rateLimit} so the decision can be tested without constructing a
 * `Request` or reading a clock — `now` is a parameter for the same reason.
 */
export function consume(
  key: string,
  budget: Budget,
  now: number = Date.now(),
): { allowed: boolean; remaining: number; retryAfterSeconds: number } {
  prune();

  const since = now - budget.windowMs;
  // A sliding window rather than a fixed one. Fixed windows let a caller spend the whole budget in
  // the last second of one window and the whole budget again in the first second of the next.
  const recent = (hits.get(key) ?? []).filter((at) => at > since);

  if (recent.length >= budget.limit) {
    hits.set(key, recent);
    const oldest = recent[0] ?? now;
    return {
      allowed: false,
      remaining: 0,
      // When the oldest hit leaves the window, one more becomes available. Rounded up, and never
      // zero — a `Retry-After: 0` invites an immediate retry, which is the behaviour being limited.
      retryAfterSeconds: Math.max(1, Math.ceil((oldest + budget.windowMs - now) / 1000)),
    };
  }

  recent.push(now);
  hits.set(key, recent);
  return { allowed: true, remaining: budget.limit - recent.length, retryAfterSeconds: 0 };
}

/**
 * The guard a route calls. Returns a `429` to return, or `null` to carry on.
 *
 * Deliberately shaped so the caller writes `if (limited !== null) return limited;` — a guard
 * returning a boolean would be one forgotten `return` away from counting every request and allowing
 * all of them.
 */
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

/** Test seam. Nothing in the application calls this. */
export function resetRateLimits(): void {
  hits.clear();
}
