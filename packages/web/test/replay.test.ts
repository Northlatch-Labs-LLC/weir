// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { closeDatabase, testDb, useTestDatabase } from './helpers/database';

const ORIGIN = 'https://weir.social';

useTestDatabase();

for (const line of readFileSync(join(process.cwd(), '.env.local'), 'utf8').split('\n')) {
  const [key, ...rest] = line.split('=');
  if (key?.startsWith('PROJECTX_SOCIAL_') && process.env[key] === undefined) {
    process.env[key] = rest.join('=').trim();
  }
}

const { statementFor, verifyAction, SIGNATURE_WINDOW_MS } = await import('../lib/identity');

const keypair = new Ed25519Keypair();
const address = keypair.getPublicKey().toSuiAddress();

async function sign(action: Parameters<typeof statementFor>[0], timestampMs: number) {
  const message = new TextEncoder().encode(statementFor(action, address, timestampMs, ORIGIN));
  const { signature } = await keypair.signPersonalMessage(message);
  return { address, signature, timestampMs, action, origin: ORIGIN };
}

afterAll(closeDatabase);

const digestOf = (signature: string): Buffer => createHash('sha256').update(signature).digest();

describe('a write signature', () => {
  it('is accepted once', async () => {
    const input = await sign({ kind: 'follow', handle: 'alice', following: true }, Date.now());
    expect((await verifyAction(input)).ok).toBe(true);
  });

  it('is refused the second time, though nothing about it has changed', async () => {
    const input = await sign({ kind: 'follow', handle: 'alice', following: true }, Date.now());

    expect((await verifyAction(input)).ok).toBe(true);

    const second = await verifyAction(input);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.failure.detail).toContain('already been used');
  });

  it('is refused on every later attempt, not just the second', async () => {
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
    const input = await sign({ kind: 'follow', handle: 'carol', following: true }, Date.now());

    const results = await Promise.all([verifyAction(input), verifyAction(input)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  it('does not spend a different signature by the same address', async () => {
    const now = Date.now();
    const first = await sign({ kind: 'follow', handle: 'alice', following: true }, now);
    const second = await sign({ kind: 'follow', handle: 'bob', following: true }, now);

    expect((await verifyAction(first)).ok).toBe(true);
    expect((await verifyAction(second)).ok).toBe(true);
  });
});

describe('a read signature', () => {
  it('is spent like every other kind', async () => {
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
