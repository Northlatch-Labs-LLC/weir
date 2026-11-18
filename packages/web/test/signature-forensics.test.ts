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
});
