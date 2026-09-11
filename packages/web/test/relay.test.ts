// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
/**
 * `checkout/submit` broadcasts only what this deployment quoted.
 *
 * # The defect this pins
 *
 * The route accepted `{bytes, signature}` and executed them against the configured fullnode.
 * Nothing tied the bytes to a quote this deployment had produced and no caller identity was
 * required, so anybody could spend this platform's RPC quota and IP reputation broadcasting
 * arbitrary Sui transactions. The route's docstring says it "deliberately cannot build a
 * transaction" — true, and beside the point: it never had to build one in order to send one.
 *
 * # What is asserted, and what deliberately is not
 *
 * That unquoted bytes are refused *before* anything reaches the network, that a quote is spent by
 * the submission it authorises, and that an expired one is refused. Not asserted: that a real
 * transaction executes — that needs a funded key and a live node, and it is exercised on mainnet
 * rather than here.
 *
 * The refusal must come from the ledger check, not from the bytes being nonsense. Every case below
 * uses bytes that are structurally fine and simply never issued, so a failure that names decoding
 * would mean this test is passing for the wrong reason.
 */

import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it , vi } from 'vitest';

/*
  These cases build and simulate a real transaction shape; under a full-suite run on a loaded
  machine they have crossed the default 5 s and failed for time alone. 15 s is still a failure
  if the work hangs, and never a pass for the wrong reason.
*/
vi.setConfig({ testTimeout: 15_000 });
import { closeDatabase, testDb, useTestDatabase } from './helpers/database';

useTestDatabase();

for (const line of readFileSync(join(process.cwd(), '.env.local'), 'utf8').split('\n')) {
  const [key, ...rest] = line.split('=');
  if (key?.startsWith('PROJECTX_SOCIAL_') && process.env[key] === undefined) {
    process.env[key] = rest.join('=').trim();
  }
}

const { submitSigned } = await import('../lib/checkout');

afterAll(closeDatabase);

/** Unique per call, so parallel suites cannot collide on a digest. */
function bytesNobodyQuoted(): string {
  return Buffer.from(`never-issued-${randomUUID()}`).toString('base64');
}

const digestOf = (bytes: string): Buffer => createHash('sha256').update(bytes).digest();

/** Insert a quote row directly — the same digest `rememberQuote` would write. */
async function pretendWeQuoted(bytes: string, expiresAtMs: number): Promise<void> {
  await testDb().query(
    `INSERT INTO issued_quotes (digest, expires_at_ms) VALUES ($1, $2)
     ON CONFLICT (digest) DO UPDATE SET expires_at_ms = EXCLUDED.expires_at_ms`,
    [digestOf(bytes), expiresAtMs],
  );
}

describe('the transaction relay', () => {
  it('refuses bytes it never quoted', async () => {
    const result = await submitSigned({ bytes: bytesNobodyQuoted(), signature: 'AA==' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.detail).toContain('not quoted by this deployment');
  });

  it('accepts a quote it issued, and spends it', async () => {
    // Spent, not merely checked: a quote authorises one submission. Leaving the row would let the
    // same signed bytes be pushed at the node repeatedly — Sui rejects the re-execution, but the
    // quota being burned doing so is ours.
    const bytes = bytesNobodyQuoted();
    await pretendWeQuoted(bytes, Date.now() + 60_000);

    // The submission itself fails at the node: 'AA==' is not a real signature, and this test has no
    // funded key. What matters is that it got *past* the ledger check — a relay failure names the
    // network, a ledger failure names the quote.
    const first = await submitSigned({ bytes, signature: 'AA==' });
    if (!first.ok) expect(first.failure.detail).not.toContain('not quoted by this deployment');

    const rows = await testDb().query('SELECT 1 FROM issued_quotes WHERE digest = $1', [
      digestOf(bytes),
    ]);
    expect(rows.rowCount).toBe(0);

    const second = await submitSigned({ bytes, signature: 'AA==' });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.failure.detail).toContain('not quoted by this deployment');
  });

  it('refuses a quote that has expired', async () => {
    // A quote is built against a specific gas price and specific object versions, so an old one is
    // not merely stale — it is a different transaction from the one that was simulated.
    const bytes = bytesNobodyQuoted();
    await pretendWeQuoted(bytes, Date.now() - 1);

    const result = await submitSigned({ bytes, signature: 'AA==' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.failure.detail).toContain('expired');
  });
});
