// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { afterEach, describe, expect, it, vi } from 'vitest';

const prepareSubscribe = vi.fn();
const findProfileByVault = vi.fn();

vi.mock('@/lib/rate-limit', () => ({
  simulateLimit: async () => null, rateLimit: () => null, clientKey: () => 'x' }));
vi.mock('@/lib/checkout', () => ({ prepareSubscribe: (...a: unknown[]) => prepareSubscribe(...a) }));
vi.mock('@/lib/content', () => ({
  findProfileByVault: (...a: unknown[]) => findProfileByVault(...a),
}));

const { POST } = await import('../app/api/checkout/subscribe/route');

const SENDER = `0x${'a1'.repeat(32)}`;
const VAULT = `0x${'b2'.repeat(32)}`;
const VAULT_COIN = '0xdba34672::usdc::USDC';
const ATTACKER_COIN = '0xdeadbeef::fake::FAKE';

function subscribe(extra: Record<string, unknown> = {}): Request {
  return new Request('https://weir.social/api/checkout/subscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sender: SENDER, vaultId: VAULT, tierIndex: 0, ...extra }),
  });
}

afterEach(() => vi.clearAllMocks());

describe('the coin type', () => {
  it('REFUSES a body that names a different coin, rather than quietly substituting', async () => {
    findProfileByVault.mockResolvedValue({ coinType: VAULT_COIN });

    const response = await POST(subscribe({ coinType: ATTACKER_COIN }));

    expect(response.status).toBe(409);
    expect(prepareSubscribe).not.toHaveBeenCalled();
  });

  it('names both coins when it refuses, so the caller can see which is which', async () => {
    findProfileByVault.mockResolvedValue({ coinType: VAULT_COIN });

    const body = (await (await POST(subscribe({ coinType: ATTACKER_COIN }))).json()) as {
      error: string;
    };

    expect(body.error).toContain(VAULT_COIN);
    expect(body.error).toContain(ATTACKER_COIN);
  });

  it('accepts a body that names the SAME coin, so no existing client breaks', async () => {
    findProfileByVault.mockResolvedValue({ coinType: VAULT_COIN });
    prepareSubscribe.mockResolvedValue({ ok: true, value: { kind: 'quote' } });

    const response = await POST(subscribe({ coinType: VAULT_COIN }));

    expect(response.status).toBe(200);
    expect((prepareSubscribe.mock.calls[0]?.[0] as { coinType: string }).coinType).toBe(VAULT_COIN);
  });

  it('is read from the vault even when the body omits it entirely', async () => {
    findProfileByVault.mockResolvedValue({ coinType: VAULT_COIN });
    prepareSubscribe.mockResolvedValue({ ok: true, value: { kind: 'quote' } });

    const response = await POST(subscribe());

    expect(response.status).toBe(200);
    expect((prepareSubscribe.mock.calls[0]?.[0] as { coinType: string }).coinType).toBe(VAULT_COIN);
  });

  it('is looked up against the vault the caller named', async () => {
    findProfileByVault.mockResolvedValue({ coinType: VAULT_COIN });
    prepareSubscribe.mockResolvedValue({ ok: true, value: { kind: 'quote' } });

    await POST(subscribe());

    expect(findProfileByVault).toHaveBeenCalledWith(VAULT);
  });
});

describe('a vault with no known denomination', () => {
  for (const [name, profile] of [
    ['no profile at all', null],
    ['a profile with no coin type', { coinType: null }],
    ['a profile with an empty coin type', { coinType: '' }],
  ] as const) {
    it(`refuses ${name} rather than guessing`, async () => {
      findProfileByVault.mockResolvedValue(profile);

      const response = await POST(subscribe({ coinType: ATTACKER_COIN }));

      expect(response.status).toBe(409);
      expect(prepareSubscribe).not.toHaveBeenCalled();
    });
  }
});

describe('the identifiers', () => {
  for (const bad of ['', 'not-an-address', '10', '0b1010']) {
    it(`refuses a vaultId of ${JSON.stringify(bad)} before reading anything`, async () => {
      const response = await POST(subscribe({ vaultId: bad }));

      expect(response.status).toBe(400);
      expect(findProfileByVault).not.toHaveBeenCalled();
    });
  }
});
