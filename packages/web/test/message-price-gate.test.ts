// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { afterEach, describe, expect, it, vi } from 'vitest';

const verifyAction = vi.fn();
const addMessage = vi.fn();
const findProfile = vi.fn();

vi.mock('@/lib/rate-limit', () => ({
  simulateLimit: async () => null, rateLimit: () => null, quotaLimit: async () => null, clientKey: () => 'x' }));
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

    expect(verifyAction).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(401);
  });
});
