// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
//
// What joining the waiting list tells a stranger, measured at the route.
//
// An external scan of weir.social (2026-11-25) posted an address that was already on the list and
// was answered with that entry's position, referral code and referral count; with the code it
// then added signups that were attributed to somebody else. And it filled the list with thirty
// throwaway addresses in as many requests, because the only limit was per serverless instance.
//
// A person who joins is told their standing once. A person who is told they are already on the
// list is told exactly that.

import { afterAll, describe, expect, it } from 'vitest';
import { resetRateLimits } from '../lib/rate-limit';
import { closeDatabase, testDb, useTestDatabase } from './helpers/database';

useTestDatabase();

const { POST: join } = await import('../app/api/waitlist/route');
const { QUOTAS } = await import('../lib/rate-limit');

afterAll(closeDatabase);

const ORIGIN = 'https://weir.social';

let n = 0;
const address = (): string => `member${Date.now().toString(36)}${(n += 1)}@example.com`;
const freshIp = (): string => `2001:db8:${Date.now().toString(36)}::${(n += 1)}`;

const post = (body: Record<string, unknown>, ip = freshIp()): Promise<Response> =>
  join(
    new Request(`${ORIGIN}/api/waitlist`, {
      method: 'POST',
      headers: { 'x-real-ip': ip, 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'waitlist', role: 'creator', ...body }),
    }),
  );

describe('POST /api/waitlist, for an address that is already on the list', () => {
  it('is told it is on the list, and nothing else about the entry', async () => {
    const email = address();
    const first = await post({ email });
    expect(first.status).toBe(201);
    const told = (await first.json()) as { already: boolean; standing: { refCode: string; position: number } };
    expect(told.already).toBe(false);
    expect(told.standing.refCode).toMatch(/^[A-Z0-9]+$/);

    const again = await post({ email });
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ ok: true, already: true });
  });

  it('cannot be read by typing the address in a different case or with spaces around it', async () => {
    const email = address();
    await post({ email });
    for (const spelling of [email.toUpperCase(), `  ${email}  `]) {
      const answer = await post({ email: spelling });
      expect(answer.status).toBe(409);
      expect(await answer.json()).toEqual({ ok: true, already: true });
    }
  });

  it('is still refused a handle somebody else asked for', async () => {
    const handle = `taken${Date.now().toString(36)}`;
    expect((await post({ email: address(), handle })).status).toBe(201);
    const second = await post({ email: address(), handle });
    expect(second.status).toBe(422);
  });
});

describe('how fast one address can fill the list', () => {
  it('is bounded in a budget that holds across instances', async () => {
    resetRateLimits();
    await testDb().query('TRUNCATE waitlist_signups');
    const ip = freshIp();
    for (let i = 0; i < QUOTAS.waitlist.capacity; i += 1) {
      const made = await post({ email: address() }, ip);
      expect(made.status, `signup ${i + 1}`).toBe(201);
    }
    const rows = async (): Promise<number> =>
      Number((await testDb().query('SELECT count(*)::int AS n FROM waitlist_signups')).rows[0]?.n ?? -1);
    expect(await rows()).toBe(QUOTAS.waitlist.capacity);

    const over = await post({ email: address() }, ip);
    expect(over.status).toBe(429);
    expect(over.headers.get('retry-after')).not.toBeNull();
    expect(await rows()).toBe(QUOTAS.waitlist.capacity);
  });
});
