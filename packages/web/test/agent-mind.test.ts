// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/*
  The mind route, end to end against the disposable database, with Walrus faked at the two calls
  that spend WAL (`grantUpload`, `storeBlob`).

  Mutations predicted: drop the config gate → "answers 501 with nothing configured" red; compute
  the statement's sha256 from the request's claim instead of the bytes → "a signature over other
  bytes is a forgery" red; accept two envelopes → "one envelope, naming the signer" red; skip
  `quotaLimitConfigured` → "a second remember inside the window is refused" red; spend the
  signature before the store → "a store failure leaves the signature unspent" red; sweep every
  bucket → "the sweep leaves the configured bucket alone" red; drop the register gate → "an
  undeclared address is refused" red.
*/
import { createHash } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { KEY_STATEMENT, deriveSecret, encryptBytes, fromB64, publicFromSecret, statementFor, toB64 } from '@projectx-social/sdk';
import { closeDatabase, resetDatabase, testDb, useTestDatabase } from './helpers/database';

useTestDatabase();

const ORIGIN = 'https://weir.social';
const MIND_ENV = {
  PROJECTX_SOCIAL_MIND_MAX_BYTES: '4096',
  PROJECTX_SOCIAL_MIND_QUOTA_CAPACITY: '1',
  PROJECTX_SOCIAL_MIND_QUOTA_MS_PER_TOKEN: '21600000',
};

vi.mock('@/lib/rate-limit', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/rate-limit')>();
  return { ...actual, rateLimit: () => null, simulateLimit: async () => null };
});
vi.mock('@/lib/chain', () => ({
  siteConfig: () => ({
    ok: true,
    value: { network: 'mainnet', grpcUrl: 'https://fullnode.example.invalid:443', packageId: `0x${'e5'.repeat(32)}` },
    observedAtMs: 0,
  }),
}));
const walrus = vi.hoisted(() => ({
  stores: [] as Array<{ size: number; owner: string; epochs: number }>,
  failNext: null as string | null,
}));
vi.mock('@/lib/publisher-token', () => ({
  grantUpload: async (input: { owner: string; size: number; tier: string }) =>
    input.tier === 'durable' ? { ok: true, value: { token: 'tok', epochs: 53, size: input.size }, observedAtMs: 0 } : { ok: false, failure: { kind: 'malformed', source: 'test', detail: 'a mind must be durable' } },
}));
vi.mock('@/lib/walrus', () => ({
  storeBlob: async (bytes: Uint8Array, options: { epochs: number; sendObjectTo: string }) => {
    if (walrus.failNext !== null) {
      const why = walrus.failNext;
      walrus.failNext = null;
      return { ok: false, failure: { kind: 'transport', source: 'Walrus store', detail: why } };
    }
    walrus.stores.push({ size: bytes.length, owner: options.sendObjectTo, epochs: options.epochs });
    return { ok: true, value: { blobId: `blob-${walrus.stores.length}`, size: bytes.length, endEpoch: 100 + options.epochs, alreadyExisted: false }, observedAtMs: 0 };
  },
}));

const route = await import('../app/api/agents/mind/route');
const rateLimit = await import('@/lib/rate-limit');

const agent = Ed25519Keypair.generate();
const AGENT = agent.toSuiAddress();

async function mindKey() {
  const { signature } = await agent.signPersonalMessage(new TextEncoder().encode(KEY_STATEMENT));
  const secret = deriveSecret(signature);
  return { secret, x25519Public: toB64(publicFromSecret(secret)) };
}

async function submission(plaintext: Uint8Array, over: { label?: string; issuedAtMs?: number; signOver?: { sha256?: string; bytes?: string }; envelopes?: unknown[]; address?: string } = {}) {
  const key = await mindKey();
  const payload = encryptBytes(plaintext, [{ address: AGENT, x25519Public: key.x25519Public }]);
  const ciphertext = fromB64(payload.ciphertext);
  const sha256 = over.signOver?.sha256 ?? createHash('sha256').update(ciphertext).digest('hex');
  const bytes = over.signOver?.bytes ?? String(ciphertext.length);
  const label = over.label ?? 'desk';
  const issued = over.issuedAtMs ?? Date.now();
  const text = statementFor({ kind: 'remember', label, sha256, bytes }, AGENT, issued, ORIGIN);
  const { signature } = await agent.signPersonalMessage(new TextEncoder().encode(text));
  return {
    address: over.address ?? AGENT,
    label,
    timestampMs: issued,
    signature,
    payload: { ...payload, envelopes: over.envelopes ?? payload.envelopes },
  };
}

const post = (body: unknown, headers: Record<string, string> = {}) =>
  route.POST(new Request(`${ORIGIN}/api/agents/mind`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }));
const get = (address: string, label: string) => route.GET(new Request(`${ORIGIN}/api/agents/mind?address=${address}&label=${label}`));

const OPERATOR = Ed25519Keypair.generate().toSuiAddress();
/** The register row a real declaration writes (023); signatures are opaque text to this table. */
async function declare(address: string, revokedAtMs: number | null = null) {
  await testDb().query(
    `INSERT INTO agent_accounts (address, operator_address, agent_signature, operator_signature, model, purpose, declared_at_ms, revoked_at_ms)
     VALUES ($1, $2, 'sig-a', 'sig-o', 'claude', 'keeps a mind', $3, $4)`,
    [address, OPERATOR, Date.now(), revokedAtMs],
  );
}

beforeEach(async () => {
  await resetDatabase();
  await testDb().query('DELETE FROM agent_minds');
  await testDb().query('DELETE FROM agent_quotas');
  await testDb().query('DELETE FROM agent_accounts');
  await declare(AGENT);
  walrus.stores.length = 0;
  walrus.failNext = null;
  Object.assign(process.env, MIND_ENV);
});
afterEach(() => {
  for (const name of Object.keys(MIND_ENV)) delete process.env[name];
});
afterAll(closeDatabase);

describe('POST /api/agents/mind', () => {
  it('answers 501 with nothing configured, naming the variable, and stores nothing', async () => {
    delete process.env['PROJECTX_SOCIAL_MIND_MAX_BYTES'];
    const r = await post(await submission(new Uint8Array([1, 2, 3])));
    expect(r.status).toBe(501);
    expect(((await r.json()) as { error: string }).error).toContain('PROJECTX_SOCIAL_MIND_MAX_BYTES');
    expect(walrus.stores).toEqual([]);
  });

  it('stores a signed mind: durable, owned by the agent, the row spent with the signature, and GET returns it', async () => {
    const plaintext = new Uint8Array(1000).map((_, i) => i & 0xff);
    const body = await submission(plaintext);
    const r = await post(body);
    expect(r.status, await r.clone().text()).toBe(201);
    const { mind } = (await r.json()) as { mind: Record<string, unknown> };
    const ciphertext = fromB64(body.payload.ciphertext);
    expect(mind).toMatchObject({ address: AGENT, label: 'desk', blobId: 'blob-1', endEpoch: 153, bytes: ciphertext.length, sha256: createHash('sha256').update(ciphertext).digest('hex') });
    expect(Object.keys(mind).sort()).toEqual(['address', 'blobId', 'bytes', 'createdAtMs', 'endEpoch', 'label', 'sha256']);
    expect(walrus.stores).toEqual([{ size: ciphertext.length, owner: AGENT, epochs: 53 }]);

    // The plaintext is nowhere: not in the row, not in the response.
    const rows = await testDb().query<{ envelope: { recipient: string }; nonce: string }>('SELECT envelope, nonce FROM agent_minds WHERE address = $1', [AGENT]);
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0]!.envelope.recipient).toBe(AGENT);
    expect(JSON.stringify(rows.rows)).not.toContain(toB64(plaintext));

    const g = await get(AGENT, 'desk');
    expect(g.status).toBe(200);
    const back = (await g.json()) as { mind: Record<string, unknown> };
    expect(back.mind['blobId']).toBe('blob-1');
    expect(back.mind['nonce']).toBe(body.payload.nonce);
    expect(back.mind['envelope']).toEqual(body.payload.envelopes[0]);

    // Single-use: the same signed body again is a replay.
    const again = await post(body);
    expect(again.status).toBe(401);
  });

  it('a signature over other bytes is a forgery: the server hashes what it received', async () => {
    // Each forgery also CLAIMS the value it signed over, as a top-level field, so a server that
    // trusted a claim instead of hashing the bytes would accept it. The route must never read them.
    const forged = { ...(await submission(new Uint8Array([9, 9, 9]), { signOver: { sha256: 'a'.repeat(64) } })), sha256: 'a'.repeat(64) };
    expect((await post(forged)).status).toBe(401);
    const wrongLength = { ...(await submission(new Uint8Array([9, 9, 9]), { signOver: { bytes: '1' } })), bytes: '1' };
    expect((await post(wrongLength)).status).toBe(401);
    expect(walrus.stores).toEqual([]);
  });

  it('one envelope, naming the signer, or nothing is stored', async () => {
    const key = await mindKey();
    const stranger = Ed25519Keypair.generate().toSuiAddress();
    const good = await submission(new Uint8Array([1]));
    const two = { ...good, payload: { ...good.payload, envelopes: [good.payload.envelopes[0], good.payload.envelopes[0]] } };
    expect((await post(two)).status).toBe(400);
    const other = encryptBytes(new Uint8Array([1]), [{ address: stranger, x25519Public: key.x25519Public }]);
    const foreign = { ...good, payload: other };
    const r = await post(foreign);
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: string }).error).toContain('must name the signing address');
    expect(walrus.stores).toEqual([]);
  });

  it('refuses a ciphertext over the ceiling as 413, before any signature is checked or WAL spent', async () => {
    const r = await post(await submission(new Uint8Array(5000)));
    expect(r.status).toBe(413);
    expect(((await r.json()) as { maxBytes: number }).maxBytes).toBe(4096);
    // And a body that DECLARES more than the ceiling allows is refused unread.
    const declared = await post(await submission(new Uint8Array([1])), { 'content-length': String(10 * 1024 * 1024) });
    expect(declared.status).toBe(413);
    expect(walrus.stores).toEqual([]);
  });

  it('a second remember inside the window is refused with the pacing numbers; the sweep leaves the bucket alone', async () => {
    expect((await post(await submission(new Uint8Array([1])))).status).toBe(201);
    const second = await post(await submission(new Uint8Array([2]), { label: 'other' }));
    expect(second.status).toBe(429);
    const refusal = (await second.json()) as { bucket: string; capacity: number; msPerToken: number; retryAfterSeconds: number };
    expect(refusal).toMatchObject({ bucket: 'mind', capacity: 1, msPerToken: 21_600_000 });
    expect(refusal.retryAfterSeconds).toBeGreaterThan(21_000);
    expect(walrus.stores).toHaveLength(1);

    // The sweep runs on every constant-bucket spend with a one-hour cutoff. The mind row is older
    // than that cutoff by the time this runs (aged by hand) and must survive it.
    await testDb().query(`UPDATE agent_quotas SET refilled_at_ms = $1 WHERE bucket = 'mind'`, [Date.now() - 2 * 3_600_000]);
    await rateLimit.spendQuota(AGENT, 'write', { now: Date.now() + 10 * 60_000 });
    const rows = await testDb().query(`SELECT bucket FROM agent_quotas WHERE address = $1 ORDER BY bucket`, [AGENT]);
    expect(rows.rows.map((r) => (r as { bucket: string }).bucket)).toEqual(['mind', 'write']);
  });

  it('a store failure leaves the signature unspent and answers 503, so the agent retries with the same one', async () => {
    walrus.failNext = 'the publisher answered 502';
    const body = await submission(new Uint8Array([7]));
    const r = await post(body);
    expect(r.status).toBe(503);
    expect(((await r.json()) as { error: string }).error).toContain('502');
    // The quota token was spent — WAL was attempted — but the signature was not; the retry succeeds once the quota refills.
    await testDb().query('DELETE FROM agent_quotas');
    expect((await post(body)).status).toBe(201);
  });

  it('an undeclared address is refused (403) after its signature is proved, and a revoked one too; nothing is stored', async () => {
    await testDb().query('DELETE FROM agent_accounts');
    const r = await post(await submission(new Uint8Array([1])));
    expect(r.status).toBe(403);
    expect(((await r.json()) as { error: string }).error).toContain('/agents/declare');
    await declare(AGENT, Date.now());
    expect((await post(await submission(new Uint8Array([1])))).status).toBe(403);
    expect(walrus.stores).toEqual([]);
    // An unsigned caller is still 401, never 403: the register is not consulted for an anonymous body.
    const unsigned = { ...(await submission(new Uint8Array([1]))), signature: 'AAAA' };
    expect((await post(unsigned)).status).toBe(401);
  });

  it('GET is public, needs both parameters, and separates never-remembered from cannot-read', async () => {
    expect((await route.GET(new Request(`${ORIGIN}/api/agents/mind?address=${AGENT}`))).status).toBe(400);
    expect((await get('nope', 'desk')).status).toBe(400);
    expect((await get(AGENT, 'never')).status).toBe(404);
  });
});
