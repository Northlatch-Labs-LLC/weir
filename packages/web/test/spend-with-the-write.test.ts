// @vitest-environment node
// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
/**
 * A signature is spent with the write it authorises, or not at all.
 *
 * # The defect this pins
 *
 * `verifyAction` claimed the digest the instant the proof succeeded. On `POST /api/posts` that
 * left four `await`s between the claim and the row — one of them a Seal upload to a third party.
 * Anything failing in that gap consumed the author's single-use signature and stored no post, and
 * the only way to discover it was to sign a second time.
 *
 * The claim now happens inside the transaction that inserts the row, so the two commit together or
 * neither does.
 *
 * # Why a real keypair and a real database
 *
 * The mechanism IS `ON CONFLICT DO NOTHING` running on a caller's client rather than on the pool.
 * A stubbed store cannot tell those two apart — it is precisely the difference between a claim
 * that a `ROLLBACK` undoes and one it does not. So the rollback below is a real one.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { closeDatabase, testDb, useTestDatabase } from './helpers/database';

const ORIGIN = 'https://weir.social';

useTestDatabase();

// Chain configuration, loaded exactly as `replay.test.ts` loads it: `verifyAction` reads
// `siteConfig()` before it verifies anything, and an unconfigured deployment fails closed.
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

/** A distinct publish action per test, so no two share a digest. */
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

/** Whether the ledger holds this exact digest. Scoped, so a parallel suite cannot perturb it. */
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
    // The whole point of the split. Proving is a read; the ledger is untouched until someone
    // writes to it, which is the caller's transaction and not this call.
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

    /*
      This is the failure the finding is about, reproduced exactly: the claim happens, and then the
      write it was paying for does not. Before the fix the claim was made on the pool, outside any
      transaction, and no rollback existed that could take it back.
    */
    const client = await testDb().connect();
    try {
      await client.query('BEGIN');
      const spent = await spendSignature(client, proof.value);
      expect(spent.ok).toBe(true);
      // Inside the transaction the row is there — the claim really did happen.
      expect((await client.query('SELECT 1 FROM used_signatures WHERE digest = $1',
        [proof.value.digest])).rowCount).toBe(1);
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }

    expect(await isSpent(input.signature)).toBe(false);

    // And the proof of it: the same bytes still work. Nothing was consumed, so nothing was lost.
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

    // Committing is what makes it single-use. A guard that only held inside the transaction would
    // be no guard at all once the connection went back to the pool.
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

    // Both proofs succeed — verification has no side effect, so it cannot be the thing that
    // separates them. The ledger is.
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
