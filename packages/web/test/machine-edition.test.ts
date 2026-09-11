// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { createHash } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { verifyPersonalMessageSignature } from '@mysten/sui/verify';
import { bcs } from '@mysten/sui/bcs';
import { closeDatabase, resetDatabase, testDb, useTestDatabase } from './helpers/database';

useTestDatabase();

const ORIGIN = 'https://weir.social';
const VAULT = `0x${'a1'.repeat(32)}`;
const TABLE = `0x${'c3'.repeat(32)}`;
const CAP = `0x${'d4'.repeat(32)}`;
const PACKAGE = `0x${'e5'.repeat(32)}`;
const COIN = '0xdba34672::usdc::USDC';

const keypair = new Ed25519Keypair();
const address = keypair.getPublicKey().toSuiAddress();

let priceOf: (contentKey: string) => bigint | null = () => 250_000n;
let unlocksHeld: Array<{ id: string; contentKey: string }> = [];

const UnlockBcs = bcs.struct('Unlock', {
  id: bcs.Address,
  vault: bcs.Address,
  buyer: bcs.Address,
  contentKey: bcs.vector(bcs.u8()),
  pricePaid: bcs.u64(),
  purchasedAtMs: bcs.u64(),
});

vi.mock('@/lib/rate-limit', () => ({
  rateLimit: () => null,
  simulateLimit: async () => null,
  quotaLimit: async () => null,
}));

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
                id: u.id, vault: VAULT, buyer: address,
                contentKey: Array.from(new TextEncoder().encode(u.contentKey)),
                pricePaid: 250_000n, purchasedAtMs: 1n,
              }).toBytes(),
            ).toString('base64'),
          }))
        : [],
      hasNextPage: false,
    }),
  }),
  readCreatorVault: async () => ({
    ok: true,
    value: { owner: address, contentPricesTableId: TABLE },
    observedAtMs: 0,
  }),
  readContentPrice: async (_client: unknown, _table: string, contentKey: string) => ({
    ok: true,
    value: priceOf(contentKey),
    observedAtMs: 0,
  }),
}));

const sealed: Array<{ contentKey: string; body: string }> = [];
let failOnCall: number | null = null;

vi.mock('@/lib/body-storage', () => ({
  storeBody: async (input: { body: string; gate: { kind: string; contentKey?: string } }) => {
    sealed.push({ contentKey: input.gate.contentKey ?? '(period)', body: input.body });
    if (failOnCall !== null && sealed.length === failOnCall) {
      return { ok: false, failure: { kind: 'transport', source: 'seal', detail: 'the committee did not answer' } };
    }
    return {
      ok: true,
      observedAtMs: 0,
      value: {
        blobId: `blob:${input.gate.contentKey ?? 'period'}`,
        endEpoch: 999,
        nonce: `nonce:${sealed.length}`,
        sealWrappedKey: `wrapped:${sealed.length}`,
        sha256: createHash('sha256').update(input.body).digest('hex'),
        bytes: input.body.length,
      },
    };
  },
}));

vi.mock('@/lib/checkout', () => ({
  findCreatorCaps: async () => ({ ok: true, value: capsHeld, observedAtMs: 0 }),
  prepareSetContentPrice: async (input: { contentKey: string }) => ({
    ok: true, value: { quoted: input.contentKey }, observedAtMs: 0,
  }),
}));
let capsHeld = new Map<string, string>();

const { normaliseAddress } = await import('../lib/db');
const { statementFor, verifyAction } = await import('../lib/identity');
const { addPost, findPost, machineBodyState } = await import('../lib/content');
const { machineContentKey, NO_MACHINE_BODY } = await import('../lib/machine-pricing');
const { readPurchases } = await import('../lib/purchases');
const { POST: publish } = await import('../app/api/posts/route');
const { POST: priceRoute } = await import('../app/api/studio/price/route');
const { GET: contentPrice } = await import('../app/api/studio/content-price/route');

const digestOf = (preview: string, text: string): string =>
  createHash('sha256').update(`${preview.length}:${preview}${text.length}:${text}`).digest('hex');

async function signedPublish(over: {
  contentKey: string;
  text?: string;
  title?: string;
  signature?: string;
}): Promise<Record<string, unknown>> {
  const title = over.title ?? 'Sold twice';
  const preview = 'the same words';
  const text = over.text ?? 'The same words, sold twice.';
  const timestampMs = Date.now();
  const action = {
    kind: 'publish' as const,
    handle: 'alice',
    title,
    access: 'paid',
    contentSha256: digestOf(preview, text),
    contentKey: over.contentKey,
    price: '250000',
  };
  const message = new TextEncoder().encode(statementFor(action, address, timestampMs, ORIGIN));
  const { signature } = await keypair.signPersonalMessage(message);
  return {
    handle: 'alice', author: address, title, preview, text, access: 'paid',
    contentKey: over.contentKey, price: '250000',
    signature: over.signature ?? signature, timestampMs,
  };
}

const post = (body: Record<string, unknown>): Promise<Response> =>
  publish(new Request(`${ORIGIN}/api/posts`, { method: 'POST', body: JSON.stringify(body) }));

const priceQuote = (contentKey: string): Promise<Response> =>
  priceRoute(new Request(`${ORIGIN}/api/studio/price`, {
    method: 'POST',
    body: JSON.stringify({ sender: address, vaultId: VAULT, coinType: COIN, contentKey, price: '250000' }),
  }));

async function seedAlice(): Promise<void> {
  await testDb().query(
    `INSERT INTO profiles (handle, vault_id, owner, display_name, bio, coin_type)
     VALUES ('alice', $1, $2, 'Alice', 'writes', $3)`,
    [normaliseAddress(VAULT), address, COIN],
  );
}

const MACHINE = (key: string): string => {
  const derived = machineContentKey(key);
  if (!derived.ok) throw new Error('unreachable: the key derives');
  return derived.value;
};

beforeEach(async () => {
  await resetDatabase();
  await seedAlice();
  sealed.length = 0;
  failOnCall = null;
  priceOf = () => 250_000n;
  unlocksHeld = [];
  capsHeld = new Map([[normaliseAddress(VAULT), CAP]]);
});
afterAll(closeDatabase);

describe('publishing keeps the proof of who signed it', () => {
  it('stores the exact signature and bytes the route verified', async () => {
    await priceQuote('proof-key');
    const body = await signedPublish({ contentKey: 'proof-key', title: 'Kept its receipt' });
    const res = await post(body);
    expect(res.status).toBe(200);

    const { rows } = await testDb().query(
      `SELECT author_address, issued_at_ms, origin, content_sha256, signature FROM posts WHERE title = $1`,
      ['Kept its receipt'],
    );
    expect(rows).toHaveLength(1);
    const row = rows[0] as Record<string, string>;
    expect(row['author_address']).toBe(address);
    expect(String(row['issued_at_ms'])).toBe(String(body['timestampMs']));
    expect(row['origin']).toBe(ORIGIN);
    expect(row['signature']).toBe(body['signature']);
    expect(row['content_sha256']).toBe(digestOf('the same words', 'The same words, sold twice.'));

    const statement = statementFor(
      {
        kind: 'publish', handle: 'alice', title: 'Kept its receipt', access: 'paid',
        contentSha256: row['content_sha256'] as string, contentKey: 'proof-key', price: '250000',
      },
      row['author_address'] as string,
      Number(row['issued_at_ms']),
      row['origin'] as string,
    );
    const key = await verifyPersonalMessageSignature(
      new TextEncoder().encode(statement),
      row['signature'] as string,
    );
    expect(key.toSuiAddress()).toBe(address);
  });
});

describe('publishing a paid post', () => {
  it('seals both editions of one body, to two identities, and records the machine one', async () => {
    const response = await post(await signedPublish({ contentKey: 'post-7' }));
    expect(response.status, await response.clone().text()).toBe(200);

    expect(sealed.map((s) => s.contentKey)).toEqual(['post-7', MACHINE('post-7')]);
    expect(new Set(sealed.map((s) => s.body)).size).toBe(1);

    const { post: created } = (await response.json()) as { post: { id: string } };
    const row = await findPost(created.id);
    expect(row?.sealedBody?.blobId).toBe('blob:post-7');
    expect(row?.machineBody).toEqual({
      blobId: `blob:${MACHINE('post-7')}`,
      endEpoch: 999,
      nonce: 'nonce:2',
      sealWrappedKey: 'wrapped:2',
      sha256: createHash('sha256').update('The same words, sold twice.').digest('hex'),
      contentKey: MACHINE('post-7'),
    });
    expect(row?.machineBody?.sha256).toBe(row?.sealedBody?.sha256);
    expect(row?.body).toBe('');
  });

  it('writes nothing when the second seal fails, and leaves the signature unspent', async () => {
    failOnCall = 2;
    const body = await signedPublish({ contentKey: 'post-8' });
    const response = await post(body);
    expect(response.status).toBe(503);
    expect(((await response.json()) as { error: string }).error).toContain('the committee did not answer');

    expect((await testDb().query('SELECT count(*)::int AS n FROM posts')).rows[0]?.n).toBe(0);

    const replay = await verifyAction({
      origin: ORIGIN, address, signature: body['signature'] as string,
      timestampMs: body['timestampMs'] as number,
      action: {
        kind: 'publish', handle: 'alice', title: 'Sold twice', access: 'paid',
        contentSha256: digestOf('the same words', 'The same words, sold twice.'),
        contentKey: 'post-8', price: '250000',
      },
    });
    expect(replay.ok).toBe(true);
  });

  it('refuses an untrimmed paid key before the signature is checked', async () => {
    const response = await post(await signedPublish({ contentKey: 'post-9 ', signature: 'not-a-signature' }));
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toContain('whitespace');
    expect(sealed).toHaveLength(0);
  });
});

describe('the pricing guard', () => {
  async function pre034(contentKey: string): Promise<void> {
    await addPost({
      id: `p-${contentKey}`, vaultId: normaliseAddress(VAULT), authorHandle: 'alice', createdAtMs: 1,
      title: `Old ${contentKey}`, preview: 'p', commentCount: 0, body: '',
      access: { kind: 'paid', price: '250000', contentKey },
      sealedBody: { blobId: 'b', endEpoch: 1, nonce: 'n', sealWrappedKey: 'k', sha256: 's' },
    });
  }

  it('quotes a machine edition for a key nothing is published under yet', async () => {
    expect(await machineBodyState(VAULT, 'fresh')).toBe('no-post');
    const response = await priceQuote(MACHINE('fresh'));
    expect(response.status).toBe(200);
    expect((await response.json()) as unknown).toEqual({ quote: { quoted: MACHINE('fresh') } });
  });

  it('quotes a machine edition for a post that carries a machine body', async () => {
    const published = await post(await signedPublish({ contentKey: 'post-10' }));
    expect(published.status).toBe(200);
    expect(await machineBodyState(VAULT, 'post-10')).toBe('sealed');
    expect((await priceQuote(MACHINE('post-10'))).status).toBe(200);
  });

  it('refuses to price the machine edition of a pre-034 post, naming why', async () => {
    await pre034('post-11');
    expect(await machineBodyState(VAULT, 'post-11')).toBe('absent');

    const response = await priceQuote(MACHINE('post-11'));
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: string; kind: string; machineBody: string };
    expect(body.kind).toBe('no-machine-body');
    expect(body.machineBody).toBe('absent');
    expect(body.error).toBe(`"post-11" ${NO_MACHINE_BODY}`);

    const read = await contentPrice(new Request(
      `${ORIGIN}/api/studio/content-price?vaultId=${VAULT}&contentKey=post-11`,
    ));
    expect(((await read.json()) as { machineBody: string }).machineBody).toBe('absent');
  });

  it('calls a key absent when ANY sealed post under it lacks a machine body', async () => {
    await pre034('season-1');
    expect((await post(await signedPublish({ contentKey: 'season-1', title: 'Episode 2' }))).status).toBe(200);
    expect(await machineBodyState(VAULT, 'season-1')).toBe('absent');
  });

  it('still quotes the human edition of a pre-034 post', async () => {
    await pre034('post-12');
    expect((await priceQuote('post-12')).status).toBe(200);
  });
});

describe('the schema', () => {
  const insert = (columns: Record<string, unknown>): Promise<unknown> => {
    const base: Record<string, unknown> = {
      id: 'raw', vault_id: normaliseAddress(VAULT), author_handle: 'alice', created_at_ms: 1,
      title: 't', preview: 'p', body: '', access_kind: 'paid', price: '250000', content_key: 'k',
      body_blob_id: 'b', body_end_epoch: 1, body_nonce: 'n', body_seal_wrapped_key: 'w', body_sha256: 's',
      ...columns,
    };
    const names = Object.keys(base);
    return testDb().query(
      `INSERT INTO posts (${names.join(', ')}) VALUES (${names.map((_, i) => `$${i + 1}`).join(', ')})`,
      names.map((n) => base[n]),
    );
  };
  const machine = {
    machine_blob_id: 'mb', machine_end_epoch: 1, machine_nonce: 'mn',
    machine_seal_wrapped_key: 'mw', machine_sha256: 'ms', machine_content_key: 'k#machine',
  };

  it('accepts all six machine columns on a sealed paid row', async () => {
    await expect(insert(machine)).resolves.toBeDefined();
  });

  it('refuses five of the six', async () => {
    await expect(insert({ ...machine, machine_content_key: null })).rejects.toThrow(/posts_machine_body_complete/);
  });

  it('refuses a machine body on a subscriber row', async () => {
    await expect(insert({ ...machine, access_kind: 'subscribers', price: null, content_key: null }))
      .rejects.toThrow(/posts_machine_body_complete/);
  });

  it('refuses a machine body where the human body was never sealed', async () => {
    await expect(insert({
      ...machine, body: 'words in the column',
      body_blob_id: null, body_end_epoch: null, body_nonce: null, body_seal_wrapped_key: null, body_sha256: null,
    })).rejects.toThrow(/posts_machine_body_complete/);
  });
});

describe('the purchases receipt', () => {
  it('titles a machine Unlock by the post it opens, and says which edition it is', async () => {
    expect((await post(await signedPublish({ contentKey: 'post-13', title: 'Thirteen' }))).status).toBe(200);
    unlocksHeld = [
      { id: `0x${'01'.repeat(32)}`, contentKey: MACHINE('post-13') },
      { id: `0x${'02'.repeat(32)}`, contentKey: 'post-13' },
    ];

    const purchases = await readPurchases(address);
    expect(purchases.ok).toBe(true);
    if (!purchases.ok) return;
    const byKey = new Map(purchases.value.unlocks.map((u) => [u.contentKey, u]));
    expect(byKey.get(MACHINE('post-13'))).toMatchObject({ title: 'Thirteen', edition: 'machine', handle: 'alice' });
    expect(byKey.get('post-13')).toMatchObject({ title: 'Thirteen', edition: 'human', handle: 'alice' });
  });
});
