// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
//
// A sweep that fails after the signature was recorded is not a rejection.
//
// `verifyAction` spends a signature by inserting its digest, then sweeps expired digests. Both
// statements used to sit inside one `try`, so a sweep that failed AFTER a successful insert
// returned "could not record this signature, so it was not accepted" — a sentence that was false
// precisely when it mattered. The digest WAS recorded, `rowCount` was 1, the signature was spent,
// and the caller was told to sign again.
//
// `rememberQuote` in `lib/checkout.ts` had already reached the opposite conclusion in its own
// words — "a failed sweep is housekeeping that did not happen" — and swallows. The two paths
// disagreed and the security-critical one had it wrong.
//
// Found by an adversarial reviewer with no knowledge of how either was written.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const query = vi.fn();

vi.mock('@/lib/db', () => ({
  db: () => ({ query: (...a: unknown[]) => query(...a) }),
  normaliseAddress: (a: string) => a.toLowerCase(),
}));

/** The signature itself is not under test here; only what happens after it is proved genuine. */
vi.mock('@mysten/sui/verify', () => ({
  verifyPersonalMessageSignature: vi.fn(async () => undefined),
}));

vi.mock('@/lib/chain', () => ({
  siteConfig: () => ({ ok: true, value: { network: 'mainnet', origin: 'https://weir.social' } }),
  createClient: () => ({}),
}));

const ADDRESS = `0x${'1'.repeat(64)}`;

/** An insert that claims the digest, then a sweep that fails. */
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

    // The claim this test carries: the insert succeeded, so the answer is yes. Before this change
    // the caller was told the signature "was not accepted" while its digest sat in the table.
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
