// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Claude
/**
 * A write signature may be spent exactly once.
 *
 * # The defect this pins
 *
 * `verifyAction` proved two things: that an address signed the statement, and that the statement
 * was recent. Neither is single-use. A captured request could be resubmitted for the whole
 * ten-minute window — N posts, N follows, N messages from one wallet prompt. Post and comment ids
 * come from `Date.now().toString(36)`, so only a same-millisecond collision was refused, and that
 * by a primary key rather than by anything that meant to refuse it.
 *
 * # Why this uses a real keypair and a real database
 *
 * Both halves of the guard are things a mock would assert into existence. A stubbed verifier proves
 * nothing about whether a genuine signature is accepted twice, and a stubbed store proves nothing
 * about `ON CONFLICT DO NOTHING` — which is the entire mechanism, because it is what makes the
 * claim atomic rather than a check-then-insert with a race inside it.
 *
 * So: a real Ed25519 keypair signs the statement the server rebuilds, and the claim lands in the
 * disposable test database.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { closeDatabase, testDb, useTestDatabase } from './helpers/database';

/** The deployment these bytes are bound to. Portable statements were the defect. */
const ORIGIN = 'https://weir.social';

useTestDatabase();

/*
  Chain configuration, loaded the way `useTestDatabase` loads the database URL.

  `verifyAction` calls `siteConfig()` before it verifies anything, and an unconfigured deployment
  fails closed — correctly. Without these, every assertion below would go red for a reason that has
  nothing to do with replay, which is how a test ends up pinning the wrong thing. Nothing here
  reaches the network: an Ed25519 signature verifies locally, and the client is only consulted for
  zkLogin.
*/
for (const line of readFileSync(join(process.cwd(), '.env.local'), 'utf8').split('\n')) {
  const [key, ...rest] = line.split('=');
  if (key?.startsWith('PROJECTX_SOCIAL_') && process.env[key] === undefined) {
    process.env[key] = rest.join('=').trim();
  }
}

const { statementFor, verifyAction, SIGNATURE_WINDOW_MS } = await import('../lib/identity');

const keypair = new Ed25519Keypair();
const address = keypair.getPublicKey().toSuiAddress();

/** Sign what the server will rebuild. A mismatch here would fail as a forgery, not as a replay. */
async function sign(action: Parameters<typeof statementFor>[0], timestampMs: number) {
  const message = new TextEncoder().encode(statementFor(action, address, timestampMs, ORIGIN));
  const { signature } = await keypair.signPersonalMessage(message);
  // The origin is part of the signed bytes and part of what the verifier rebuilds, so the two
  // must agree here exactly as they do in a route.
  return { address, signature, timestampMs, action, origin: ORIGIN };
}

/*
  No truncation between tests, and none of these assert on a global row count.

  Suites share one database and run in parallel, so a `beforeEach` that emptied `used_signatures`
  would delete rows another file had just spent — which is exactly how this suite passed alone and
  failed in the full run. Every signature below is freshly generated, so its digest is unique and
  cannot collide with anything another test wrote.
*/
afterAll(closeDatabase);

/** The row this exact signature would have claimed. Scoped, so a parallel suite cannot perturb it. */
const digestOf = (signature: string): Buffer => createHash('sha256').update(signature).digest();

describe('a write signature', () => {
  it('is accepted once', async () => {
    const input = await sign({ kind: 'follow', handle: 'alice', following: true }, Date.now());
    expect((await verifyAction(input)).ok).toBe(true);
  });

  it('is refused the second time, though nothing about it has changed', async () => {
    // The whole defect in three lines. Same bytes, same address, still inside the window — and the
    // only thing that may distinguish the two calls is that the first one happened.
    const input = await sign({ kind: 'follow', handle: 'alice', following: true }, Date.now());

    expect((await verifyAction(input)).ok).toBe(true);

    const second = await verifyAction(input);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.failure.detail).toContain('already been used');
  });

  it('is refused on every later attempt, not just the second', async () => {
    // A guard that only caught the immediate repeat would leave the window open to a slower caller.
    const input = await sign(
      {
        kind: 'publish',
        handle: 'alice',
        title: 't',
        access: 'public',
        contentSha256: 'abc',
        contentKey: '',
        price: '',
      },
      Date.now(),
    );

    expect((await verifyAction(input)).ok).toBe(true);
    for (const _attempt of [1, 2, 3]) expect((await verifyAction(input)).ok).toBe(false);
  });

  it('records the digest and never the signature itself', async () => {
    // The signature is the reusable secret. Storing it would put the thing this table exists to
    // stop being reused into the table itself.
    const input = await sign({ kind: 'follow', handle: 'bob', following: true }, Date.now());
    await verifyAction(input);

    const rows = await testDb().query<{ digest: Buffer; expires_at_ms: string }>(
      'SELECT digest, expires_at_ms FROM used_signatures WHERE digest = $1',
      [digestOf(input.signature)],
    );
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0]?.digest.length).toBe(32);
    expect(rows.rows[0]?.digest.toString('utf8')).not.toContain(input.signature);
    expect(Number(rows.rows[0]?.expires_at_ms)).toBe(input.timestampMs + SIGNATURE_WINDOW_MS);
  });

  it('survives two replays racing each other', async () => {
    // The reason the claim is `INSERT … ON CONFLICT DO NOTHING` rather than a SELECT then an
    // INSERT: concurrent duplicates must resolve to exactly one winner, not to whichever read
    // happened to run before the other's write.
    const input = await sign({ kind: 'follow', handle: 'carol', following: true }, Date.now());

    const results = await Promise.all([verifyAction(input), verifyAction(input)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  it('does not spend a different signature by the same address', async () => {
    // Keyed on the signature, not the signer. Otherwise one follow would lock the wallet out of
    // every other action for ten minutes.
    const now = Date.now();
    const first = await sign({ kind: 'follow', handle: 'alice', following: true }, now);
    const second = await sign({ kind: 'follow', handle: 'bob', following: true }, now);

    expect((await verifyAction(first)).ok).toBe(true);
    expect((await verifyAction(second)).ok).toBe(true);
  });
});

describe('a read signature', () => {
  it('is spent like every other kind', async () => {
    /*
      This asserted the opposite until the reasoning behind it was re-read.

      The old note said replaying a read "grants the signer exactly the access they already had —
      so the trade is a real usability cost against no gain". True of the SIGNER, false of an
      INTERCEPTOR: the same bytes in somebody else's hands return that address's inbox for the whole
      ten-minute window. The argument was reasoned from one of the two parties.

      The usability cost it weighed against was also not being paid. Every client here signs a fresh
      read on every call and caches none, so spending them costs zero additional prompts.
    */
    const input = await sign({ kind: 'read', other: address }, Date.now());

    expect((await verifyAction(input)).ok).toBe(true);

    const replayed = await verifyAction(input);
    expect(replayed.ok).toBe(false);

    const rows = await testDb().query('SELECT 1 FROM used_signatures WHERE digest = $1', [
      digestOf(input.signature),
    ]);
    expect(rows.rowCount).toBe(1);
  });
});
