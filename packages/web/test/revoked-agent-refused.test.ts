// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { createHash } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { closeDatabase, resetDatabase, testDb, useTestDatabase } from './helpers/database';

useTestDatabase();

const ORIGIN = 'https://weir.social';
const PACKAGE = `0x${'e5'.repeat(32)}`;
const BOT_VAULT = `0x${'b0'.repeat(32)}`;
const HUMAN_VAULT = `0x${'a1'.repeat(32)}`;
const TABLE = `0x${'c3'.repeat(32)}`;
const COIN = '0xdba34672::usdc::USDC';

const agent = new Ed25519Keypair();
const AGENT = agent.getPublicKey().toSuiAddress();
const human = new Ed25519Keypair();
const HUMAN = human.getPublicKey().toSuiAddress();
const OPERATOR = new Ed25519Keypair().getPublicKey().toSuiAddress();
const FRIEND = new Ed25519Keypair().getPublicKey().toSuiAddress();

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
  createClient: () => ({}),
  readCreatorVault: async (_client: unknown, vaultId: string) => ({
    ok: true,
    value: {
      owner: vaultId.toLowerCase().includes('b0') ? AGENT : HUMAN,
      contentPricesTableId: TABLE,
      tiers: [{ active: true }],
    },
    observedAtMs: 0,
  }),
  readContentPrice: async () => ({ ok: true, value: 250_000n, observedAtMs: 0 }),
}));

const sealed: Array<{ contentKey: string; body: string }> = [];

vi.mock('@/lib/body-storage', () => ({
  storeBody: async (input: { body: string; gate: { kind: string; contentKey?: string } }) => {
    sealed.push({ contentKey: input.gate.contentKey ?? '(period)', body: input.body });
    return {
      ok: true,
      observedAtMs: 0,
      value: {
        blobId: `blob:${sealed.length}`,
        endEpoch: 999,
        nonce: `nonce:${sealed.length}`,
        sealWrappedKey: `wrapped:${sealed.length}`,
        sha256: createHash('sha256').update(input.body).digest('hex'),
        bytes: input.body.length,
      },
    };
  },
}));

const { normaliseAddress } = await import('../lib/db');
const { statementFor } = await import('../lib/identity');
const { accessStatement } = await import('@projectx-social/sdk');
const { refuseWithdrawnDeclaration, WITHDRAWN_DECLARATION_REFUSAL } = await import('../lib/agent-standing');
const { POST: publish } = await import('../app/api/posts/route');
const { POST: send } = await import('../app/api/messages/route');

async function declare(address: string, revokedAtMs: number | null): Promise<void> {
  await testDb().query(
    `INSERT INTO agent_accounts
       (address, operator_address, agent_signature, operator_signature, model, purpose,
        declared_at_ms, revoked_at_ms)
     VALUES ($1, $2, 'sig-a', 'sig-o', 'claude', 'publishes', $3, $4)`,
    [normaliseAddress(address), normaliseAddress(OPERATOR), 1, revokedAtMs],
  );
}

const digestOf = (preview: string, text: string): string =>
  createHash('sha256').update(`${preview.length}:${preview}${text.length}:${text}`).digest('hex');

async function signedPublish(input: {
  who: Ed25519Keypair;
  handle: string;
  title: string;
  paid?: string;
  signature?: string;
}): Promise<Record<string, unknown>> {
  const address = input.who.getPublicKey().toSuiAddress();
  const preview = 'the opening';
  const text = 'The whole of it.';
  const access = input.paid === undefined ? 'public' : 'paid';
  const timestampMs = Date.now();
  const action = {
    kind: 'publish' as const,
    handle: input.handle,
    title: input.title,
    access: accessStatement(access, 0),
    contentSha256: digestOf(preview, text),
    contentKey: input.paid ?? '',
    price: input.paid === undefined ? '' : '250000',
  };
  const message = new TextEncoder().encode(statementFor(action, address, timestampMs, ORIGIN));
  const { signature } = await input.who.signPersonalMessage(message);
  return {
    handle: input.handle,
    author: address,
    title: input.title,
    preview,
    text,
    access,
    ...(input.paid === undefined ? {} : { contentKey: input.paid, price: '250000' }),
    signature: input.signature ?? signature,
    timestampMs,
  };
}

async function signedMessage(input: {
  who: Ed25519Keypair;
  text?: string;
  signature?: string;
}): Promise<Record<string, unknown>> {
  const address = input.who.getPublicKey().toSuiAddress();
  const text = input.text ?? 'A word with you.';
  const preview = 'A word';
  const timestampMs = Date.now();
  const message = new TextEncoder().encode(
    statementFor({ kind: 'send', to: FRIEND, text, preview, paid: '' }, address, timestampMs, ORIGIN),
  );
  const { signature } = await input.who.signPersonalMessage(message);
  return { from: address, to: FRIEND, preview, text, signature: input.signature ?? signature, timestampMs };
}

async function signedEncrypted(input: {
  who: Ed25519Keypair;
  signature?: string;
}): Promise<Record<string, unknown>> {
  const address = input.who.getPublicKey().toSuiAddress();
  const ciphertext = Buffer.from('opaque bytes').toString('base64');
  const timestampMs = Date.now();
  const { ciphertextDigest } = await import('../lib/e2e');
  const message = new TextEncoder().encode(
    statementFor(
      { kind: 'send-encrypted', to: FRIEND, ciphertextSha256: ciphertextDigest(ciphertext) },
      address,
      timestampMs,
      ORIGIN,
    ),
  );
  const { signature } = await input.who.signPersonalMessage(message);
  const envelope = (recipient: string) => ({
    recipient,
    ephemeralPublic: 'ZQ==',
    nonce: 'ZQ==',
    wrappedKey: 'ZQ==',
  });
  return {
    from: address,
    to: FRIEND,
    signature: input.signature ?? signature,
    timestampMs,
    encryption: { ciphertext, nonce: 'ZQ==', envelopes: [envelope(address), envelope(FRIEND)] },
  };
}

const post = (body: Record<string, unknown>): Promise<Response> =>
  publish(new Request(`${ORIGIN}/api/posts`, { method: 'POST', body: JSON.stringify(body) }));

const message = (body: Record<string, unknown>): Promise<Response> =>
  send(new Request(`${ORIGIN}/api/messages`, { method: 'POST', body: JSON.stringify(body) }));

const errorOf = async (response: Response): Promise<string> =>
  ((await response.clone().json()) as { error: string }).error;

const rowCount = async (table: string): Promise<number> =>
  ((await testDb().query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0] as { n: number }).n;

beforeEach(async () => {
  await resetDatabase();
  await testDb().query('DELETE FROM agent_accounts');
  await testDb().query(
    `INSERT INTO profiles (handle, vault_id, owner, display_name, bio, coin_type)
     VALUES ('bot', $1, $2, 'Bot', 'publishes', $5), ('alice', $3, $4, 'Alice', 'writes', $5)`,
    [normaliseAddress(BOT_VAULT), AGENT, normaliseAddress(HUMAN_VAULT), HUMAN, COIN],
  );
  sealed.length = 0;
});
afterAll(closeDatabase);

describe('the rule, against the register directly', () => {
  it('allows an address with no row', async () => {
    expect(await refuseWithdrawnDeclaration(HUMAN)).toBeNull();
  });

  it('allows a live declaration', async () => {
    await declare(AGENT, null);
    expect(await refuseWithdrawnDeclaration(AGENT)).toBeNull();
  });

  it('refuses a withdrawn declaration, and says how to come back', async () => {
    await declare(AGENT, 5);
    const refusal = await refuseWithdrawnDeclaration(AGENT);
    expect(refusal?.status).toBe(403);
    const body = (await refusal!.json()) as { error: string; revokedAtMs: number };
    expect(body.error).toBe(WITHDRAWN_DECLARATION_REFUSAL);
    expect(body.error).toContain('/api/agents/declare');
    expect(body.revokedAtMs).toBe(5);
  });

  it('refuses at the smallest revocation the table can hold', async () => {
    await declare(AGENT, 1);
    expect((await refuseWithdrawnDeclaration(AGENT))?.status).toBe(403);
  });

  it('allows an address the register cannot even parse, rather than inventing a row', async () => {
    expect(await refuseWithdrawnDeclaration('not-an-address')).toBeNull();
  });

  it('cannot hold a revocation at the zeroth millisecond', async () => {
    await expect(declare(AGENT, 0)).rejects.toThrow(/revoked_after_declared/);
  });

  it('cannot hold a declaration at the zeroth millisecond either', async () => {
    await expect(
      testDb().query(
        `INSERT INTO agent_accounts
           (address, operator_address, agent_signature, operator_signature, model, purpose,
            declared_at_ms, revoked_at_ms)
         VALUES ($1, $2, 'sig-a', 'sig-o', 'claude', 'publishes', 0, 0)`,
        [normaliseAddress(AGENT), normaliseAddress(OPERATOR)],
      ),
    ).rejects.toThrow(/declaration_is_dated/);
  });
});

describe('publishing', () => {
  it('lets a human with no declaration post normally', async () => {
    const response = await post(await signedPublish({ who: human, handle: 'alice', title: 'A person wrote this' }));
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await rowCount('posts')).toBe(1);
  });

  it('lets a live declared agent post', async () => {
    await declare(AGENT, null);
    const response = await post(await signedPublish({ who: agent, handle: 'bot', title: 'Still declared' }));
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await rowCount('posts')).toBe(1);
  });

  it('refuses a revoked agent, and writes nothing', async () => {
    await declare(AGENT, Date.now());
    const response = await post(await signedPublish({ who: agent, handle: 'bot', title: 'Withdrawn' }));
    expect(response.status).toBe(403);
    expect(await errorOf(response)).toBe(WITHDRAWN_DECLARATION_REFUSAL);
    expect(await rowCount('posts')).toBe(0);
  });

  it('spends no seal refusing a revoked agent a paid post', async () => {
    await declare(AGENT, Date.now());
    const response = await post(
      await signedPublish({ who: agent, handle: 'bot', title: 'Paid and withdrawn', paid: 'key-1' }),
    );
    expect(response.status).toBe(403);
    expect(sealed).toHaveLength(0);
    expect(await rowCount('posts')).toBe(0);
  });

  it('tells a forged caller 401, not 403 — the proof runs before the register', async () => {
    await declare(AGENT, Date.now());
    const response = await post(
      await signedPublish({ who: agent, handle: 'bot', title: 'Forged', signature: 'not-a-signature' }),
    );
    expect(response.status).toBe(401);
    expect(await errorOf(response)).not.toBe(WITHDRAWN_DECLARATION_REFUSAL);
  });
});

describe('sending a message', () => {
  it('lets a human with no declaration send normally', async () => {
    const response = await message(await signedMessage({ who: human }));
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await rowCount('messages')).toBe(1);
  });

  it('lets a live declared agent send', async () => {
    await declare(AGENT, null);
    const response = await message(await signedMessage({ who: agent }));
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await rowCount('messages')).toBe(1);
  });

  it('refuses a revoked agent, and writes nothing', async () => {
    await declare(AGENT, Date.now());
    const response = await message(await signedMessage({ who: agent }));
    expect(response.status).toBe(403);
    expect(await errorOf(response)).toBe(WITHDRAWN_DECLARATION_REFUSAL);
    expect(await rowCount('messages')).toBe(0);
  });

  it('tells a forged caller 401, not 403 — the proof runs before the register', async () => {
    await declare(AGENT, Date.now());
    const response = await message(await signedMessage({ who: agent, signature: 'not-a-signature' }));
    expect(response.status).toBe(401);
    expect(await errorOf(response)).not.toBe(WITHDRAWN_DECLARATION_REFUSAL);
  });
});

describe('sending an encrypted message', () => {
  it('lets a human with no declaration send normally', async () => {
    const response = await message(await signedEncrypted({ who: human }));
    expect(response.status, await response.clone().text()).toBe(200);
    expect(await rowCount('messages')).toBe(1);
  });

  it('refuses a revoked agent an encrypted message', async () => {
    await declare(AGENT, Date.now());
    const response = await message(await signedEncrypted({ who: agent }));
    expect(response.status).toBe(403);
    expect(await errorOf(response)).toBe(WITHDRAWN_DECLARATION_REFUSAL);
    expect(await rowCount('messages')).toBe(0);
  });

  it('tells a forged caller 401, not 403 — the proof runs before the register', async () => {
    await declare(AGENT, Date.now());
    const response = await message(await signedEncrypted({ who: agent, signature: 'not-a-signature' }));
    expect(response.status).toBe(401);
    expect(await errorOf(response)).not.toBe(WITHDRAWN_DECLARATION_REFUSAL);
  });
});
