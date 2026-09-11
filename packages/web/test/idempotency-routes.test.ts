// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { createHash } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { closeDatabase, resetDatabase, testDb, useTestDatabase } from './helpers/database';

useTestDatabase();

const ORIGIN = 'https://weir.social';
const VAULT = `0x${'a1'.repeat(32)}`;
const TABLE = `0x${'c3'.repeat(32)}`;
const PACKAGE = `0x${'e5'.repeat(32)}`;
const COIN = '0xdba34672::usdc::USDC';

const keypair = new Ed25519Keypair();
const address = keypair.getPublicKey().toSuiAddress();

vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => null, simulateLimit: async () => null, quotaLimit: async () => null }));
vi.mock('@/lib/chain', () => ({
  siteConfig: () => ({
    ok: true,
    value: { network: 'mainnet', grpcUrl: 'https://fullnode.example.invalid:443', packageId: PACKAGE },
    observedAtMs: 0,
  }),
}));
vi.mock('@projectx-social/sdk', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createClient: () => ({ listOwnedObjects: async () => ({ objects: [], hasNextPage: false }) }),
  readCreatorVault: async () => ({ ok: true, value: { owner: address, contentPricesTableId: TABLE }, observedAtMs: 0 }),
  readContentPrice: async () => ({ ok: true, value: null, observedAtMs: 0 }),
}));

const { normaliseAddress } = await import('../lib/db');
const { statementFor } = await import('../lib/identity');
const { POST: publish } = await import('../app/api/posts/route');

const digestOf = (preview: string, text: string): string =>
  createHash('sha256').update(`${preview.length}:${preview}${text.length}:${text}`).digest('hex');

async function signedPublic(text: string, timestampMs: number): Promise<string> {
  const title = 'Once';
  const preview = 'said once';
  const action = { kind: 'publish' as const, handle: 'alice', title, access: 'public', contentSha256: digestOf(preview, text), contentKey: '', price: '' };
  const message = new TextEncoder().encode(statementFor(action, address, timestampMs, ORIGIN));
  const { signature } = await keypair.signPersonalMessage(message);
  return JSON.stringify({ handle: 'alice', author: address, title, preview, text, access: 'public', signature, timestampMs });
}

const post = (body: string, key?: string): Promise<Response> =>
  publish(
    new Request(`${ORIGIN}/api/posts`, {
      method: 'POST',
      body,
      headers: key === undefined ? {} : { 'idempotency-key': key },
    }),
  );

const rows = async (): Promise<number> =>
  Number((await testDb().query('SELECT count(*)::int AS n FROM posts')).rows[0]?.n ?? -1);

beforeEach(async () => {
  await resetDatabase();
  await testDb().query(
    `INSERT INTO profiles (handle, vault_id, owner, display_name, bio, coin_type) VALUES ('alice', $1, $2, 'Alice', 'writes', $3)`,
    [normaliseAddress(VAULT), address, COIN],
  );
});
afterAll(closeDatabase);

describe('POST /api/posts under an Idempotency-Key', () => {
  it('publishes once and replays the first answer, status and body verbatim', async () => {
    const body = await signedPublic('The same words, sent twice.', Date.now());
    const first = await post(body, 'k-once');
    expect(first.status, await first.clone().text()).toBe(200);
    const firstBody = (await first.json()) as { post: { id: string } };

    const second = await post(body, 'k-once');
    expect(second.status).toBe(200);
    expect(second.headers.get('idempotency-replayed')).toBe('true');
    expect(((await second.json()) as { post: { id: string } }).post.id).toBe(firstBody.post.id);
    expect(await rows()).toBe(1);
  });

  it('refuses the same key with a different body rather than guessing which request was meant', async () => {
    const now = Date.now();
    const first = await post(await signedPublic('first words', now), 'k-reused');
    expect(first.status).toBe(200);
    const other = await post(await signedPublic('other words', now), 'k-reused');
    expect(other.status).toBe(409);
    expect(((await other.json()) as { error: string }).error).toMatch(/different request body/);
    expect(await rows()).toBe(1);
  });

  it('a refused request frees its key, so the retry after a fix can run', async () => {
    const now = Date.now();
    const bad = JSON.parse(await signedPublic('unsigned words', now)) as Record<string, unknown>;
    bad['signature'] = 'AAAA';
    const refused = await post(JSON.stringify(bad), 'k-fixed');
    expect(refused.status).toBe(401);
    expect(await rows()).toBe(0);

    const fixed = await post(await signedPublic('unsigned words', now), 'k-fixed');
    expect(fixed.status, await fixed.clone().text()).toBe(200);
    expect(fixed.headers.get('idempotency-replayed')).toBeNull();
    expect(await rows()).toBe(1);
  });

  it('without the header, two identical requests are two posts — the old behaviour, unchanged', async () => {
    const body = await signedPublic('twice on purpose', Date.now());
    expect((await post(body)).status).toBe(200);
    const again = await signedPublic('twice on purpose', Date.now() + 1);
    expect((await post(again)).status).toBe(200);
    expect(await rows()).toBe(2);
  });

  it('a key with no caller in the body is refused before anything is claimed', async () => {
    const r = await post(JSON.stringify({ handle: 'alice', title: 'x' }), 'k-nobody');
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: string }).error).toMatch(/names none/);
  });
});
