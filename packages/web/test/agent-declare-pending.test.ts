// @vitest-environment node
// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/*
  The waiting room, end to end: an agent posts its half, the operator's list shows it, both halves
  file through the register route, and the list is empty again.

  Mutations predicted: skip the verification in POST pending → "a half that does not verify is
  refused" red; spend the signature in POST pending → "filing after a pending post succeeds" red
  (the register route would refuse the spent signature); drop the window filter in the list →
  "an expired request is not listed" red.
*/
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { SIGNATURE_WINDOW_MS, statementFor } from '@projectx-social/sdk';
import { closeDatabase, resetDatabase, testDb, useTestDatabase } from './helpers/database';

useTestDatabase();

const ORIGIN = 'https://weir.social';

vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => null, simulateLimit: async () => null }));
vi.mock('@/lib/chain', () => ({
  siteConfig: () => ({
    ok: true,
    value: { network: 'mainnet', grpcUrl: 'https://fullnode.example.invalid:443', packageId: `0x${'e5'.repeat(32)}` },
    observedAtMs: 0,
  }),
}));

const pending = await import('../app/api/agents/declare/pending/route');
const declare = await import('../app/api/agents/declare/route');

const agent = Ed25519Keypair.generate();
const operator = Ed25519Keypair.generate();
const AGENT = agent.toSuiAddress();
const OPERATOR = operator.toSuiAddress();
const MODEL = 'claude';
const PURPOSE = 'proves the waiting room';

async function agentHalf(issuedAtMs: number, over: Partial<{ operator: string }> = {}) {
  const text = statementFor({ kind: 'declare-agent', operator: over.operator ?? OPERATOR, model: MODEL, purpose: PURPOSE }, AGENT, issuedAtMs, ORIGIN);
  return (await agent.signPersonalMessage(new TextEncoder().encode(text))).signature;
}
async function operatorHalf(issuedAtMs: number) {
  const text = statementFor({ kind: 'declare-operator', agent: AGENT, model: MODEL, purpose: PURPOSE }, OPERATOR, issuedAtMs, ORIGIN);
  return (await operator.signPersonalMessage(new TextEncoder().encode(text))).signature;
}

const postPending = (body: unknown) =>
  pending.POST(new Request(`${ORIGIN}/api/agents/declare/pending`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
const listPending = (who: string) => pending.GET(new Request(`${ORIGIN}/api/agents/declare/pending?operator=${who}`));
const postDeclare = (body: unknown) =>
  declare.POST(new Request(`${ORIGIN}/api/agents/declare`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));

beforeEach(async () => {
  await resetDatabase();
  await testDb().query('DELETE FROM agent_declaration_requests');
});
afterAll(closeDatabase);

describe('the waiting room', () => {
  it('a half that verifies is kept, listed for its operator with the window, and filed on the operator’s signature', async () => {
    const issued = Date.now();
    const half = { address: AGENT, operatorAddress: OPERATOR, model: MODEL, purpose: PURPOSE, timestampMs: issued, agentSignature: await agentHalf(issued) };
    const posted = await postPending(half);
    expect(posted.status, await posted.clone().text()).toBe(201);
    const body = (await posted.json()) as { expiresAtMs: number; operatorPage: string };
    expect(body.expiresAtMs).toBe(issued + SIGNATURE_WINDOW_MS);
    expect(body.operatorPage).toBe('/agents/declare');

    const listed = (await (await listPending(OPERATOR)).json()) as { requests: Array<{ address: string; agentSignature: string; expiresAtMs: number }> };
    expect(listed.requests).toHaveLength(1);
    expect(listed.requests[0]).toMatchObject({ address: AGENT, agentSignature: half.agentSignature, expiresAtMs: issued + SIGNATURE_WINDOW_MS });

    // Another operator sees nothing: the list is per wallet.
    const other = (await (await listPending(Ed25519Keypair.generate().toSuiAddress())).json()) as { requests: unknown[] };
    expect(other.requests).toEqual([]);

    // The operator signs; the register route verifies both and files. The agent's signature was not spent by the waiting room.
    const filed = await postDeclare({ ...half, operatorSignature: await operatorHalf(issued) });
    expect(filed.status, await filed.clone().text()).toBe(201);

    const after = (await (await listPending(OPERATOR)).json()) as { requests: unknown[] };
    expect(after.requests).toEqual([]);
    const { rows } = await testDb().query<{ filed_at_ms: string | null }>('SELECT filed_at_ms FROM agent_declaration_requests WHERE address = $1', [AGENT]);
    expect(rows[0]?.filed_at_ms).not.toBeNull();
  });

  it('a half that does not verify is refused and never listed', async () => {
    const issued = Date.now();
    // Signed for a different operator than the one named in the body: the rebuilt statement differs.
    const r = await postPending({ address: AGENT, operatorAddress: OPERATOR, model: MODEL, purpose: PURPOSE, timestampMs: issued, agentSignature: await agentHalf(issued, { operator: Ed25519Keypair.generate().toSuiAddress() }) });
    expect(r.status).toBe(401);
    const listed = (await (await listPending(OPERATOR)).json()) as { requests: unknown[] };
    expect(listed.requests).toEqual([]);
  });

  it('a half carrying an operator signature is refused: this is the agent half only', async () => {
    const issued = Date.now();
    const r = await postPending({ address: AGENT, operatorAddress: OPERATOR, model: MODEL, purpose: PURPOSE, timestampMs: issued, agentSignature: await agentHalf(issued), operatorSignature: 'x' });
    expect(r.status).toBe(400);
  });

  it('an expired request is not listed, and a second post by the same agent replaces the first', async () => {
    const stale = Date.now() - SIGNATURE_WINDOW_MS - 1_000;
    // The route refuses a stale half outright — the window is checked at verification.
    expect((await postPending({ address: AGENT, operatorAddress: OPERATOR, model: MODEL, purpose: PURPOSE, timestampMs: stale, agentSignature: await agentHalf(stale) })).status).toBe(401);

    const first = Date.now() - 60_000;
    const second = Date.now();
    expect((await postPending({ address: AGENT, operatorAddress: OPERATOR, model: MODEL, purpose: PURPOSE, timestampMs: first, agentSignature: await agentHalf(first) })).status).toBe(201);
    expect((await postPending({ address: AGENT, operatorAddress: OPERATOR, model: MODEL, purpose: PURPOSE, timestampMs: second, agentSignature: await agentHalf(second) })).status).toBe(201);
    const listed = (await (await listPending(OPERATOR)).json()) as { requests: Array<{ issuedAtMs: number }> };
    expect(listed.requests).toHaveLength(1);
    expect(listed.requests[0]?.issuedAtMs).toBe(second);

    // Age the surviving row past the window in the table itself: the list must drop it.
    await testDb().query('UPDATE agent_declaration_requests SET issued_at_ms = $2 WHERE address = $1', [AGENT, stale]);
    const aged = (await (await listPending(OPERATOR)).json()) as { requests: unknown[] };
    expect(aged.requests).toEqual([]);
  });

  it('GET needs an operator and refuses a non-address', async () => {
    expect((await pending.GET(new Request(`${ORIGIN}/api/agents/declare/pending`))).status).toBe(400);
    expect((await listPending('not-an-address')).status).toBe(400);
  });
});
