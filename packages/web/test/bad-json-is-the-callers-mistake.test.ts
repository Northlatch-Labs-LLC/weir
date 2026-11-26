// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
//
// What a route does with a body that is not JSON, measured against the table the error alarm
// reads. lib/body-limit.ts carries the reasoning; this is the proof at a real route that a
// malformed body is answered as the caller's mistake and writes nothing to error_events.

import { afterAll, describe, expect, it } from 'vitest';
import { MAX_JSON_BODY_BYTES } from '../lib/body-limit';
import { closeDatabase, testDb, useTestDatabase } from './helpers/database';

useTestDatabase();

const { POST: prepare } = await import('../app/api/checkout/prepare/route');

const send = (body: string, headers: Record<string, string> = {}): Promise<Response> =>
  prepare(
    new Request('https://weir.social/api/checkout/prepare', {
      method: 'POST',
      headers: { 'x-real-ip': '203.0.113.7', 'content-type': 'application/json', ...headers },
      body,
    }),
  );

const failures = async (): Promise<number> =>
  Number((await testDb().query('SELECT count(*)::int AS n FROM error_events')).rows[0]?.n ?? -1);

afterAll(closeDatabase);

describe('a body that is not JSON, at a route that used to record it', () => {
  it('is answered 400, in the words the caller can act on', async () => {
    const response = await send('{"sender":');
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'the body is not JSON' });
  });

  it('writes nothing to error_events, so the alarm still means something', async () => {
    const before = await failures();
    for (const body of ['{"sender":', 'not json', '', '[1,']) await send(body);
    expect(await failures()).toBe(before);
  });

  it('is answered 413 past the limit, and records nothing either', async () => {
    const before = await failures();
    const response = await send('{"sender":"' + 'x'.repeat(MAX_JSON_BODY_BYTES) + '"}');
    expect(response.status).toBe(413);
    expect(await failures()).toBe(before);
  });

  it('still reaches the route once the body is JSON, which is the part that must not regress', async () => {
    const response = await send('{}');
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'sender, vaultId and amountMist are required' });
  });
});
