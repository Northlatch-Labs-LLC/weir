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

const { statementFor, verifyAction, verifyActionDeferringSpend, spendSignature } = await import(
  '../lib/identity'
);

const keypair = new Ed25519Keypair();
const address = keypair.getPublicKey().toSuiAddress();

async function sign(action: Parameters<typeof statementFor>[0], timestampMs: number) {
  const message = new TextEncoder().encode(statementFor(action, address, timestampMs, ORIGIN));
  const { signature } = await keypair.signPersonalMessage(message);
  return { address, signature, timestampMs, action, origin: ORIGIN };
}

const publish = (title: string) =>
  ({
    kind: 'publish' as const,
    handle: 'alice',
    title,
    access: 'public',
    contentSha256: 'abc',
    contentKey: '',
    price: '',
  });

const digestOf = (signature: string): Buffer => createHash('sha256').update(signature).digest();

async function isSpent(signature: string): Promise<boolean> {
  const rows = await testDb().query('SELECT 1 FROM used_signatures WHERE digest = $1', [
    digestOf(signature),
  ]);
  return rows.rowCount === 1;
}

afterAll(closeDatabase);

describe('proving a signature', () => {
  it('does not spend it', async () => {
    const input = await sign(publish('proof spends nothing'), Date.now());

    const proof = await verifyActionDeferringSpend(input);

    expect(proof.ok).toBe(true);
    expect(await isSpent(input.signature)).toBe(false);
  });

  it('returns the digest the caller will claim, not a promise that it was claimed', async () => {
    const input = await sign(publish('proof carries the digest'), Date.now());

    const proof = await verifyActionDeferringSpend(input);

    expect(proof.ok).toBe(true);
    if (proof.ok) {
      expect(proof.value).not.toBeNull();
      expect(proof.value?.digest).toEqual(digestOf(input.signature));
    }
  });
});

describe('a write that fails after the signature was proved', () => {
  it('leaves the signature unspent, so the author does not sign again', async () => {
    const input = await sign(publish('the rollback case'), Date.now());
    const proof = await verifyActionDeferringSpend(input);
    expect(proof.ok).toBe(true);
    if (!proof.ok || proof.value === null) throw new Error('unreachable: proof did not hold');

    const client = await testDb().connect();
    try {
      await client.query('BEGIN');
      const spent = await spendSignature(client, proof.value);
      expect(spent.ok).toBe(true);
      expect((await client.query('SELECT 1 FROM used_signatures WHERE digest = $1',
        [proof.value.digest])).rowCount).toBe(1);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }

    expect(await isSpent(input.signature)).toBe(false);

    expect((await verifyAction(input)).ok).toBe(true);
  });
});

describe('a write that succeeds', () => {
  it('spends the signature, and the replay is refused afterwards', async () => {
    const input = await sign(publish('the commit case'), Date.now());
    const proof = await verifyActionDeferringSpend(input);
    if (!proof.ok || proof.value === null) throw new Error('unreachable: proof did not hold');

    const client = await testDb().connect();
    try {
      await client.query('BEGIN');
      expect((await spendSignature(client, proof.value)).ok).toBe(true);
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    expect(await isSpent(input.signature)).toBe(true);

    const replay = await verifyAction(input);
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.failure.detail).toContain('already been used');
  });

  it('refuses a concurrent replay before a second row is built', async () => {
    const input = await sign(publish('the race case'), Date.now());
    const first = await verifyActionDeferringSpend(input);
    const second = await verifyActionDeferringSpend(input);
    if (!first.ok || first.value === null) throw new Error('unreachable');
    if (!second.ok || second.value === null) throw new Error('unreachable');

    const client = await testDb().connect();
    try {
      await client.query('BEGIN');
      expect((await spendSignature(client, first.value)).ok).toBe(true);
      await client.query('COMMIT');
    } finally {
      client.release();
    }

    const loser = await spendSignature(testDb(), second.value);
    expect(loser.ok).toBe(false);
    if (!loser.ok) expect(loser.failure.detail).toContain('already been used');
  });
});
