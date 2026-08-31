// @vitest-environment node
// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/**
 * The layer that an adversary cannot dilute by minting addresses.
 *
 * # What is worth asserting, and what is not
 *
 * Not "it counts". `test/quotas.test.ts` already proves the statement the breaker spends through,
 * against a real PostgreSQL, including the concurrency property that is the entire point of it —
 * and this file deliberately does NOT re-prove that. It runs the same SQL through the same
 * constant, which that suite pins to the file by grep.
 *
 * What is asserted here is the half that lives outside the database and could not be caught there:
 * how an operator's environment turns into a ceiling. Every failure mode of a kill switch is in
 * that translation. A switch that reads `0` as "unset" is a switch that does nothing on the one
 * night it is thrown; a switch that reads a typo as "unlimited" is a ceiling somebody believes they
 * set and did not; a switch whose ceiling is so high the arithmetic floors to zero divides by zero
 * inside the limiter. All three are decisions this file makes, and none of them needs a database.
 *
 * # No database, and that is a bounded claim
 *
 * `tripBreaker` reaching Postgres is exercised by the routes that call `quotaLimit`, and its
 * refusal-on-unreachable path is the same `catch` that `spendQuota` already carries. What is proven
 * here is that the kill switch NEVER reaches the database at all — which is not an optimisation, it
 * is the property that makes the switch usable when the database is what is on fire.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  BREAKER_DEFAULTS,
  BREAKER_ENV,
  BREAKER_WINDOW_MS,
  QUOTAS,
  breakerSetting,
  tripBreaker,
  type QuotaName,
} from '../lib/rate-limit';

const BUCKETS = Object.keys(QUOTAS) as QuotaName[];

describe('the ceiling an operator sets', () => {
  it('has a variable, a window and a default for every bucket a route can spend from', () => {
    /*
      A bucket with no breaker is a hole shaped exactly like the bucket. These three are declared as
      `satisfies Record<QuotaName, …>` so `tsc` catches a new bucket — this asserts the same thing
      at runtime for the case where somebody widens the type instead of the table.
    */
    for (const bucket of BUCKETS) {
      expect(BREAKER_ENV[bucket]).toMatch(/^PROJECTX_SOCIAL_BREAKER_/);
      expect(BREAKER_WINDOW_MS[bucket]).toBeGreaterThan(0);
      expect(BREAKER_DEFAULTS[bucket]).toBeGreaterThan(0);
    }
  });

  it('falls back to the default when nothing is set, never to unlimited', () => {
    // A breaker that is off until somebody remembers to turn it on was not there on the night it
    // was needed. Unset is a number, and it is a number chosen well above honest load.
    for (const bucket of BUCKETS) {
      const setting = breakerSetting(bucket, {});
      expect(setting.state).toBe('open');
      if (setting.state !== 'open') continue;
      expect(setting.ceiling).toBe(BREAKER_DEFAULTS[bucket]);
      expect(setting.windowMs).toBe(BREAKER_WINDOW_MS[bucket]);
    }
  });

  it('treats an empty string as unset rather than as zero', () => {
    /*
      The distinction that decides whether a misconfigured deployment serves traffic or serves
      nothing. A platform that renders an unset variable as `""` — several do — would otherwise
      trip every breaker on the deployment the first time somebody added an empty row to a
      dashboard, and the outage would look like an attack.
    */
    const setting = breakerSetting('read', { [BREAKER_ENV.read]: '   ' });
    expect(setting.state).toBe('open');
  });

  it('reads zero as the kill switch, for each bucket independently', () => {
    for (const bucket of BUCKETS) {
      const setting = breakerSetting(bucket, { [BREAKER_ENV[bucket]]: '0' });
      expect(setting.state).toBe('closed');
      if (setting.state !== 'closed') continue;
      expect(setting.reason).toContain(BREAKER_ENV[bucket]);
    }

    // Independently: stopping a runaway buy loop must not take the read surface down with it.
    expect(breakerSetting('read', { [BREAKER_ENV.purchase]: '0' }).state).toBe('open');
  });

  it('closes rather than defaults when the value cannot be read', () => {
    /*
      The direction is the argument. A typo that falls back to the default leaves an operator
      believing they set a ceiling; they discover otherwise at the worst possible moment. A typo
      that closes announces itself within one request. `lib/rate-limit.ts` already made this case
      about `x-forwarded-for`: a limit that can be shrugged off is indistinguishable from a working
      one until somebody tries.
    */
    for (const bad of ['O', 'ten', '-1', '1_000', '12.5', 'unlimited']) {
      const setting = breakerSetting('write', { [BREAKER_ENV.write]: bad });
      expect([bad, setting.state]).toEqual([bad, 'closed']);
    }
  });

  it('converts a ceiling into a refill rate that spends the whole window', () => {
    const setting = breakerSetting('purchase', { [BREAKER_ENV.purchase]: '60' });
    expect(setting.state).toBe('open');
    if (setting.state !== 'open') return;
    // 60 an hour is one a minute. capacity × msPerToken is the window, which is what keeps the
    // sweep in `spendQuota` from ever reclaiming a row that is not provably full.
    expect(setting.msPerToken).toBe(60_000);
    expect(setting.ceiling * setting.msPerToken).toBe(BREAKER_WINDOW_MS.purchase);
  });

  it('never produces a refill of zero milliseconds, however large the ceiling', () => {
    /*
      `msPerToken` is integer milliseconds and reaches the SQL as a divisor. A ceiling above one
      token per millisecond floors to zero, and a division by zero inside the limiter takes down
      every route that has one — the limiter becoming the outage.
    */
    const setting = breakerSetting('read', { [BREAKER_ENV.read]: '999999999' });
    expect(setting.state).toBe('open');
    if (setting.state !== 'open') return;
    expect(setting.msPerToken).toBeGreaterThanOrEqual(1);
    // Clamped DOWN, not up. If somebody asks for more than the arithmetic can express, they get
    // less than they asked for rather than more.
    expect(setting.ceiling).toBe(BREAKER_WINDOW_MS.read);
  });
});

describe('the switch itself', () => {
  it('refuses without touching the database when it is closed', async () => {
    /*
      The property that makes the kill switch worth having. `db()` is never called, so a deployment
      whose Postgres is unreachable — which is a very common reason to want the switch — can still
      be switched off. If this ever reached the pool it would throw here rather than returning a
      verdict, because no test database is configured in this environment.
    */
    const outcome = await tripBreaker('write', { env: { [BREAKER_ENV.write]: '0' } });
    expect(outcome).toEqual({
      tripped: true,
      kind: 'closed',
      reason: expect.stringContaining(BREAKER_ENV.write),
    });
  });

  it('refuses a single request larger than the whole ceiling, and does not throw about it', async () => {
    /*
      `spendQuota` throws for a cost above capacity, correctly: there both numbers are constants in
      the same file and a mismatch is a bug. Here the ceiling is whatever an operator typed a minute
      ago, so a cost that no longer fits is a state the world can be in — and a 500 would be this
      deployment reporting an operator's setting as its own crash.
    */
    const outcome = await tripBreaker('purchase', {
      cost: 5,
      env: { [BREAKER_ENV.purchase]: '2' },
    });
    expect(outcome.tripped).toBe(true);
    if (!outcome.tripped || outcome.kind !== 'over-ceiling') throw new Error('expected a ceiling');
    expect(outcome.ceiling).toBe(2);
    expect(outcome.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it('rejects a cost that is not a whole number of requests, loudly', async () => {
    // Not a client-visible refusal: a fractional or negative cost is a mistake in this codebase,
    // and swallowing it would spend an unpredictable number of tokens for every request forever.
    await expect(tripBreaker('read', { cost: 0 })).rejects.toThrow(/whole number/);
    await expect(tripBreaker('read', { cost: 1.5 })).rejects.toThrow(/whole number/);
  });
});

describe('what the layers are for', () => {
  it('is documented against every layer, including the two that are not code', () => {
    /*
      The Cloudflare rules and the on-chain controls cannot be asserted by any test in this
      repository — that is exactly why they are written into the source. What CAN be asserted is
      that the writing is still there: a layer that lives only in somebody's dashboard is a layer
      lost the first time an account changes hands, and this is the guard against the doc block
      being trimmed by somebody who did not know that.
    */
    const source = readSource();
    for (const marker of [
      'Layer 1 — edge, volumetric, per-IP and per-ASN',
      'Layer 2 — identity',
      'Layer 3 — the global circuit breaker',
      'Layer 4 — economic',
      'The rules to create in Cloudflare',
      'ip.geoip.asnum',
      'payments_paused',
      'PROJECTX_SOCIAL_BEHIND_CLOUDFLARE',
    ]) {
      expect([marker, source.includes(marker)]).toEqual([marker, true]);
    }
  });

  it('no longer claims the per-address bucket is the ceiling', () => {
    /*
      The sentence this corrects said `quotaLimit` "is the ceiling that actually holds, and it is
      the one that bounds an agent". True about one caller, read as a claim about the load, and
      wrong by however many addresses somebody is willing to fund. The honest limitation paragraph
      it sat beside is extended rather than replaced — asserted here so a later edit cannot quietly
      delete the correction and restore the claim.
    */
    const source = readSource();
    expect(source).not.toContain('This is the ceiling that actually holds');
    expect(source).toContain('It is not the ceiling on agent traffic');
    expect(source).toContain('A per-key limiter\n * bounds one runaway caller. It does not bound an adversary');
    // The original limitation, still present. It was correct; it was only incomplete.
    expect(source).toContain('Serverless multiplies instances, and each instance counts on its own');
  });
});

/** The module's own text. Two assertions above are about what the file SAYS, not what it does. */
function readSource(): string {
  return readFileSync(new URL('../lib/rate-limit.ts', import.meta.url), 'utf8');
}
