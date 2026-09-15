// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { afterEach, describe, expect, it, vi } from 'vitest';

const prepareUnlock = vi.fn();
const prepareTip = vi.fn();
const findProfileByVault = vi.fn();

vi.mock('@/lib/rate-limit', () => ({
  simulateLimit: async () => null, rateLimit: () => null, clientKey: () => 'x' }));
vi.mock('@/lib/checkout', () => ({
  prepareUnlock: (...a: unknown[]) => prepareUnlock(...a),
  prepareTip: (...a: unknown[]) => prepareTip(...a),
}));
vi.mock('@/lib/content', () => ({
  findProfileByVault: (...a: unknown[]) => findProfileByVault(...a),
}));

const unlock = (await import('../app/api/checkout/unlock/route')).POST;
const tip = (await import('../app/api/checkout/tip/route')).POST;

const SENDER = `0x${'a1'.repeat(32)}`;
const VAULT = `0x${'b2'.repeat(32)}`;

function post(path: string, body: Record<string, unknown>): Request {
  return new Request(`https://weir.social/api/checkout/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

afterEach(() => vi.clearAllMocks());

describe('unlock and tip refuse ids that are not Sui ids, as subscribe does', () => {
  it.each([
    ['sender', { sender: 'not-an-id', vaultId: VAULT }],
    ['vaultId', { sender: SENDER, vaultId: "0x'; DROP TABLE posts;--" }],
  ])('unlock: a bad %s is a 400 before the vault is looked up', async (_, ids) => {
    const response = await unlock(post('unlock', { ...ids, contentKey: 'k', expectedPrice: '1' }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'sender and vaultId must be 0x followed by hex digits' });
    expect(findProfileByVault).not.toHaveBeenCalled();
    expect(prepareUnlock).not.toHaveBeenCalled();
  });

  it.each([
    ['sender', { sender: 'not-an-id', vaultId: VAULT }],
    ['vaultId', { sender: SENDER, vaultId: '0xZZ' }],
  ])('tip: a bad %s is a 400 before the vault is looked up', async (_, ids) => {
    const response = await tip(post('tip', { ...ids, amount: '1' }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'sender and vaultId must be 0x followed by hex digits' });
    expect(findProfileByVault).not.toHaveBeenCalled();
    expect(prepareTip).not.toHaveBeenCalled();
  });

  it('well-formed ids reach the vault lookup', async () => {
    findProfileByVault.mockResolvedValue({ coinType: '0x2::sui::SUI' });
    prepareTip.mockResolvedValue({ ok: true, value: { bytes: 'AA==' } });
    const response = await tip(post('tip', { sender: SENDER, vaultId: VAULT, amount: '1' }));
    expect(response.status).toBe(200);
    expect(prepareTip).toHaveBeenCalledTimes(1);
  });
});
