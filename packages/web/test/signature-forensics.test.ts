// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
//
// The durable half of single-use. The replay ledger forgets each digest when its window
// closes — deliberately — so signature_spends is the only record that survives long
// enough for a dispute to ask it anything. These tests pin what a dispute needs: who,
// what, exactly once.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
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

const { statementFor, verifyAction } = await import('../lib/identity');

const keypair = new Ed25519Keypair();
const address = keypair.getPublicKey().toSuiAddress();

async function sign(action: Parameters<typeof statementFor>[0], timestampMs: number) {
  const message = new TextEncoder().encode(statementFor(action, address, timestampMs, ORIGIN));
  const { signature } = await keypair.signPersonalMessage(message);
  return { address, signature, timestampMs, action, origin: ORIGIN };
}

afterAll(closeDatabase);

// The ledger is never swept — that is its whole point — so this file cleans its own rows
// between tests instead of counting against whatever earlier files left behind.
beforeEach(async () => {
  await testDb().query('DELETE FROM signature_spends WHERE address = $1', [address]);
});

describe('the forensics ledger', () => {
  it('records who spent what, the moment a signature is accepted', async () => {
    const input = await sign({ kind: 'follow', handle: 'alice', following: true }, Date.now());
    expect((await verifyAction(input)).ok).toBe(true);

    const rows = await testDb().query(
      'SELECT address, action FROM signature_spends WHERE digest = $1',
      [createHash('sha256').update(input.signature).digest()],
    );
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0]).toEqual({ address, action: 'follow' });
  });

  it('does not grow when the replay is refused — refusals are not spends', async () => {
    const input = await sign({ kind: 'follow', handle: 'bob', following: true }, Date.now());
    expect((await verifyAction(input)).ok).toBe(true);
    expect((await verifyAction(input)).ok).toBe(false);

    const rows = await testDb().query(
      'SELECT count(*)::int AS n FROM signature_spends WHERE address = $1 AND action = \'follow\'',
      [address],
    );
    expect(rows.rows[0]?.n).toBe(1);
  });

  it('a different action from the same address is its own row', async () => {
    const input = await sign({ kind: 'follow', handle: 'carol', following: true }, Date.now());
    expect((await verifyAction(input)).ok).toBe(true);

    const rows = await testDb().query(
      'SELECT action FROM signature_spends WHERE address = $1 ORDER BY spent_at_ms DESC, action',
      [address],
    );
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0]).toEqual({ action: 'follow' });
  });
  /*
    Until 2026-11-26 this path handed the pool to spendSignature, and a pool runs each statement on
    its own. If the ledger row could not be written, the caller was told "not accepted" and the
    signature had been taken anyway: the replay row was already in, on its own.
  */
  it('a spend whose ledger row cannot be written is not a spend at all', async () => {
    // A constraint that refuses every new row, without touching the ones already there.
    await testDb().query('ALTER TABLE signature_spends ADD CONSTRAINT test_ledger_closed CHECK (false) NOT VALID');
    try {
      const input = await sign({ kind: 'follow', handle: 'dave', following: true }, Date.now());
      const refused = await verifyAction(input);
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused.failure.detail).toContain('not accepted');

      // Nothing in the replay table either: the whole spend was rolled back with the ledger.
      const digest = createHash('sha256').update(input.signature).digest();
      const replay = await testDb().query('SELECT 1 FROM used_signatures WHERE digest = $1', [digest]);
      expect(replay.rowCount).toBe(0);

      // So the same signature is still good, and is accepted exactly once when the ledger recovers.
      await testDb().query('ALTER TABLE signature_spends DROP CONSTRAINT test_ledger_closed');
      expect((await verifyAction(input)).ok).toBe(true);
      expect((await verifyAction(input)).ok).toBe(false);
    } finally {
      await testDb().query('ALTER TABLE signature_spends DROP CONSTRAINT IF EXISTS test_ledger_closed');
    }
  });
});
