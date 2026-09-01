// @vitest-environment node
// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
/**
 * The coin a subscription is paid in comes from the vault, never from the request.
 *
 * # The defect this pins
 *
 * `subscribe<T>` is a generic call, so `coinType` chooses which instantiation executes. `tip` and
 * `unlock` both take it from the vault and both say why in their own words; `subscribe` took it
 * from the request body. One of three sibling routes disagreeing with the other two is the shape
 * of every authorship defect on this codebase: a value the caller supplies standing in for a value
 * the chain already decided.
 *
 * The field is now not read from the body at all, rather than read and overridden. A field that is
 * accepted and then ignored is one somebody wires back through later, believing it was always
 * meant to be honoured.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

const prepareSubscribe = vi.fn();
const findProfileByVault = vi.fn();

vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => null, clientKey: () => 'x' }));
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
  it("is the vault's, even when the body names another", async () => {
    findProfileByVault.mockResolvedValue({ coinType: VAULT_COIN });
    prepareSubscribe.mockResolvedValue({ ok: true, value: { kind: 'quote' } });

    await POST(subscribe({ coinType: ATTACKER_COIN }));

    const call = prepareSubscribe.mock.calls[0]?.[0] as { coinType: string };
    expect(call.coinType).toBe(VAULT_COIN);
    expect(call.coinType).not.toBe(ATTACKER_COIN);
  });

  it('is read from the vault even when the body omits it entirely', async () => {
    // It is no longer a required field, because it is no longer a field this route reads.
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

    // If these could differ, the denomination of one vault would price a subscription to another.
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

      // There is nothing to fall back to: a guessed type parameter builds a transaction against a
      // vault that does not exist. Falling back to the BODY would be the defect restored.
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
