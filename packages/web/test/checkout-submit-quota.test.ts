// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/*
  The purchase quota binds at the one step that is a purchase.

  `QUOTAS.purchase` — "the reason this table exists" — had one caller, and it was the card onramp.
  No checkout route spent a purchase token, so the documented ceiling bounded nothing. This proves
  `POST /api/checkout/submit` spends `purchase` for a signed creator::unlock/subscribe/tip/renew,
  `write` for any other signed submission, keyed on the address the SIGNATURE proves, and refuses
  before any bucket is touched when the signature does not verify.

  Mutations predicted: classify every submission as `write` → "unlock spends purchase" red; skip
  the local verification → "a forged signature spends nothing" red (a bucket call appears).
*/
import { describe, expect, it, vi } from 'vitest';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';

const spent: Array<{ address: string; name: string }> = [];
let refuseQuota = false;
vi.mock('@/lib/rate-limit', () => ({
  simulateLimit: async () => null,
  quotaLimit: async (address: string, name: string) => {
    spent.push({ address, name });
    return refuseQuota ? Response.json({ error: 'too many purchase requests', bucket: name }, { status: 429 }) : null;
  },
}));
vi.mock('@/lib/checkout', () => ({
  submitSigned: async () => ({ ok: true, value: 'DIGEST', observedAtMs: 0 }),
}));

const { POST } = await import('../app/api/checkout/submit/route');

const PKG = `0x${'e5'.repeat(32)}`;
const keypair = new Ed25519Keypair();
const address = keypair.getPublicKey().toSuiAddress();

/** Bytes for one MoveCall, with every gas field pinned so no node is needed to build them. */
async function signed(target: string, by = keypair): Promise<{ bytes: string; signature: string }> {
  const tx = new Transaction();
  tx.setSender(by.getPublicKey().toSuiAddress());
  tx.setGasPrice(1000n);
  tx.setGasBudget(10_000_000n);
  tx.setGasPayment([{ objectId: `0x${'11'.repeat(32)}`, version: '1', digest: '1'.repeat(32) }]);
  tx.moveCall({ target, arguments: [] });
  const built = await tx.build();
  const { bytes, signature } = await by.signTransaction(built);
  return { bytes, signature };
}

const submit = (body: unknown): Promise<Response> =>
  POST(new Request('https://weir.social/api/checkout/submit', { method: 'POST', body: JSON.stringify(body) }));

describe('POST /api/checkout/submit and the purchase quota', () => {
  it('a signed creator::unlock spends the purchase bucket of the signer', async () => {
    spent.length = 0;
    const r = await submit(await signed(`${PKG}::creator::unlock`));
    expect(r.status, await r.clone().text()).toBe(200);
    expect(spent).toEqual([{ address, name: 'purchase' }]);
  });

  for (const fn of ['subscribe', 'tip', 'renew']) {
    it(`a signed creator::${fn} spends purchase too`, async () => {
      spent.length = 0;
      await submit(await signed(`${PKG}::creator::${fn}`));
      expect(spent.map((s) => s.name)).toEqual(['purchase']);
    });
  }

  it('a signed call that is not a purchase spends write', async () => {
    spent.length = 0;
    const r = await submit(await signed(`${PKG}::creator::add_tier`));
    expect(r.status).toBe(200);
    expect(spent).toEqual([{ address, name: 'write' }]);
  });

  it('a forged signature spends nothing and is refused before the node sees it', async () => {
    spent.length = 0;
    const honest = await signed(`${PKG}::creator::unlock`);
    const other = await signed(`${PKG}::creator::unlock`, new Ed25519Keypair());
    const r = await submit({ bytes: honest.bytes, signature: other.signature });
    expect(r.status).toBe(401);
    expect(spent).toEqual([]);
  });

  it('a quota refusal is returned as-is and nothing is submitted', async () => {
    spent.length = 0;
    refuseQuota = true;
    try {
      const r = await submit(await signed(`${PKG}::creator::unlock`));
      expect(r.status).toBe(429);
      expect(((await r.json()) as { bucket: string }).bucket).toBe('purchase');
    } finally {
      refuseQuota = false;
    }
  });
});
