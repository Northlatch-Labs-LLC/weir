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
import { createHash } from 'node:crypto';
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

/*
  The register's own objection to a pair — `operatorConflict` against real rows, and the routes
  refusing on it with 409 before any signature is spent.

  Mutations predicted: drop the first UNION branch → "a machine cannot answer for a machine" red;
  drop the second → "the person other machines answer for cannot become one" red; drop the window
  on the third → "an expired request is no objection" red; move the call after `verifyAction` in the
  declare route → the spent-signature assertion in the first test red.

  NOT RUN on 2026-09-03 when written: Postgres was not running on the laptop and was not started on
  an agent's own decision. It runs with the database project; if it is red, the code is wrong or this
  file is, and the report says which was not checked.
*/
const { operatorConflict } = await import('../lib/agents');

describe('operators and agents are disjoint sets', () => {
  const third = Ed25519Keypair.generate();
  const THIRD = third.toSuiAddress();

  /*
    `resetDatabase` truncates the content tables and nothing else, and the waiting-room tests above
    file AGENT into the register for real. Left there, that row makes "a fresh pair" not fresh and
    "AGENT was not recorded" false before this describe has done anything. Cleared for exactly the
    three addresses this describe uses — not the whole table — so a register row another suite is
    mid-assertion on is never removed from under it.
  */
  beforeEach(async () => {
    await testDb().query(
      'DELETE FROM agent_accounts WHERE address = ANY($1) OR operator_address = ANY($1)',
      [[AGENT, OPERATOR, THIRD]],
    );
  });

  async function fileRow(agentAddress: string, operatorAddress: string) {
    await testDb().query(
      `INSERT INTO agent_accounts (address, operator_address, agent_signature, operator_signature, model, purpose, declared_at_ms)
       VALUES ($1, $2, $3, $4, 'm', 'p', $5)`,
      [agentAddress, operatorAddress, `sig-a-${agentAddress}`, `sig-o-${operatorAddress}`, Date.now()],
    );
  }

  it('a fresh pair the register knows nothing about is no conflict — the residual gap, stated', async () => {
    expect(await operatorConflict(AGENT, OPERATOR)).toBeNull();
  });

  it('a machine cannot answer for a machine: an operator who is a live declared agent', async () => {
    await fileRow(OPERATOR, THIRD); // OPERATOR is itself an agent, operated by THIRD
    const why = await operatorConflict(AGENT, OPERATOR);
    expect(why).toMatch(/is itself a declared agent/);

    // The declare route refuses on it with 409 and spends neither signature.
    const issued = Date.now();
    const agentSig = await agentHalf(issued);
    const r = await postDeclare({ address: AGENT, operatorAddress: OPERATOR, model: MODEL, purpose: PURPOSE, timestampMs: issued, agentSignature: agentSig, operatorSignature: await operatorHalf(issued) });
    expect(r.status, await r.clone().text()).toBe(409);
    // `verifyAction` spends by SHA-256 of the signature string (lib/identity.ts); the same digest here.
    const spent = await testDb().query('SELECT 1 FROM used_signatures WHERE digest = $1', [createHash('sha256').update(agentSig).digest()]);
    expect(spent.rowCount).toBe(0);
    const rows = await testDb().query('SELECT 1 FROM agent_accounts WHERE address = $1', [AGENT]);
    expect(rows.rowCount).toBe(0);
  });

  it('a revoked declaration is no objection: the relationship ended', async () => {
    await fileRow(OPERATOR, THIRD);
    await testDb().query('UPDATE agent_accounts SET revoked_at_ms = $2 WHERE address = $1', [OPERATOR, Date.now()]);
    expect(await operatorConflict(AGENT, OPERATOR)).toBeNull();
  });

  it('the person other machines answer for cannot become one: an agent who is a live operator', async () => {
    await fileRow(THIRD, AGENT); // AGENT operates THIRD
    expect(await operatorConflict(AGENT, OPERATOR)).toMatch(/is the declared operator of other agents/);
  });

  it('the two-key loop is refused at its second declaration', async () => {
    await fileRow(AGENT, OPERATOR); // A operated by B
    expect(await operatorConflict(OPERATOR, AGENT)).toMatch(/is itself a declared agent/); // B by A: A is an agent
  });

  it('an address with a live request to be declared cannot be named as an operator; an expired request is no objection', async () => {
    const issued = Date.now();
    await testDb().query(
      `INSERT INTO agent_declaration_requests (address, operator_address, model, purpose, issued_at_ms, agent_signature, created_at_ms)
       VALUES ($1, $2, 'm', 'p', $3, 'sig', $3)`,
      [OPERATOR, THIRD, issued],
    );
    expect(await operatorConflict(AGENT, OPERATOR)).toMatch(/has a live request to be declared an agent/);
    // The waiting room refuses the half too, before proving it.
    const r = await postPending({ address: AGENT, operatorAddress: OPERATOR, model: MODEL, purpose: PURPOSE, timestampMs: issued, agentSignature: await agentHalf(issued) });
    expect(r.status, await r.clone().text()).toBe(409);
    // Once the window has passed, the request is dead and the pair is clean.
    expect(await operatorConflict(AGENT, OPERATOR, issued + SIGNATURE_WINDOW_MS + 1)).toBeNull();
  });
});
