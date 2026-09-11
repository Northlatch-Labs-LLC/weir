// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
/**
 * The ceiling on transaction-building holds across instances, not within one.
 *
 * # The defect this pins
 *
 * Twenty-four routes each build a transaction and call a fullnode WE PAY FOR, and every one of them
 * was bounded only by `rateLimit` — a module-level `Map`. Its own header is honest about what that
 * means: "Serverless multiplies instances, and each instance counts on its own."
 *
 * So the ceiling was twenty a minute times however many instances happened to be warm, and traffic
 * is what makes them warm. The limit rose exactly as it was being tested, and the number a caller
 * actually met was one nobody chose and nobody could read off the code.
 *
 * These doors take no proof of identity and cannot: a visitor pricing a tip before they have an
 * account is who this platform is for, and demanding a signature to be quoted a price shuts the
 * door on that person. Volume is the only thing there is to bound.
 *
 * # Why one instance cannot prove this
 *
 * A test that calls the guard repeatedly in one process passes on the broken code and the fixed
 * code alike — the `Map` refuses either way, and the assertion never learns whether anything
 * durable happened. The same trap as a sequential pair against the idempotency ledger.
 *
 * So a SECOND caller is simulated: the bucket is spent directly, as another instance would have
 * spent it, and then the guard is asked. A `Map` in this process cannot know about that spending.
 * Only the row in Postgres can.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, testDb, useTestDatabase } from './helpers/database';

useTestDatabase();

const { simulateLimit, spendShared, QUOTAS, clientKey } = await import('../lib/rate-limit');

/*
  A distinct caller per test AND per run.

  The test database persists between runs, and `agent_quotas` is keyed on the caller — so a key
  that repeats across runs finds the row the last run left. The first version of this file numbered
  callers from zero every time, and "writes its count where every instance can see it" then PASSED
  UNDER MUTATION: the row it found had been written by the previous, unmutated run. A test that can
  be satisfied by its own history is not measuring the code.

  The run id makes every bucket new. `clientKey` returns the header trimmed and does not require an
  IP, so this is a legal key.
*/
const RUN = process.hrtime.bigint().toString(36);
let caller = 0;
function request(): Request {
  return new Request('https://weir.social/api/checkout/tip', {
    method: 'POST',
    // `x-real-ip` is what `clientKey` reads when the deployment is not behind Cloudflare.
    // `x-forwarded-for` is ignored, and every caller would collapse into one bucket named
    // 'unattributed' — which passes the refusal assertions and quietly destroys the converse one.
    headers: { 'x-real-ip': `probe-${RUN}-${caller}` },
  });
}

beforeEach(() => {
  caller += 1;
});

afterAll(closeDatabase);

describe('the ceiling', () => {
  it('lets an ordinary caller through', async () => {
    expect(await simulateLimit(request())).toBeNull();
  });

  it('writes its count where every instance can see it', async () => {
    const r = request();
    await simulateLimit(r);

    const { rows } = await testDb().query(
      'SELECT tokens FROM agent_quotas WHERE address = $1 AND bucket = $2',
      [`ip:${clientKey(r)}`, 'simulate'],
    );

    // The row IS the mechanism. Without it the ceiling lives in a Map that dies with the instance.
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].tokens)).toBeLessThan(QUOTAS.simulate.capacity);
  });

  it('REFUSES a caller whose budget was spent by another instance', async () => {
    /*
      The assertion that could not pass before the fix, and the only one here that a single-instance
      test could not fake.

      The bucket is emptied by `spendShared` directly — standing in for a different serverless
      instance, whose `Map` this process has never seen and never will. Then the guard is asked, in
      a process whose own `Map` is empty. It has no local reason to refuse.
    */
    const r = request();
    const key = clientKey(r);
    for (let i = 0; i < QUOTAS.simulate.capacity; i += 1) {
      await spendShared(key, 'simulate');
    }

    const refused = await simulateLimit(r);

    expect(refused).not.toBeNull();
    expect(refused?.status).toBe(429);
  });

  it('says how long to wait, rather than inviting an immediate retry', async () => {
    const r = request();
    const key = clientKey(r);
    for (let i = 0; i < QUOTAS.simulate.capacity; i += 1) {
      await spendShared(key, 'simulate');
    }

    const refused = await simulateLimit(r);
    const body = (await refused!.json()) as { retryAfterSeconds: number };

    expect(body.retryAfterSeconds).toBeGreaterThan(0);
    expect(refused!.headers.get('retry-after')).toBe(String(body.retryAfterSeconds));
  });

  it('does not refuse a DIFFERENT caller because of that one', async () => {
    // The converse. A ceiling that refused everybody once anybody exhausted theirs would pass the
    // assertion above while being an outage.
    const spent = request();
    const key = clientKey(spent);
    for (let i = 0; i < QUOTAS.simulate.capacity; i += 1) {
      await spendShared(key, 'simulate');
    }
    expect(await simulateLimit(spent)).not.toBeNull();

    caller += 1;
    expect(await simulateLimit(request())).toBeNull();
  });
});
