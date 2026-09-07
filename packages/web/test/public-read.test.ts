// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/*
  The public read surface: one post as a stranger sees it, and the register as a list.

  Mutations predicted: hand out `post.body` regardless of access → "a gated post answers body
  null" red; drop the operator filter → "operator narrows the list" red; accept a malformed
  operator as "no filter" → "a malformed operator is refused" red.
*/
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDatabase, resetDatabase, testDb, useTestDatabase } from './helpers/database';

useTestDatabase();

vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => null, simulateLimit: async () => null }));

const { normaliseAddress } = await import('../lib/db');
const { addPost } = await import('../lib/content');
const { GET: readPost } = await import('../app/api/posts/[id]/route');
const { GET: listAgents } = await import('../app/api/agents/route');

const ORIGIN = 'https://weir.social';
const VAULT = `0x${'a1'.repeat(32)}`;
const OWNER = `0x${'b2'.repeat(32)}`;
const OP_A = `0x${'c3'.repeat(32)}`;
const OP_B = `0x${'d4'.repeat(32)}`;
const AGENT_1 = `0x${'e5'.repeat(32)}`;
const AGENT_2 = `0x${'f6'.repeat(32)}`;
const AGENT_GONE = `0x${'a7'.repeat(32)}`;

const get = (path: string, id?: string): Promise<Response> =>
  id === undefined
    ? listAgents(new Request(`${ORIGIN}${path}`))
    : readPost(new Request(`${ORIGIN}${path}`), { params: Promise.resolve({ id }) });

beforeEach(async () => {
  await resetDatabase();
  // The register is not part of the shared reset; this file owns its rows.
  await testDb().query('DELETE FROM agent_accounts');
  await testDb().query(
    `INSERT INTO profiles (handle, vault_id, owner, display_name, bio, coin_type) VALUES ('alice', $1, $2, 'Alice', 'writes', $3)`,
    [normaliseAddress(VAULT), OWNER, '0xdba34672::usdc::USDC'],
  );
  await addPost({
    id: 'p-open', vaultId: normaliseAddress(VAULT), authorHandle: 'alice', createdAtMs: 1_756_700_000_000,
    title: 'Open', preview: 'a taste', commentCount: 0, body: 'the whole public thing', access: { kind: 'public' },
  });
  await addPost({
    id: 'p-gated', vaultId: normaliseAddress(VAULT), authorHandle: 'alice', createdAtMs: 1_756_700_001_000,
    // Words in the row on purpose: the test proves they are WITHHELD, not merely that nothing was stored.
    title: 'Gated', preview: 'a taste', commentCount: 0, body: 'the words a stranger must not see', access: { kind: 'subscribers', tier: 1 },
    // The tier is read back from the sealed body's gate, as the publish route records it.
    sealedBody: { blobId: 'blob:gated', endEpoch: 999, nonce: 'n', sealWrappedKey: 'w', sha256: 'x'.repeat(64), tier: '1', period: '1' },
  });
  for (const [address, operator, revoked] of [
    [AGENT_1, OP_A, null],
    [AGENT_2, OP_B, null],
    [AGENT_GONE, OP_A, 1_756_700_000_000],
  ] as const) {
    await testDb().query(
      `INSERT INTO agent_accounts (address, operator_address, agent_signature, operator_signature, model, purpose, declared_at_ms, revoked_at_ms)
       VALUES ($1, $2, 'sig-a', 'sig-o', 'model-x', 'tests things', 1756700000000, $3)`,
      [normaliseAddress(address), normaliseAddress(operator), revoked],
    );
  }
});
afterAll(closeDatabase);

describe('GET /api/posts/{id}', () => {
  it('hands a public post\'s body to anyone, and says how it was entitled', async () => {
    const r = await get('/api/posts/p-open', 'p-open');
    expect(r.status).toBe(200);
    const body = (await r.json()) as { post: { id: string; handle: string; access: { kind: string } }; body: string; entitledVia: string };
    expect(body.post.handle).toBe('alice');
    expect(body.body).toBe('the whole public thing');
    expect(body.entitledVia).toBe('public');
  });

  it('a gated post answers body null with its access, never the words', async () => {
    const r = await get('/api/posts/p-gated', 'p-gated');
    expect(r.status).toBe(200);
    const body = (await r.json()) as { post: { access: { kind: string; tier: number } }; body: unknown; entitledVia: unknown };
    expect(body.post.access).toEqual({ kind: 'subscribers', tier: 1 });
    expect(body.body).toBeNull();
    expect(body.entitledVia).toBeNull();
    expect(JSON.stringify(body)).not.toContain('a stranger must not see');
  });

  it('404 for an unknown id', async () => {
    expect((await get('/api/posts/nope', 'nope')).status).toBe(404);
  });
});

describe('GET /api/agents', () => {
  it('lists every standing declaration without its signatures', async () => {
    const r = await get('/api/agents');
    expect(r.status).toBe(200);
    const body = (await r.json()) as { agents: Array<Record<string, unknown>>; count: number };
    expect(body.count).toBe(2);
    expect(body.agents.map((a) => a['address']).sort()).toEqual([normaliseAddress(AGENT_1), normaliseAddress(AGENT_2)].sort());
    expect(body.agents[0]).not.toHaveProperty('agentSignature');
  });

  it('operator narrows the list to one fleet', async () => {
    const r = await get(`/api/agents?operator=${OP_A}`);
    const body = (await r.json()) as { agents: Array<{ address: string }>; count: number; operator: string };
    expect(body.count).toBe(1);
    expect(body.agents[0]?.address).toBe(normaliseAddress(AGENT_1));
    expect(body.operator).toBe(normaliseAddress(OP_A));
  });

  it('a malformed operator is refused rather than read as no filter', async () => {
    const r = await get('/api/agents?operator=bob');
    expect(r.status).toBe(400);
  });
});
