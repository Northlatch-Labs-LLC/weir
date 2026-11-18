// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { beforeEach, describe, expect, it, vi } from 'vitest';

const query = vi.fn();

vi.mock('@/lib/db', () => ({
  db: () => ({ query: (...a: unknown[]) => query(...a) }),
  normaliseAddress: (a: string) => a.toLowerCase(),
}));

vi.mock('@mysten/sui/verify', () => ({
  verifyPersonalMessageSignature: vi.fn(async () => undefined),
}));

vi.mock('@/lib/chain', () => ({
  siteConfig: () => ({ ok: true, value: { network: 'mainnet', origin: 'https://weir.social' } }),
  createClient: () => ({}),
}));

const ADDRESS = `0x${'1'.repeat(64)}`;

/*
  Call order inside verifyAction since the forensics ledger landed (045):
    1. the replay insert into used_signatures  — must succeed for acceptance
    2. the forensics insert into signature_spends — fail-closed: a spend nobody recorded
       is a spend a dispute cannot resolve, so a failure here refuses the write
    3. the sweep's DELETE of expired rows — fire-and-forget: its failure must never
       reach the caller, which is what this file was written to pin.
*/

function calls(...outcomes: Array<'ok' | 'reject'>): void {
  query.mockReset();
  for (const outcome of outcomes) {
    if (outcome === 'ok') query.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    else query.mockRejectedValueOnce(new Error('connection terminated'));
  }
}

async function verify() {
  const { verifyAction } = await import('@/lib/identity');
  return verifyAction({
    address: ADDRESS,
    signature: 'AAAA',
    timestampMs: Date.now(),
    origin: 'https://weir.social',
    action: { kind: 'read', other: ADDRESS },
  });
}

beforeEach(() => {
  vi.resetModules();
  query.mockReset();
  query.mockResolvedValue({ rows: [], rowCount: 1 });
});

describe('a signature that was recorded stays accepted', () => {
  it('does not reject the caller when only the sweep fails', async () => {
    calls('ok', 'ok', 'reject');

    const result = await verify();

    expect(result.ok).toBe(true);
  });

  it('refuses when the forensics ledger insert fails, because a spend nobody recorded is a dispute nobody can resolve', async () => {
    calls('ok', 'reject');

    const result = await verify();

    expect(result.ok).toBe(false);
  });

  it('still refuses when the replay insert itself fails, which is the half that must not change', async () => {
    calls('reject');

    const result = await verify();

    expect(result.ok).toBe(false);
  });

  it('still refuses a digest that was already spent', async () => {
    query.mockReset();
    query.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const result = await verify();

    expect(result.ok).toBe(false);
  });
});
