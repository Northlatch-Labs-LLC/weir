// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/*
  An entitled agent is handed the sealed reference of what it bought — never the words.

  The demonstration's buyer held a valid machine Unlock and no route would hand it the blob id,
  the wrapped key, the nonce and the approval it needed to open the body with its own Seal
  session. Now `GET /api/posts/{id}` does, for a proven read session whose address holds the
  entitlement on chain, and hands the MACHINE edition to a machine Unlock.

  Mutations predicted: hand `sealed` to an anonymous reader → "anonymous gets nothing sealed" red;
  hand the human body to a machine approver → "a machine Unlock is handed the machine edition" red;
  put the words in the answer → "the words are never served" red.
*/
import { createHash } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { bcs } from '@mysten/sui/bcs';
import { closeDatabase, resetDatabase, testDb, useTestDatabase } from './helpers/database';

useTestDatabase();

const ORIGIN = 'https://weir.social';
const VAULT = `0x${'a1'.repeat(32)}`;
const OWNER = `0x${'b2'.repeat(32)}`;
const READER = `0x${'c3'.repeat(32)}`;
const PACKAGE = `0x${'e5'.repeat(32)}`;
const UNLOCK_ID = `0x${'d4'.repeat(32)}`;

let reader: string | null = null;
let unlocksHeld: Array<{ id: string; contentKey: string }> = [];

const UnlockBcs = bcs.struct('Unlock', {
  id: bcs.Address,
  vault: bcs.Address,
  buyer: bcs.Address,
  contentKey: bcs.vector(bcs.u8()),
  pricePaid: bcs.u64(),
  purchasedAtMs: bcs.u64(),
});

vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => null, simulateLimit: async () => null }));
vi.mock('@/lib/read-session', () => ({ provenReaderFor: async () => ({ ok: true, value: reader, observedAtMs: 0 }) }));
vi.mock('@/lib/chain', () => ({
  siteConfig: () => ({
    ok: true,
    value: { network: 'mainnet', grpcUrl: 'https://fullnode.example.invalid:443', packageId: PACKAGE },
    observedAtMs: 0,
  }),
}));
vi.mock('@projectx-social/sdk', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createClient: () => ({
    listOwnedObjects: async (input: { type: string }) => ({
      objects: input.type.endsWith('::entitlement::Unlock')
        ? unlocksHeld.map((u) => ({
            content: Buffer.from(
              UnlockBcs.serialize({
                id: u.id, vault: VAULT, buyer: READER,
                contentKey: Array.from(new TextEncoder().encode(u.contentKey)),
                pricePaid: 500_000_000n, purchasedAtMs: 1n,
              }).toBytes(),
            ).toString('base64'),
          }))
        : [],
      hasNextPage: false,
    }),
  }),
}));

const { normaliseAddress } = await import('../lib/db');
const { addPost } = await import('../lib/content');
const { GET } = await import('../app/api/posts/[id]/route');

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const get = (id: string): Promise<Response> => GET(new Request(`${ORIGIN}/api/posts/${id}`), { params: Promise.resolve({ id }) });

beforeEach(async () => {
  await resetDatabase();
  reader = null;
  unlocksHeld = [];
  await testDb().query(
    `INSERT INTO profiles (handle, vault_id, owner, display_name, bio, coin_type) VALUES ('alice', $1, $2, 'Alice', 'writes', $3)`,
    [normaliseAddress(VAULT), OWNER, '0x2::sui::SUI'],
  );
  await addPost({
    id: 'p-paid', vaultId: normaliseAddress(VAULT), authorHandle: 'alice', createdAtMs: 1_756_700_000_000,
    title: 'Sold twice', preview: 'a taste', commentCount: 0, body: '',
    access: { kind: 'paid', price: '500000000', contentKey: 'k' },
    sealedBody: { blobId: 'blob:human', endEpoch: 999, nonce: 'n-h', sealWrappedKey: 'w-h', sha256: sha('human words') },
    machineBody: { blobId: 'blob:machine', endEpoch: 999, nonce: 'n-m', sealWrappedKey: 'w-m', sha256: sha('machine words'), contentKey: 'k#machine' },
  });
});
afterAll(closeDatabase);

describe('GET /api/posts/{id} for an entitled agent', () => {
  it('anonymous gets nothing sealed', async () => {
    const body = (await (await get('p-paid')).json()) as { sealed: unknown; body: unknown };
    expect(body.sealed).toBeNull();
    expect(body.body).toBeNull();
  });

  it('a reader with no entitlement gets nothing sealed either', async () => {
    reader = READER;
    const body = (await (await get('p-paid')).json()) as { sealed: unknown; entitledVia: unknown };
    expect(body.sealed).toBeNull();
    expect(body.entitledVia).toBeNull();
  });

  it('a machine Unlock is handed the machine edition, with the approval the key servers judge', async () => {
    reader = READER;
    unlocksHeld = [{ id: UNLOCK_ID, contentKey: 'k#machine' }];
    const r = await get('p-paid');
    expect(r.status, await r.clone().text()).toBe(200);
    const body = (await r.json()) as { sealed: { blobId: string; approval: Record<string, unknown> }; entitledVia: string; edition?: string; body: unknown };
    expect(body.entitledVia).toBe('unlock');
    expect(body.edition).toBe('machine');
    expect(body.sealed.blobId).toBe('blob:machine');
    expect(body.sealed.approval).toEqual({ kind: 'unlock', vaultId: normaliseAddress(VAULT), contentKey: 'k#machine', unlockId: normaliseAddress(UNLOCK_ID) });
    expect(body.body).toBeNull();
  });

  it('a human Unlock is handed the human edition', async () => {
    reader = READER;
    unlocksHeld = [{ id: UNLOCK_ID, contentKey: 'k' }];
    const body = (await (await get('p-paid')).json()) as { sealed: { blobId: string }; edition?: string };
    expect(body.sealed.blobId).toBe('blob:human');
    expect(body.edition).toBe('human');
  });

  it('the words are never served', async () => {
    reader = READER;
    unlocksHeld = [{ id: UNLOCK_ID, contentKey: 'k' }];
    const text = await (await get('p-paid')).text();
    expect(text).not.toContain('human words');
    expect(text).not.toContain('machine words');
  });
});
