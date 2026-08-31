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
 *
 * **And the limitation is wider than the paragraph above says.** That paragraph is about instances.
 * The other half is about *keys*: every counter in this file, in-process or in Postgres, is keyed on
 * something the caller supplies or owns — a network address, or a Sui address. Both are cheap. An
 * address costs gas and nothing else, so an adversary willing to spend a few SUI holds ten thousand
 * of them, and ten thousand full buckets is ten thousand times the ceiling. **A per-key limiter
 * bounds one runaway caller. It does not bound an adversary, and it never did.** That is not a
 * defect in the arithmetic below; it is what per-key limiting is. It is why {@link tripBreaker}
 * exists, and why layer 1 is not optional.
 *
 * # Two halves, and which one is the ceiling
 *
 * That limitation was survivable while every caller was a browser. A person makes a handful of
 * requests a minute and lands on one warm instance, so `limit x instances` and `limit` are the same
 * number to them. An agent is the opposite: deliberately concurrent, retrying on failure, and
 * running at the rate that makes a browser limiter bite. For that caller `limit x instances` is not
 * a ceiling but a number they raise by opening connections — and one the platform raises for them
 * by scaling out under exactly the load that needed limiting.
 *
 * So this file now holds three things, and they are not interchangeable:
 *
 *   * {@link rateLimit} — unchanged, in-process, keyed on the network address of an **anonymous**
 *     caller. It is the only thing available where there is no identity to key on, which is most of
 *     the public surface. It remains best-effort and remains not a firewall.
 *   * {@link quotaLimit} — a Postgres token bucket keyed on the **Sui address** of an authenticated
 *     caller, shared by every instance. It is the ceiling that holds **for one address**, and it is
 *     what bounds one agent that has gone wrong. `025_quotas.sql` carries the concurrency argument
 *     in full. **It is not the ceiling on agent traffic**, and an earlier version of this doc block
 *     said it was. Correcting that sentence is the whole reason the paragraph above it exists: the
 *     claim was true about a caller and was read as a claim about the load, and those differ by
 *     however many addresses somebody is willing to fund.
 *   * {@link tripBreaker} — one Postgres bucket for the **whole deployment**, not keyed on the
 *     caller at all. It is the only counter here an adversary cannot dilute by minting keys, and it
 *     is the one an operator can set to zero to stop agent traffic without a deploy.
 *
 * The address-keyed half could not simply replace the other. It needs an identity the caller has
 * proved, and it costs a round trip to Postgres; applying it to anonymous reads would key thousands
 * of strangers into one bucket and put a database write on the front page. The two run together —
 * volume by network address at the door, quota by identity once the caller is known.
 *
 * # The four layers, and what each one does NOT defend
 *
 * Written out because every one of them has been mistaken for the others at some point in this
 * file's life, and each mistake looks like coverage.
 *
 * **Layer 1 — edge, volumetric, per-IP and per-ASN. Configuration in Cloudflare, not code.**
 * It is the only layer that sees a request this application never pays for, and the only one that
 * can absorb a flood rather than merely refuse it: an application-layer 429 still costs a function
 * invocation, a TLS handshake and a database round trip, so a limiter inside the process is a
 * limiter the attacker is still paying us to run. **It does not know who anybody is.** It cannot
 * tell one agent's thousand requests from a thousand readers' one, so it must be set loose enough
 * to never touch a real audience — which means it is a flood stop and nothing finer. The exact
 * rules to create are written out under "The rules to create in Cloudflare" below, because a layer
 * that lives in somebody's dashboard and nowhere in the repository is a layer that is lost the
 * first time the account changes hands.
 *
 * **Layer 2 — identity, the Postgres token bucket per Sui address ({@link quotaLimit}).**
 * It is the only layer that can price a *kind* of request, which is why `purchase` is 10 and `read`
 * is 600 — an agent looping on the buy path can lose ten purchases before it is stopped, and the
 * number is a judgement about money rather than about CPU. **It does not defend against an
 * adversary**, per the paragraph above: buckets are per address and addresses are cheap. It bounds
 * a mistake, not an attack.
 *
 * **Layer 3 — the global circuit breaker ({@link tripBreaker}).**
 * One bucket for the entire deployment, spent by every identified agent request whatever address it
 * arrives under, so ten thousand addresses spend ten thousand tokens from the same bucket rather
 * than from ten thousand of their own. Env-driven, so the ceiling moves — and `0` closes it — with
 * no deploy and no code review at the moment somebody needs it closed. **It does not distinguish
 * the guilty from the innocent.** A tripped breaker refuses a well-behaved agent exactly as it
 * refuses the one that tripped it; that is the trade being made deliberately, because the state it
 * exists for is the one where a person needs the traffic to stop now and can sort out who was at
 * fault afterwards. It also does not see anonymous browser traffic at all — that is layers 1 and 4.
 *
 * **Layer 4 — economic, and it is on chain rather than here.**
 * Gas on every address ever funded; the 29 SUI creation fee bonding a vault; `payments_paused` on
 * the `Platform` object, which stops settlement for everybody regardless of what any HTTP layer
 * decided. It is the only layer that survives this application being wrong, unavailable or
 * bypassed entirely — a caller who goes straight to a fullnode never touches layers 1 to 3 and
 * still cannot move money past it. **It does not protect the infrastructure.** Reads cost nothing
 * on chain, so nothing economic bounds an adversary who only wants to exhaust our fullnode share,
 * and `payments_paused` is a switch for the whole platform rather than for one caller.
 *
 * # The rules to create in Cloudflare
 *
 * Layer 1 is configuration, and it is recorded here because nothing in this repository can assert
 * it. `PROJECTX_SOCIAL_BEHIND_CLOUDFLARE` must be `true` for the proxy to be in front at all — see
 * {@link clientKey}, which refuses to trust `cf-connecting-ip` until it is, and must be turned off
 * in the same change that removes the proxy.
 *
 *   1. **Rate limiting rule — the agent surface.**
 *      Expression: `(starts_with(http.request.uri.path, "/api/") and not
 *      starts_with(http.request.uri.path, "/api/auth"))`
 *      Characteristics: `ip.src`. Period 60 s, requests 600, mitigation Block, timeout 60 s.
 *      Response: 429 with a JSON body, so a client parses a refusal here the same way it parses
 *      {@link rateLimit}'s.
 *   2. **Rate limiting rule — the money path, tighter.**
 *      Expression: `(starts_with(http.request.uri.path, "/api/checkout/"))`
 *      Characteristics: `ip.src`. Period 60 s, requests 60, mitigation Block, timeout 300 s.
 *   3. **Rate limiting rule — the whole origin, per ASN rather than per IP.**
 *      Expression: `(http.host eq "weir.social")`
 *      Characteristics: `ip.geoip.asnum`. Period 60 s, requests 20000, mitigation Managed Challenge.
 *      This is the one that sees a botnet spread across a hosting provider, which per-IP cannot.
 *   4. **WAF custom rule — refuse an unidentifiable machine on the write surface.**
 *      Expression: `(http.request.method in {"POST" "PUT" "DELETE"} and
 *      starts_with(http.request.uri.path, "/api/") and http.user_agent eq "")`
 *      Action: Block. The manifest's `disclosure.userAgent` asks every agent for a contactable
 *      User-Agent; this makes the empty case cost something without inspecting the contents, which
 *      the manifest is careful to say we do not do.
 *   5. **WAF custom rule — never challenge the discovery document.**
 *      Expression: `(http.request.uri.path eq "/.well-known/weir-agent.json")`
 *      Action: Skip (all remaining custom rules, rate limiting rules and Super Bot Fight Mode).
 *      A manifest behind a browser challenge is a manifest no program can read, which is the same
 *      outage as not publishing one.
 *   6. **Bot Fight Mode: off, or Super Bot Fight Mode with "Definitely automated" set to Allow on
 *      `/api/` and `/.well-known/`.** This platform invites machine callers by design and asks them
 *      to declare themselves; a blanket bot block would refuse exactly the traffic the register
 *      exists to admit. Leave the challenge for `/admin` and the browser surface.
 *
 * None of the six is asserted by any test in this repository, and no test can assert them. They are
 * written here so that the day somebody asks what layer 1 is, the answer is a diff and not a memory.
 */

import { db, normaliseAddress } from './db';

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

/* ------------------------------------------------------------------------------------------------
   The shared ceiling: a Postgres token bucket, keyed on address.

   Everything above this line counts in one process's memory. Everything below counts in the one
   place every instance can see. See `db/025_quotas.sql` for the statement and the argument that it
   is safe under concurrency; the short version is that the refill and the decrement are a single
   `INSERT ... ON CONFLICT DO UPDATE`, and Postgres evaluates that update against the latest
   committed row after taking its lock, so two instances cannot both spend the last token.
   ------------------------------------------------------------------------------------------------ */


/**
 * The one statement, held in one place because two callers now run it.
 *
 * Hoisted out of {@link spendQuota} when {@link tripBreaker} arrived. It is deliberately a constant
 * rather than a second copy: `test/quotas.test.ts` greps THIS FILE for this text and refuses to run
 * its concurrency proof against anything else, and a second copy would be a statement the test
 * blesses and the application does not run — which reads like proof and is not.
 *
 * The statement itself is unchanged, character for character, and `025_quotas.sql` carries the
 * argument for why it is safe under concurrency.
 */
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

/**
 * A burst allowance and a sustained rate, stated separately.
 *
 * `capacity` is how many requests are available at once to a caller who has been idle. It is spent
 * down and refills at one token every `msPerToken`, which is the rate the caller settles to. Both
 * numbers are given to a refused client so an agent can pace itself rather than guess.
 */
export interface Quota {
  capacity: number;
  msPerToken: number;
}

/**
 * Three buckets, priced by what a runaway caller costs.
 *
 * `purchase` is the one that matters and the reason this table exists. The other two bound
 * infrastructure; this one bounds an agent's spending, and it is deliberately the tightest thing
 * here. Ten at once, then one every six minutes: an agent stuck in a retry loop against the buy
 * path can lose ten purchases before the ceiling catches it, and cannot lose the eleventh for six
 * minutes. That number is a judgement about how much money a defect may cost before a person sees
 * it, and it belongs in a place a person can change without redeploying an argument.
 *
 * `write` is signature-gated already, so its ceiling is about runaway clients rather than abuse.
 * `read` is generous because one agent doing one useful piece of work legitimately makes several.
 *
 * These are a separate namespace from {@link BUDGETS}. The names overlap and the meanings do not:
 * `BUDGETS.read` is a browser's reads from one network address on one instance, `QUOTAS.read` is an
 * identified caller's reads across the whole deployment.
 */
export const QUOTAS = {
  read: { capacity: 600, msPerToken: 100 },
  write: { capacity: 120, msPerToken: 1_000 },
  purchase: { capacity: 10, msPerToken: 360_000 },
} as const satisfies Record<string, Quota>;

export type QuotaName = keyof typeof QUOTAS;

/** The state of one bucket at one instant. */
export interface BucketState {
  tokens: number;
  refilledAtMs: number;
}

export type QuotaOutcome =
  | { allowed: true; remaining: number }
  | { allowed: false; kind: 'over-quota'; remaining: number; retryAfterSeconds: number }
  | { allowed: false; kind: 'unavailable'; reason: string };

/**
 * The refill, in TypeScript, as the SQL computes it.
 *
 * # Why this exists when the SQL is what runs
 *
 * Two reasons, and neither is "so the arithmetic lives in two places".
 *
 * First, {@link quotaLimit} has to tell a refused caller when to come back, and that answer is this
 * arithmetic — the SQL writes nothing on a refusal, so the number has to be derived from the row as
 * it stands. This function is that derivation, not a copy of one.
 *
 * Second, it is the oracle `test/quotas.test.ts` asserts the SQL against, over a table of cases
 * including the ones that are easy to get wrong: a clock that goes backwards, a partial token, and
 * an idle bucket that must cap rather than bank. If the two ever disagree, that test goes red — so
 * the duplication is pinned rather than trusted, and the SQL is the one that is right.
 *
 * `refilledAtMs` advances by whole tokens' worth of elapsed time only. Advancing it to `now` would
 * discard the remainder on every call, so a caller arriving faster than `msPerToken` would never
 * refill at all — a limiter that tightens the more it is used.
 */
export function projectBucket(state: BucketState, quota: Quota, nowMs: number): BucketState {
  // Clock skew between instances makes this negative, and integer division truncates toward zero in
  // Postgres — so an unguarded expression would take tokens away for time that had not passed.
  const elapsed = Math.max(0, nowMs - state.refilledAtMs);
  const earned = Math.floor(elapsed / quota.msPerToken);
  return {
    tokens: Math.min(quota.capacity, state.tokens + earned),
    refilledAtMs: state.refilledAtMs + earned * quota.msPerToken,
  };
}

/** How long until `cost` tokens exist, given a bucket already projected to `nowMs`. */
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

/**
 * Sweep at most this often, per instance.
 *
 * Per-process state, deliberately, in the file that just moved its counters out of per-process
 * state — because the two are not the same kind of thing. A counter that is wrong per instance is a
 * limit that does not hold. A *sweep* that runs on several instances at once, or misses a round,
 * costs some rows of storage and changes no decision. Doing it on every request instead would put a
 * second round trip on the hot path to reclaim rows that are, by the arithmetic, already full.
 */
const SWEEP_EVERY_MS = 60_000;
let sweptAtMs = 0;

/**
 * The interval after which an untouched row is provably at capacity.
 *
 * `refilled_at_ms` advances only on a successful spend, so a row older than the widest bucket's
 * fill time has refilled completely. Deleting it and recreating it full are the same thing.
 * Sweeping on any shorter cutoff would forgive a caller a limit that was biting, which is why this
 * is computed from the buckets rather than picked.
 */
const SWEEP_AFTER_MS = Math.max(...Object.values(QUOTAS).map((q) => q.capacity * q.msPerToken));

async function sweep(nowMs: number): Promise<void> {
  if (nowMs - sweptAtMs < SWEEP_EVERY_MS) return;
  sweptAtMs = nowMs;
  try {
    // Bounded, so one unlucky request does not pay for every idle row ever written. Same shape as
    // the `used_signatures` sweep in `lib/identity.ts`.
    await db().query(
      `DELETE FROM agent_quotas
        WHERE (address, bucket) IN (
          SELECT address, bucket FROM agent_quotas WHERE refilled_at_ms < $1 LIMIT 500
        )`,
      [nowMs - SWEEP_AFTER_MS],
    );
  } catch {
    // A failed sweep is storage, not correctness. It must never turn a permitted request into a
    // refused one, so it is swallowed here rather than thrown into the caller's path.
  }
}

/**
 * Spend one token, or say why not.
 *
 * `now` and `cost` are parameters for the same reason `consume` takes `now`: the decision can be
 * tested without waiting, and a caller that costs more than one request can be priced.
 *
 * # Fails closed
 *
 * A database this cannot reach yields `unavailable`, not permission. A quota an attacker turns off
 * by making Postgres unreachable is not a quota — and the routes that carry one were about to write
 * to that same database anyway, so nothing is lost that was not already lost.
 */
export async function spendQuota(
  address: string,
  name: QuotaName,
  options: { cost?: number; now?: number } = {},
): Promise<QuotaOutcome> {
  const quota = QUOTAS[name];
  const cost = options.cost ?? 1;
  const nowMs = options.now ?? Date.now();

  if (!Number.isInteger(cost) || cost < 1 || cost > quota.capacity) {
    // Not a refusal to report to a client: a cost above capacity can never be afforded, so the
    // caller would be told to retry forever. It is a mistake in this codebase, and it is loud.
    throw new Error(
      `a cost of ${cost} cannot be spent from the ${name} quota, whose capacity is ${quota.capacity}`,
    );
  }

  let key: string;
  try {
    key = normaliseAddress(address);
  } catch {
    return { allowed: false, kind: 'unavailable', reason: 'that is not an address' };
  }

  try {
    /*
      One statement, and therefore one transaction.

      On the conflict Postgres locks the existing row, waits for whoever holds it, and evaluates the
      SET and the WHERE against the row's latest committed version rather than this statement's
      snapshot — so the second of two simultaneous spenders sees what the first one wrote. A
      SELECT followed by an UPDATE would not: both would read the same last token and both would
      write zero, which is the per-process defect this table exists to fix, reintroduced as a race.

      `rowCount` is the answer. The insert path always affords the cost (checked above against
      capacity); the conflict path updates only if the WHERE holds, so 0 rows means over quota. On
      refusal nothing at all is written, which keeps the accrued time for the next attempt instead
      of spending it on a request that was turned away.
    */
    const spent = await db().query<{ tokens: number }>(SPEND_SQL, [
      key,
      name,
      quota.capacity,
      cost,
      nowMs,
      quota.msPerToken,
    ]);

    if (spent.rowCount === 1) {
      // Awaited, not fired and forgotten. A serverless instance is frozen the moment the response
      // is returned, so a floating promise here is a statement that may never run — and worse, may
      // run against a pool that has been torn down. It is throttled to once a minute per instance,
      // so what is being awaited is one bounded DELETE in every few thousand requests.
      await sweep(nowMs);
      return { allowed: true, remaining: spent.rows[0]?.tokens ?? 0 };
    }

    /*
      Over quota. This read is NOT part of the decision — that was made and is final the moment the
      statement above wrote nothing. It exists only to put a true number in `Retry-After`, and it is
      paid for exclusively by callers who are already over their limit.

      Telling the client `msPerToken` without reading would also be honest and would be an
      over-estimate every time, which for an agent is the difference between backing off correctly
      and backing off for longer than it needed to.
    */
    const row = await db().query<{ tokens: number; refilled_at_ms: string }>(
      'SELECT tokens, refilled_at_ms FROM agent_quotas WHERE address = $1 AND bucket = $2',
      [key, name],
    );
    const stored = row.rows[0];
    const state: BucketState =
      stored === undefined
        ? // The row was swept between the two statements. It would now be full, so the refusal we
          // just returned is stale — report the shortest honest wait rather than inventing one.
          { tokens: 0, refilledAtMs: nowMs }
        : { tokens: stored.tokens, refilledAtMs: Number(stored.refilled_at_ms) };

    const projected = projectBucket(state, quota, nowMs);
    const waitMs = msUntilAffordable(projected, quota, cost, nowMs);
    return {
      allowed: false,
      kind: 'over-quota',
      remaining: projected.tokens,
      // Never zero. A `Retry-After: 0` asks for exactly the behaviour being limited, and an agent
      // will take it literally in a way a person would not.
      retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000)),
    };
  } catch (error) {
    return {
      allowed: false,
      kind: 'unavailable',
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * The guard an authenticated route calls. Returns a response to return, or `null` to carry on.
 *
 * Shaped like {@link rateLimit} on purpose — `if (limited !== null) return limited;` — because a
 * guard returning a boolean is one forgotten `return` away from counting every request and allowing
 * all of them. This one is `async`; `rateLimit` is not, and neither signature has changed.
 *
 * # Two ceilings, in this order, and the order is the argument
 *
 * The deployment-wide breaker is consulted first and the caller's own bucket second. Layer 3 exists
 * because layer 2 is per address and addresses are cheap — so the layer that an adversary cannot
 * dilute has to be the one that answers first, or ten thousand addresses each get their own
 * decision before anything looks at the total. See {@link tripBreaker} for why counting admitted
 * attempts rather than served requests is the honest over-count.
 *
 * This is also where the breaker is wired to every route that has one, without a single route
 * changing. Every caller of this function is by definition an identified one, which is exactly the
 * traffic layer 3 is meant to bound; anonymous volume is layers 1 and 4, and putting a row lock on
 * that path would be a database write on the front page.
 */
export async function quotaLimit(
  address: string,
  name: QuotaName,
  options: { cost?: number; now?: number } = {},
): Promise<Response | null> {
  const quota = QUOTAS[name];

  const breaker = await tripBreaker(name, options);
  if (breaker.tripped) return breakerResponse(name, breaker);

  const outcome = await spendQuota(address, name, options);
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
      // Given so a client can pace itself to the sustained rate instead of discovering it by being
      // refused repeatedly, which is the loop this is meant to end.
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

/* ------------------------------------------------------------------------------------------------
   Layer 3: the global circuit breaker.

   Everything above this line is keyed on somebody — a network address or a Sui address. Everything
   below is keyed on nothing, which is the entire point: a counter an adversary can dilute by
   minting keys is not a ceiling on load, and minting a Sui address costs gas and a moment.
   ------------------------------------------------------------------------------------------------ */

/**
 * The one row every identified agent request spends from, whoever they are.
 *
 * A literal that {@link normaliseAddress} can never produce. That function returns `0x` followed by
 * exactly 64 lower-case hex digits for every input it accepts and throws on everything else, so no
 * caller — funded, forged or accidental — can land on this key and no caller's spending can be
 * mistaken for the deployment's. The row lives in the same table as the per-address buckets on
 * purpose: it needs the same statement, the same lock behaviour and the same sweep, and a second
 * table would be a second set of all three to keep correct.
 */
const BREAKER_KEY = '*deployment*';

/**
 * Which environment variable sets each ceiling, and what the value means.
 *
 * **Zero is the kill switch.** Set one of these to `0` and that class of agent traffic stops at the
 * next request, with no deploy, no build and no review — which is the only property that matters
 * about a breaker, because the moment somebody needs one closed is never a moment there is time to
 * ship code. Unset means the default below, never "unlimited": a breaker that is off until somebody
 * remembers to turn it on is a breaker that was not there on the night it was needed.
 *
 * Named per bucket rather than as one number because the three are not interchangeable. Reads
 * exhaust a fullnode share; purchases move money. An operator stopping a runaway buy loop should
 * not have to take the read surface down with it, and an operator shedding read load should not
 * silently stop settling purchases somebody has already been quoted for.
 */
export const BREAKER_ENV = {
  read: 'PROJECTX_SOCIAL_BREAKER_READ_PER_MINUTE',
  write: 'PROJECTX_SOCIAL_BREAKER_WRITE_PER_MINUTE',
  purchase: 'PROJECTX_SOCIAL_BREAKER_PURCHASE_PER_HOUR',
} as const satisfies Record<QuotaName, string>;

/**
 * The window each ceiling is expressed over. Code, not configuration.
 *
 * Held here rather than in the environment so that one variable carries one number and an operator
 * changing a ceiling under pressure cannot accidentally change what the ceiling means. The names in
 * {@link BREAKER_ENV} carry the window so nobody has to read this to know it.
 */
export const BREAKER_WINDOW_MS = {
  read: 60_000,
  write: 60_000,
  purchase: 3_600_000,
} as const satisfies Record<QuotaName, number>;

/**
 * What each ceiling is when nothing is configured.
 *
 * Set well above any honest load and well below what a determined caller would like: 12000 reads a
 * minute is 200 a second across the whole deployment, which no real audience of this size
 * approaches and which a single loop reaches in seconds. These numbers are a backstop, not a
 * budget — the layer that should be biting first is {@link quotaLimit}, and a deployment where the
 * breaker trips routinely has a per-address quota that is set wrong.
 *
 * `purchase` is the deliberate outlier at 60 an hour. It is the only bucket whose exhaustion costs
 * money rather than CPU, and 60 settled purchases in an hour from machine callers is already far
 * past anything this platform has seen; the number is a judgement about how much a defect may cost
 * before a person sees it, matching the argument on `QUOTAS.purchase`.
 */
export const BREAKER_DEFAULTS = {
  read: 12_000,
  write: 1_200,
  purchase: 60,
} as const satisfies Record<QuotaName, number>;

/**
 * A breaker as the request path sees it.
 *
 * `closed` carries no numbers because there are none to carry: nothing is counted, nothing is
 * spent, and no database is touched. That is not an optimisation — it is what makes the kill switch
 * work when the reason somebody reached for it is that the database is the thing on fire.
 */
export type BreakerSetting =
  | { state: 'open'; ceiling: number; windowMs: number; msPerToken: number }
  | { state: 'closed'; reason: string };

/**
 * Read one ceiling out of the environment.
 *
 * # An unreadable value closes the breaker
 *
 * A typo here takes agent traffic down, and that is the intended direction. The alternative — fall
 * back to the default and carry on — means an operator who typed `PROJECTX_SOCIAL_BREAKER_READ_PER_MINUTE=O`
 * (letter O) believes they have set a ceiling and has set nothing, and discovers it on the night
 * they needed it. This file already made that argument once about `x-forwarded-for`: "an
 * over-strict limit is visible the moment it bites, while a limit that can be shrugged off is
 * indistinguishable from a working one until someone tries." A closed breaker announces itself
 * within one request; a silently ignored one announces itself never.
 *
 * # Why the ceiling is clamped to the window
 *
 * `msPerToken` is integer milliseconds, so a ceiling above one token per millisecond would floor to
 * zero and either divide by zero in SQL or, clamped naively to 1, refill *faster* than the operator
 * asked for. Clamped to `windowMs` instead, which is the largest ceiling the arithmetic can express
 * honestly. Nobody will reach it; the clamp exists so that if they do, the number they get is
 * smaller than the one they asked for rather than larger.
 */
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
    // Never zero: `capped <= windowMs` above guarantees at least one millisecond per token.
    msPerToken: Math.max(1, Math.floor(windowMs / capped)),
  };
}

/** What the breaker decided, and enough of why for a caller to be told something true. */
export type BreakerOutcome =
  | { tripped: false }
  | { tripped: true; kind: 'closed'; reason: string }
  | { tripped: true; kind: 'over-ceiling'; ceiling: number; windowMs: number; retryAfterSeconds: number }
  | { tripped: true; kind: 'unavailable'; reason: string };

/**
 * Spend one token from the deployment-wide bucket, or say why not.
 *
 * # Why it runs before the caller's own quota, not after
 *
 * Because the load an adversary imposes is real whether or not their own bucket would have allowed
 * it. Spending the caller's token first and the deployment's second would mean a tripped breaker
 * still charged an innocent caller for a request nobody served; checking the breaker first means
 * the deployment bucket counts *admitted attempts*, which is deliberately a slight over-count — a
 * caller who is over their own quota has still spent a global token. That over-count is the honest
 * direction: it is the request rate arriving at this deployment, which is the quantity a breaker is
 * meant to bound, rather than the subset of it we chose to serve.
 *
 * # Fails closed, for the same reason `spendQuota` does
 *
 * A database this cannot reach yields `unavailable`, never permission. A breaker an attacker turns
 * off by making Postgres unreachable is not a breaker — and the same round trip was about to be
 * made by `spendQuota` immediately afterwards, so nothing is lost that was not already lost.
 */
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
    // Not thrown, unlike `spendQuota`'s equivalent. There the cost and the capacity are both
    // constants in this file and a mismatch is a bug; here the capacity is whatever an operator
    // typed a minute ago, and a request that is simply larger than the current ceiling is a state
    // the world can be in rather than a mistake in the code.
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
    /*
      The same statement the per-address buckets run, against a row nobody owns.

      Worth stating because it looks like a shortcut and is not: the concurrency property this
      needs is exactly the one `025_quotas.sql` argues for, and it is needed HARDER here. Every
      instance of this deployment contends on this single row, so the lost update that a per-address
      bucket would suffer only when one caller raced themselves is, for this row, the normal case on
      every concurrent request. `INSERT ... ON CONFLICT DO UPDATE ... WHERE` is what makes it hold.

      The cost of that is also worth stating: this row is a serialisation point. Under real load
      every agent request queues briefly on one row lock. That is acceptable for a bucket spent once
      per identified request and it would not be acceptable on the anonymous read path, which is why
      the breaker sits inside `quotaLimit` and not inside `rateLimit`.
    */
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
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * The breaker's refusal, as a response.
 *
 * Separated from {@link tripBreaker} so the decision can be asserted without reading a `Response`,
 * and so {@link quotaLimit} has one place to return from.
 *
 * # It is a 503, not a 429, and the difference is not cosmetic
 *
 * A 429 says "you asked too often" and every well-built client answers it by slowing down and
 * carrying on — which is correct for a per-address quota and wrong here. A tripped breaker is not a
 * statement about this caller at all; it is this deployment saying it is shedding load or has been
 * switched off. 503 with `retry-after` is the code that means that, and a client that treats it as
 * its own fault will back off in the wrong place and log the wrong cause. `x-weir-breaker` names
 * which ceiling closed, because an operator reading a client's logs should not have to guess.
 */
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
      // Named so a client can tell the three apart without parsing prose, and so an operator can
      // tell a switched-off breaker from an overwhelmed one in somebody else's bug report.
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

/** Test seam for the sweep's per-instance timer. Nothing in the application calls this. */
export function resetQuotaSweep(): void {
  sweptAtMs = 0;
}
