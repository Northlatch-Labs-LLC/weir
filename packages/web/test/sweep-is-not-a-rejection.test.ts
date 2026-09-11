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

function insertSucceedsThenSweepFails() {
  query.mockReset();
  query
    .mockResolvedValueOnce({ rows: [], rowCount: 1 })
    .mockRejectedValueOnce(new Error('connection terminated during the sweep'));
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
    insertSucceedsThenSweepFails();

    const result = await verify();

    expect(result.ok).toBe(true);
  });

  it('still refuses when the insert itself fails, which is the half that must not change', async () => {
    query.mockReset();
    query.mockRejectedValueOnce(new Error('connection terminated during the insert'));

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
