// @vitest-environment node
// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
/**
 * A malformed price is refused before the signature is spent.
 *
 * # Why the ordering is the test
 *
 * `POST /api/messages` took `body.paid.price` and stored it. `POST /api/posts` cannot: it compares
 * the submitted price against the on-chain price and refuses a disagreement, so only digits get
 * through there. That asymmetry is the finding — the same value, guarded on one route and not the
 * other, and every consumer parses it with `BigInt()`.
 *
 * The refusal has to come BEFORE `verifyAction`, because signatures are single-use. Refusing after
 * it would consume the creator's signature on a request that was never going to be stored, so
 * somebody who typed "1.5" would have to sign again to discover it — which is the same reasoning
 * `POST /api/posts` already applies to its length checks.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

const verifyAction = vi.fn();
const addMessage = vi.fn();
const findProfile = vi.fn();

vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => null, clientKey: () => 'x' }));
vi.mock('@/lib/identity', () => ({ verifyAction: (...a: unknown[]) => verifyAction(...a) }));
vi.mock('@/lib/content', () => ({
  addMessage: (...a: unknown[]) => addMessage(...a),
  findProfile: (...a: unknown[]) => findProfile(...a),
  MAX_MESSAGE_LENGTH: 4000,
  threadIdFor: () => 'thread',
}));
vi.mock('@/lib/e2e', () => ({ ciphertextDigest: () => 'digest' }));
vi.mock('@/lib/ids', () => ({ newId: () => 'm1' }));
vi.mock('@/lib/chain', () => ({ siteConfig: () => ({ ok: true, value: { network: 'mainnet' } }) }));
vi.mock('@projectx-social/sdk', () => ({
  createClient: () => ({}),
  readCreatorVault: async () => ({ ok: true, value: { owner: `0x${'ab'.repeat(32)}` } }),
}));

const { POST } = await import('../app/api/messages/route');

const FROM = `0x${'ab'.repeat(32)}`;
const TO = `0x${'cd'.repeat(32)}`;

function send(price: string): Request {
  return new Request('https://weir.social/api/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      from: FROM,
      to: TO,
      text: 'hello',
      preview: 'hello',
      signature: 'sig',
      timestampMs: Date.now(),
      paid: { price, contentKey: 'k', handle: 'alice' },
    }),
  });
}

afterEach(() => vi.clearAllMocks());

describe('a paid message whose price is not a whole number', () => {
  for (const bad of ['', '1.5', '1,000', '-1', '1e9', ' 1', 'abc']) {
    it(`refuses ${JSON.stringify(bad)} with 400`, async () => {
      const response = await POST(send(bad));

      expect(response.status).toBe(400);
      expect(addMessage).not.toHaveBeenCalled();
    });

    it(`does not spend a signature to refuse ${JSON.stringify(bad)}`, async () => {
      await POST(send(bad));

      // The whole reason the check sits where it does. Signatures are single-use: verifying first
      // would charge the sender a signature for a request that was never going to be stored.
      expect(verifyAction).not.toHaveBeenCalled();
    });
  }

  it('says what is wrong, in words that name the value', async () => {
    const body = (await (await POST(send('1.5'))).json()) as { error: string };
    expect(body.error).toContain('whole number');
    expect(body.error).toContain('1.5');
  });
});

describe('a paid message priced in whole units', () => {
  it('gets past the price gate and on to the signature', async () => {
    verifyAction.mockResolvedValue({ ok: false, failure: { kind: 'malformed', detail: 'no' } });

    const response = await POST(send('250000'));

    // Refused for the signature, NOT for the price — which is what proves the gate let it through
    // rather than the request failing for some unrelated reason all along.
    expect(verifyAction).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(401);
  });
});
