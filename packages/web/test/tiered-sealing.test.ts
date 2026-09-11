// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { createHash } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { accessStatement } from '@projectx-social/sdk';
import { closeDatabase, resetDatabase, testDb, useTestDatabase } from './helpers/database';

useTestDatabase();

const ORIGIN = 'https://weir.social';
const VAULT = `0x${'a1'.repeat(32)}`;
const TABLE = `0x${'c3'.repeat(32)}`;
const PACKAGE = `0x${'e5'.repeat(32)}`;
const COIN = '0xdba34672::usdc::USDC';

const keypair = new Ed25519Keypair();
const address = keypair.getPublicKey().toSuiAddress();

const TIERS = [
  { index: 0, name: 'Reader', price: 1_000_000n, periodMs: 2_592_000_000n, active: true },
  { index: 1, name: 'Patron', price: 5_000_000n, periodMs: 2_592_000_000n, active: true },
  { index: 2, name: 'Retired', price: 9_000_000n, periodMs: 2_592_000_000n, active: false },
];

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
  readCreatorVault: async () => ({ ok: true, value: { owner: address, contentPricesTableId: TABLE, tiers: TIERS }, observedAtMs: 0 }),
  readContentPrice: async () => ({ ok: true, value: null, observedAtMs: 0 }),
}));

const gates: Array<{ kind: string; tier?: bigint }> = [];
vi.mock('@/lib/body-storage', () => ({
  storeBody: async (input: { body: string; gate: { kind: string; tier?: bigint; period?: bigint } }) => {
    gates.push(input.gate);
    return {
      ok: true,
      observedAtMs: 0,
      value: {
        blobId: 'blob:period', endEpoch: 999, nonce: 'n', sealWrappedKey: 'w',
        sha256: createHash('sha256').update(input.body).digest('hex'), bytes: input.body.length,
        ...(input.gate.kind === 'period' ? { tier: input.gate.tier!.toString(), period: (input.gate as { period: bigint }).period.toString() } : {}),
      },
    };
  },
}));

const { normaliseAddress } = await import('../lib/db');
const { statementFor } = await import('../lib/identity');
const { findPost } = await import('../lib/content');
const { POST: publish } = await import('../app/api/posts/route');

const digestOf = (preview: string, text: string): string =>
  createHash('sha256').update(`${preview.length}:${preview}${text.length}:${text}`).digest('hex');

async function signedSubscribers(tier: number | undefined, signedTier = tier): Promise<string> {
  const title = 'For the patrons';
  const preview = 'a taste';
  const text = 'the whole thing';
  const timestampMs = Date.now();
  const action = {
    kind: 'publish' as const,
    handle: 'alice',
    title,
    access: accessStatement('subscribers', signedTier),
    contentSha256: digestOf(preview, text),
    contentKey: '',
    price: '',
  };
  const message = new TextEncoder().encode(statementFor(action, address, timestampMs, ORIGIN));
  const { signature } = await keypair.signPersonalMessage(message);
  return JSON.stringify({ handle: 'alice', author: address, title, preview, text, access: 'subscribers', ...(tier === undefined ? {} : { tier }), signature, timestampMs });
}

const post = (body: string): Promise<Response> =>
  publish(new Request(`${ORIGIN}/api/posts`, { method: 'POST', body }));

beforeEach(async () => {
  await resetDatabase();
  gates.length = 0;
  await testDb().query(
    `INSERT INTO profiles (handle, vault_id, owner, display_name, bio, coin_type) VALUES ('alice', $1, $2, 'Alice', 'writes', $3)`,
    [normaliseAddress(VAULT), address, COIN],
  );
});
afterAll(closeDatabase);

describe('a subscriber post and its tier', () => {
  it('is sealed to the chosen tier, and the row says so', async () => {
    const r = await post(await signedSubscribers(1));
    expect(r.status, await r.clone().text()).toBe(200);
    expect(gates).toEqual([{ kind: 'period', tier: 1n, period: expect.anything() }]);
    const { post: created } = (await r.json()) as { post: { id: string } };
    const row = await findPost(created.id);
    expect(row?.access).toEqual({ kind: 'subscribers', tier: 1 });
    expect(row?.sealedBody?.tier).toBe('1');
  });

  it('omitting the tier seals at 0, exactly as before', async () => {
    const r = await post(await signedSubscribers(undefined));
    expect(r.status).toBe(200);
    expect(gates[0]?.tier).toBe(0n);
    const { post: created } = (await r.json()) as { post: { id: string } };
    expect((await findPost(created.id))?.access).toEqual({ kind: 'subscribers', tier: 0 });
  });

  it('an index past the last tier is refused before anything is sealed', async () => {
    const r = await post(await signedSubscribers(3));
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: string }).error).toMatch(/3 tier/);
    expect(gates).toEqual([]);
  });

  it('a retired tier is refused', async () => {
    const r = await post(await signedSubscribers(2));
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: string }).error).toMatch(/retired/);
    expect(gates).toEqual([]);
  });

  it('the tier is inside the signature: a body that names a tier the signer did not is refused', async () => {
    const r = await post(await signedSubscribers(1, 0));
    expect(r.status).toBe(401);
    expect(gates).toEqual([]);
  });
});
