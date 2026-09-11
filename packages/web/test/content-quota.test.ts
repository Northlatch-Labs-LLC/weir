// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ADDRESS = `0x${'ab'.repeat(32)}`;
const OTHER = `0x${'cd'.repeat(32)}`;
const VAULT = `0x${'a1'.repeat(32)}`;
const TABLE = `0x${'c3'.repeat(32)}`;
const ORIGIN = 'https://weir.social';

const spent: Array<{ address: string; name: string }> = [];
let refuse: string | null = null;
let proof: unknown = { ok: true, value: null };
let claim: unknown = null;

const addPost = vi.fn();
const addMessage = vi.fn();
const findProfile = vi.fn();
const readContentPrice = vi.fn();

vi.mock('@/lib/rate-limit', () => ({
  rateLimit: () => null,
  simulateLimit: async () => null,
  quotaLimit: async (address: string, name: string) => {
    spent.push({ address, name });
    return refuse === name
      ? Response.json({ error: 'over quota', bucket: name }, { status: 429 })
      : null;
  },
}));
vi.mock('@/lib/agent-standing', () => ({
  refuseWithdrawnDeclaration: async () => null,
}));
vi.mock('@/lib/identity', () => ({
  verifyActionDeferringSpend: async () => proof,
  verifyAction: async () => proof,
  spendSignature: async () => ({ ok: true, value: undefined }),
  sweepUsedSignatures: async () => undefined,
}));
vi.mock('@/lib/content', () => ({
  addPost: (...a: unknown[]) => addPost(...a),
  addMessage: (...a: unknown[]) => addMessage(...a),
  findProfile: (...a: unknown[]) => findProfile(...a),
  threadIdFor: () => 'thread',
  MAX_MESSAGE_LENGTH: 4000,
  MAX_POST_TITLE_LENGTH: 200,
  MAX_POST_PREVIEW_LENGTH: 1000,
  MAX_POST_BODY_LENGTH: 100_000,
}));
vi.mock('@/lib/chain', () => ({
  siteConfig: () => ({ ok: true, value: { network: 'mainnet', packageId: `0x${'e5'.repeat(32)}` }, observedAtMs: 0 }),
}));
vi.mock('@projectx-social/sdk', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createClient: () => ({}),
  readCreatorVault: async () => ({ ok: true, value: { owner: ADDRESS, contentPricesTableId: TABLE, tiers: [] }, observedAtMs: 0 }),
  readContentPrice: (...a: unknown[]) => readContentPrice(...a),
}));
vi.mock('@/lib/ids', () => ({ newId: (p: string) => `${p}1` }));
vi.mock('@/lib/db', () => ({
  db: () => ({ connect: async () => ({ query: async () => ({ rowCount: 1, rows: [] }), release: () => undefined }) }),
  normaliseAddress: (a: string) => a.toLowerCase(),
}));
vi.mock('@/lib/idempotency', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  claimIdempotencyKey: async () => claim,
  completeIdempotentRequest: async () => undefined,
  releaseIdempotencyClaim: async () => undefined,
}));

const { POST: publish } = await import('../app/api/posts/route');
const { POST: send } = await import('../app/api/messages/route');

const request = (path: string, body: unknown, key?: string): Request =>
  new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: key === undefined ? { 'content-type': 'application/json' } : { 'content-type': 'application/json', 'idempotency-key': key },
    body: JSON.stringify(body),
  });

const publicPost = (text = 'words') => ({
  handle: 'alice', author: ADDRESS, title: 'Once', preview: 'said once', text,
  access: 'public', signature: 'sig', timestampMs: Date.now(),
});
const paidPost = () => ({
  handle: 'alice', author: ADDRESS, title: 'Paid', preview: 'p', text: 'paid words',
  access: 'paid', contentKey: 'k', price: '5', signature: 'sig', timestampMs: Date.now(),
});
const openMessage = (text = 'hello') => ({
  from: ADDRESS, to: OTHER, preview: text, text, signature: 'sig', timestampMs: Date.now(),
});
const paidMessage = () => ({
  ...openMessage('for sale'), paid: { price: '5', contentKey: 'k', handle: 'alice' },
});
const encryptedMessage = () => ({
  from: ADDRESS, to: OTHER, signature: 'sig', timestampMs: Date.now(),
  encryption: {
    ciphertext: 'Y2lwaGVydGV4dA==', nonce: 'NN',
    envelopes: [ADDRESS, OTHER].map((recipient) => ({ recipient, ephemeralPublic: 'AA', nonce: 'BB', wrappedKey: 'CC' })),
  },
});

beforeEach(() => {
  spent.length = 0;
  refuse = null;
  proof = { ok: true, value: null };
  claim = { kind: 'claimed', key: 'k1', address: ADDRESS };
  addPost.mockReset();
  addMessage.mockReset();
  findProfile.mockReset().mockResolvedValue({ handle: 'alice', vaultId: VAULT, owner: ADDRESS });
  readContentPrice.mockReset().mockResolvedValue({ ok: true, value: 5n, observedAtMs: 0 });
});

describe('POST /api/posts spends the publish quota', () => {
  it('spends the publish bucket, keyed on the author the signature proves', async () => {
    const r = await publish(request('/api/posts', publicPost()));
    expect(r.status, await r.clone().text()).toBe(200);
    expect(spent).toEqual([{ address: ADDRESS, name: 'publish' }]);
    expect(addPost).toHaveBeenCalledTimes(1);
  });

  it('a forged publish spends nothing — an unproven author cannot drain a stranger', async () => {
    proof = { ok: false, failure: { detail: 'the signature does not verify' } };
    const r = await publish(request('/api/posts', publicPost()));
    expect(r.status).toBe(401);
    expect(spent).toEqual([]);
    expect(addPost).not.toHaveBeenCalled();
  });

  it('a refusal is returned to the caller and no post is written', async () => {
    refuse = 'publish';
    const r = await publish(request('/api/posts', publicPost()));
    expect(r.status).toBe(429);
    expect(((await r.json()) as { bucket: string }).bucket).toBe('publish');
    expect(addPost).not.toHaveBeenCalled();
  });

  it('is spent before the on-chain read that precedes sealing, so a refusal costs no storage', async () => {
    refuse = 'publish';
    const r = await publish(request('/api/posts', paidPost()));
    expect(r.status).toBe(429);
    expect(readContentPrice).not.toHaveBeenCalled();
    expect(addPost).not.toHaveBeenCalled();
  });
});

describe('the quota and the idempotency ledger together', () => {
  it('a replay under a key spends no token and does not run the route again', async () => {
    claim = { kind: 'replay', status: 200, body: { post: { id: 'p1' } } };
    const r = await publish(request('/api/posts', publicPost(), 'k-once'));

    expect(r.headers.get('idempotency-replayed')).toBe('true');
    expect(spent).toEqual([]);
    expect(addPost).not.toHaveBeenCalled();
  });

  it('a claimed key runs the route and pays for it, so the replay above is not free by accident', async () => {
    const r = await publish(request('/api/posts', publicPost(), 'k-first'));
    expect(r.status).toBe(200);
    expect(spent).toEqual([{ address: ADDRESS, name: 'publish' }]);
  });

  it('without a key there is nothing to recognise a retry by, so each attempt pays', async () => {
    expect((await publish(request('/api/posts', publicPost('one')))).status).toBe(200);
    expect((await publish(request('/api/posts', publicPost('two')))).status).toBe(200);
    expect(spent.map((s) => s.name)).toEqual(['publish', 'publish']);
  });
});

describe('POST /api/messages spends the message quota', () => {
  it('spends the message bucket, keyed on the sender the signature proves', async () => {
    const r = await send(request('/api/messages', openMessage()));
    expect(r.status, await r.clone().text()).toBe(200);
    expect(spent).toEqual([{ address: ADDRESS, name: 'message' }]);
    expect(addMessage).toHaveBeenCalledTimes(1);
  });

  it('an encrypted message spends the same bucket — a flood is a flood either way', async () => {
    const r = await send(request('/api/messages', encryptedMessage()));
    expect(r.status, await r.clone().text()).toBe(200);
    expect(spent).toEqual([{ address: ADDRESS, name: 'message' }]);
    expect(addMessage).toHaveBeenCalledTimes(1);
  });

  it('a forged message spends nothing', async () => {
    proof = { ok: false, failure: { detail: 'the signature does not verify' } };
    const r = await send(request('/api/messages', openMessage()));
    expect(r.status).toBe(401);
    expect(spent).toEqual([]);
    expect(addMessage).not.toHaveBeenCalled();
  });

  it('a forged encrypted message spends nothing either', async () => {
    proof = { ok: false, failure: { detail: 'the signature does not verify' } };
    const r = await send(request('/api/messages', encryptedMessage()));
    expect(r.status).toBe(401);
    expect(spent).toEqual([]);
    expect(addMessage).not.toHaveBeenCalled();
  });

  it('a refusal is returned to the caller and no message is written', async () => {
    refuse = 'message';
    const r = await send(request('/api/messages', openMessage()));
    expect(r.status).toBe(429);
    expect(((await r.json()) as { bucket: string }).bucket).toBe('message');
    expect(addMessage).not.toHaveBeenCalled();
  });

  it('is spent before a paid message looks up the profile it would settle into', async () => {
    refuse = 'message';
    const r = await send(request('/api/messages', paidMessage()));
    expect(r.status).toBe(429);
    expect(findProfile).not.toHaveBeenCalled();
    expect(addMessage).not.toHaveBeenCalled();
  });
});
