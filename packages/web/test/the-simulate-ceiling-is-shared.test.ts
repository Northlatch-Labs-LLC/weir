// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, testDb, useTestDatabase } from './helpers/database';

useTestDatabase();

const { simulateLimit, spendShared, QUOTAS, clientKey } = await import('../lib/rate-limit');

const RUN = process.hrtime.bigint().toString(36);
let caller = 0;
function request(): Request {
  return new Request('https://weir.social/api/checkout/tip', {
    method: 'POST',
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

    expect(rows).toHaveLength(1);
    expect(Number(rows[0].tokens)).toBeLessThan(QUOTAS.simulate.capacity);
  });

  it('REFUSES a caller whose budget was spent by another instance', async () => {
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
