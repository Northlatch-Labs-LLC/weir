// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/**
 * A declaration that has been withdrawn stops writing — and nothing else does.
 *
 * # The hole this closes
 *
 * `POST /api/agents/mind` consults the register. `POST /api/posts` and `POST /api/messages` did not,
 * anywhere: neither file contained the string `agentAccount` or `revokedAtMs`. So an operator could
 * withdraw a declaration and the agent carried on publishing and messaging, because the two routes
 * it publishes and messages through never asked.
 *
 * # The rule under test, in three states and not two
 *
 *   no row                  -> allowed. A person, or a machine nobody declared. Indistinguishable.
 *   row, revokedAtMs null   -> allowed.
 *   row, revokedAtMs set    -> 403.
 *
 * The third case is the feature and the first case is what keeps it from being a wall. `lib/agents.ts`
 * has three readers that filter `revoked_at_ms IS NULL` in SQL, and any of them would collapse the
 * first and third states into one — so "a human posts normally" is here as an assertion with the
 * same standing as the refusal, not as a smoke test.
 *
 * # Real routes, real database, real signatures, stub sealer
 *
 * The handlers, the signature proofs, the transactions and the rows are real. Only `storeBody` is a
 * stub, because it reaches Walrus and a Seal committee — and it RECORDS what it was handed, which is
 * how the ordering claim below is checked rather than asserted.
 *
 * # Mutations these must catch (predicted before the run, results in the report)
 *
 *   1. Delete the guard from `posts` -> "refuses a revoked agent" red.
 *   2. Delete the guard from `messages` (open path) -> "refuses a revoked agent" red.
 *   3. Delete the guard from `sendEncrypted` -> "refuses a revoked agent an encrypted message" red.
 *   4. Move the guard ABOVE the proof in either route -> "a forged caller is told 401, not 403" red,
 *      in that route: the forged request would be refused for the register's reason before the
 *      signature was ever checked.
 *   5. Move the guard BELOW `sealBothEditions` in `posts` -> "spends no seal" red: the platform
 *      would have paid two Walrus leases for a post it then refused.
 *   6. Build the helper on `declaredAgents`/`listDeclaredAgents` instead of `agentAccount` -> "lets a
 *      human with no declaration post" red: a revoked row and an absent row become the same answer,
 *      and whichever way that answer falls, one of these two tests goes red.
 *   7. Treat `revokedAtMs` as truthy (`if (!account.revokedAtMs)`) rather than testing it against
 *      null -> NOTHING RED, and this was run rather than guessed. It is an EQUIVALENT MUTANT, and
 *      only because of two CHECK constraints in `db/023_agent_accounts.sql`: `declared_at_ms > 0`
 *      and `revoked_at_ms >= declared_at_ms`. Together they make `revoked_at_ms = 0` — the single
 *      value at which truthiness and a null test disagree — unrepresentable, so the substitution
 *      cannot change any behaviour the table can reach. That is a fact about the schema and not
 *      about this file, so the last two cases below pin the constraints themselves: migrate either
 *      one away and the equivalence stops holding, and a red test says so instead of nobody
 *      noticing.
 */

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

/** The declared machine. Its register row is written per test, or not at all. */
const agent = new Ed25519Keypair();
const AGENT = agent.getPublicKey().toSuiAddress();
/** A person. Never in the register, in any test in this file. */
const human = new Ed25519Keypair();
const HUMAN = human.getPublicKey().toSuiAddress();
/** Who answers for the agent. Only ever an operator, so it never collides with the rule. */
const OPERATOR = new Ed25519Keypair().getPublicKey().toSuiAddress();
/** The other end of a message. Holds nothing and is never declared. */
const FRIEND = new Ed25519Keypair().getPublicKey().toSuiAddress();

vi.mock('@/lib/rate-limit', () => ({
  rateLimit: () => null,
  simulateLimit: async () => null,
}));

vi.mock('@/lib/chain', () => ({
  siteConfig: () => ({
    ok: true,
    value: { network: 'mainnet', grpcUrl: 'https://fullnode.example.invalid:443', packageId: PACKAGE },
    observedAtMs: 0,
  }),
}));

/*
  The chain at the fidelity these routes read it: each vault answers with its own owner, so the
  authorship check in both routes passes for the right caller and fails for the wrong one — which
  keeps a 403 from this file's guard from being confused with the 403 the ownership check already
  produced.
*/
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

/** The sealer, recording. Every Walrus lease the platform would have paid for lands here. */
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

/* ---------------------------------------------------------------------------------------------
 * The register, written the way a real declaration writes it. Signatures are opaque text to this
 * table (023 checks only that the two differ), so the row is honest about its shape without
 * needing two more real signatures per test.
 * ------------------------------------------------------------------------------------------- */

async function declare(address: string, revokedAtMs: number | null): Promise<void> {
  await testDb().query(
    `INSERT INTO agent_accounts
       (address, operator_address, agent_signature, operator_signature, model, purpose,
        declared_at_ms, revoked_at_ms)
     VALUES ($1, $2, 'sig-a', 'sig-o', 'claude', 'publishes', $3, $4)`,
    [normaliseAddress(address), normaliseAddress(OPERATOR), 1, revokedAtMs],
  );
}

/* ---------------------------------------------------------------------------------------------
 * Signed requests. `contentDigest` in the route, reproduced: length-prefixed preview then body.
 * ------------------------------------------------------------------------------------------- */

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
  // `resetDatabase` deliberately leaves `agent_accounts` alone — it truncates the content tables
  // only — so the register is cleared here, exactly as `agent-mind.test.ts` does it.
  await testDb().query('DELETE FROM agent_accounts');
  await testDb().query(
    `INSERT INTO profiles (handle, vault_id, owner, display_name, bio, coin_type)
     VALUES ('bot', $1, $2, 'Bot', 'publishes', $5), ('alice', $3, $4, 'Alice', 'writes', $5)`,
    [normaliseAddress(BOT_VAULT), AGENT, normaliseAddress(HUMAN_VAULT), HUMAN, COIN],
  );
  sealed.length = 0;
});
afterAll(closeDatabase);

/* =============================================================================================
 * The helper on its own. Three states, read straight from the register.
 * ========================================================================================== */

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
    // `declared_at_ms = revoked_at_ms = 1`: withdrawn in the same millisecond it was declared, which
    // is the tightest boundary a real row can reach. The two cases at the end of this describe say
    // why nothing smaller exists.
    await declare(AGENT, 1);
    expect((await refuseWithdrawnDeclaration(AGENT))?.status).toBe(403);
  });

  it('allows an address the register cannot even parse, rather than inventing a row', async () => {
    // `agentAccount` normalises and returns null for anything that is not an address. That is the
    // "no row" case, and the caller is a request that will fail its own signature check anyway.
    expect(await refuseWithdrawnDeclaration('not-an-address')).toBeNull();
  });

  /*
    The two constraints that make a truthiness test indistinguishable from a null test here.

    `lib/agent-standing.ts` asks `revokedAtMs === null`. Writing `!account.revokedAtMs` instead
    changes behaviour at exactly one value, 0 — and these two CHECKs together mean no row can carry
    it. That is why mutating the guard that way leaves this whole file green: the mutant is
    equivalent, not undetected.

    It is equivalent only while both constraints stand, which is a property of the schema and not of
    the guard. So they are asserted here, next to the reasoning that depends on them.
  */
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

/* =============================================================================================
 * POST /api/posts
 * ========================================================================================== */

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
    /*
      The ordering claim, checked rather than asserted. `sealBothEditions` takes two Walrus leases
      the platform pays for, and `readContentPrice` is a chain call. Both sit below the guard; if
      the guard moved under them, this refusal would arrive after the platform had bought the thing
      it was refusing.
    */
    await declare(AGENT, Date.now());
    const response = await post(
      await signedPublish({ who: agent, handle: 'bot', title: 'Paid and withdrawn', paid: 'key-1' }),
    );
    expect(response.status).toBe(403);
    expect(sealed).toHaveLength(0);
    expect(await rowCount('posts')).toBe(0);
  });

  it('tells a forged caller 401, not 403 — the proof runs before the register', async () => {
    /*
      THE ORDERING TEST. A garbage signature naming the revoked agent.

      With the guard after the proof, this is 401: the signature never proved anybody, so the
      register is never asked. With the guard hoisted above the proof, it is 403 — and that route
      would answer questions about an address the caller has not shown they hold, on a value taken
      straight from the request body.
    */
    await declare(AGENT, Date.now());
    const response = await post(
      await signedPublish({ who: agent, handle: 'bot', title: 'Forged', signature: 'not-a-signature' }),
    );
    expect(response.status).toBe(401);
    expect(await errorOf(response)).not.toBe(WITHDRAWN_DECLARATION_REFUSAL);
  });
});

/* =============================================================================================
 * POST /api/messages — both paths, each against its own proof
 * ========================================================================================== */

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
    /*
      `sendEncrypted` is a separate function with its own `verifyAction`, so it needs its own guard.
      One check in the caller before the branch would run before this path's signature — earlier
      than the proof, which is the ordering the rule forbids.
    */
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
