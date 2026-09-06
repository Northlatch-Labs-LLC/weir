// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/**
 * The two surfaces content arrives on spend a durable bucket, keyed on a PROVEN address.
 *
 * # What was missing
 *
 * `POST /api/posts` and `POST /api/messages` were bounded by `rateLimit(request, 'write')` and by
 * nothing else. That counter is a module-level Map and its own header says what that means:
 * "Serverless multiplies instances, and each instance counts on its own." So the ceiling on how
 * much content one identity could produce was `limit x instances` — a number nobody chose, which
 * rises with exactly the traffic that makes it worth having. `quotaLimit` is one row in Postgres
 * and holds across every instance; until this change neither route called it.
 *
 * # The four properties, and why each is asserted rather than assumed
 *
 * **It is spent, and out of the right bucket.** A bucket named in a table and called by nothing is
 * documentation — which is what `QUOTAS.purchase` was until `test/checkout-submit-quota.test.ts`.
 * The bucket NAME is asserted, not merely that some quota was consulted: publishing out of `write`
 * would look limited and would still allow 120 posts at once and 3600 an hour.
 *
 * **It is keyed on the address the SIGNATURE proves, never on the body field.** This decides
 * whether the control is a spam limit or a weapon. Both routes are handed an address in the body —
 * `author`, `from` — and spending on it before proving it would let anybody empty any creator's
 * publishing budget with unsigned requests in their name: denial of publication, bought for the
 * price of a POST. So a request whose signature does not verify must spend NOTHING, asserted by
 * count rather than by status, because the 401 was already correct before this change.
 *
 * **It is spent before the route spends anything of ours.** A ceiling applied after the work
 * bounds the count and not the bill, and on the publish path the bill is real: a paid post seals
 * two durable blobs and the platform fronts the WAL for both. Asserted as an ordering — a refused
 * publish never reaches the on-chain price read that precedes the seal, and a refused paid message
 * never reaches the profile lookup.
 *
 * **A replay spends nothing.** This is where the quota half and the idempotency half meet, and it
 * is why they belong in one change. `lib/idempotent-route.ts` answers a retry out of the ledger
 * without running the route, so a well-behaved agent's backoff is free and a retry storm cannot
 * spend the budget of the caller it is retrying for. The contrast — no key, so nothing recognises
 * the retry, so each attempt pays — is asserted beside it, because a test in which everything is
 * free would pass against a route that spends nothing at all.
 *
 * # The seam, and what it deliberately does not prove
 *
 * `@/lib/rate-limit` is mocked to RECORD, exactly as `test/checkout-submit-quota.test.ts` does, and
 * the collaborators are mocked as `test/message-price-gate.test.ts` mocks them — these files are
 * about what the route DECIDES, not about what the store does underneath. The bucket arithmetic
 * (refill, capacity, the concurrency argument) is `test/quotas.test.ts`'s subject and is not
 * re-proved here. `idempotencyResponse` is the real one; only the three statements that touch
 * Postgres are replaced.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ADDRESS = `0x${'ab'.repeat(32)}`;
const OTHER = `0x${'cd'.repeat(32)}`;
const VAULT = `0x${'a1'.repeat(32)}`;
const TABLE = `0x${'c3'.repeat(32)}`;
const ORIGIN = 'https://weir.social';

/** Every bucket the routes spend, in order, with the address it was keyed on. */
const spent: Array<{ address: string; name: string }> = [];
/** When set, that bucket refuses, so the route's own handling of a 429 runs. */
let refuse: string | null = null;
/** What the signature check concludes. `value: null` means there is no deferred spend to make. */
let proof: unknown = { ok: true, value: null };
/** What the ledger says about the key on this request. */
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
/**
 * The agent register is not this file's subject. `refuseWithdrawnDeclaration` runs on the same two
 * routes, after the same proof and before the same costs; here it always lets the caller through so
 * that every refusal these tests see is the quota's.
 */
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
/** One connection whose every statement succeeds: the transaction is not this file's subject. */
vi.mock('@/lib/db', () => ({
  db: () => ({ connect: async () => ({ query: async () => ({ rowCount: 1, rows: [] }), release: () => undefined }) }),
  normaliseAddress: (a: string) => a.toLowerCase(),
}));
/** Only the three statements that reach Postgres. `idempotencyResponse` stays the real one. */
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
    /*
      The body still NAMES the honest author: this is exactly the request a stranger would send to
      spend somebody else's budget. The empty list is the assertion that matters; the 401 was
      already correct before this change and would stay correct if the bucket were drained first.
    */
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
    /*
      Ordering. Sealing is what fronts WAL, and a `paid` publish reaches `sealBothEditions` only
      after reading the content price from chain. If the quota were consulted lower down, that read
      would happen and this would be a 409 or a 200 rather than a 429.
    */
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
    /*
      One bucket across both shapes. Two would mean a sender who alternated had twice the ceiling
      the table states, and the resource being spent — the recipient's attention — does not care
      which shape arrived.
    */
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
    // The same ordering argument as the publish path: refused first, so the work below never runs.
    refuse = 'message';
    const r = await send(request('/api/messages', paidMessage()));
    expect(r.status).toBe(429);
    expect(findProfile).not.toHaveBeenCalled();
    expect(addMessage).not.toHaveBeenCalled();
  });
});
