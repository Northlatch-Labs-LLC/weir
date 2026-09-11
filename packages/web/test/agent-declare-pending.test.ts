// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
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
const declarationStoreFault = vi.hoisted(() => ({ next: null as string | null }));
vi.mock('@/lib/agent-declarations', async (importActual) => {
  const actual = await importActual<typeof import('../lib/agent-declarations')>();
  return {
    ...actual,
    recordDeclarationRequest: async (input: Parameters<typeof actual.recordDeclarationRequest>[0]) => {
      if (declarationStoreFault.next !== null) {
        const message = declarationStoreFault.next;
        declarationStoreFault.next = null;
        throw new Error(message);
      }
      return actual.recordDeclarationRequest(input);
    },
  };
});

const declarationRecordFault = vi.hoisted(() => ({ next: null as string | null }));
vi.mock('@/lib/agents', async (importActual) => {
  const actual = await importActual<typeof import('../lib/agents')>();
  return {
    ...actual,
    recordDeclaration: async (...args: Parameters<typeof actual.recordDeclaration>) => {
      if (declarationRecordFault.next !== null) {
        const message = declarationRecordFault.next;
        declarationRecordFault.next = null;
        throw new Error(message);
      }
      return actual.recordDeclaration(...args);
    },
  };
});

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

    const other = (await (await listPending(Ed25519Keypair.generate().toSuiAddress())).json()) as { requests: unknown[] };
    expect(other.requests).toEqual([]);

    const filed = await postDeclare({ ...half, operatorSignature: await operatorHalf(issued) });
    expect(filed.status, await filed.clone().text()).toBe(201);

    const after = (await (await listPending(OPERATOR)).json()) as { requests: unknown[] };
    expect(after.requests).toEqual([]);
    const { rows } = await testDb().query<{ filed_at_ms: string | null }>('SELECT filed_at_ms FROM agent_declaration_requests WHERE address = $1', [AGENT]);
    expect(rows[0]?.filed_at_ms).not.toBeNull();
  });

  it('a half that does not verify is refused and never listed', async () => {
    const issued = Date.now();
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
    expect((await postPending({ address: AGENT, operatorAddress: OPERATOR, model: MODEL, purpose: PURPOSE, timestampMs: stale, agentSignature: await agentHalf(stale) })).status).toBe(401);

    const first = Date.now() - 60_000;
    const second = Date.now();
    expect((await postPending({ address: AGENT, operatorAddress: OPERATOR, model: MODEL, purpose: PURPOSE, timestampMs: first, agentSignature: await agentHalf(first) })).status).toBe(201);
    expect((await postPending({ address: AGENT, operatorAddress: OPERATOR, model: MODEL, purpose: PURPOSE, timestampMs: second, agentSignature: await agentHalf(second) })).status).toBe(201);
    const listed = (await (await listPending(OPERATOR)).json()) as { requests: Array<{ issuedAtMs: number }> };
    expect(listed.requests).toHaveLength(1);
    expect(listed.requests[0]?.issuedAtMs).toBe(second);

    await testDb().query('UPDATE agent_declaration_requests SET issued_at_ms = $2 WHERE address = $1', [AGENT, stale]);
    const aged = (await (await listPending(OPERATOR)).json()) as { requests: unknown[] };
    expect(aged.requests).toEqual([]);
  });

  it('GET needs an operator and refuses a non-address', async () => {
    expect((await pending.GET(new Request(`${ORIGIN}/api/agents/declare/pending`))).status).toBe(400);
    expect((await listPending('not-an-address')).status).toBe(400);
  });

  it('a write that throws after the signature verifies answers a fixed sentence, never the raw database error — Security F1, 2026-09-04', async () => {
    declarationStoreFault.next = 'duplicate key value violates unique constraint "agent_declaration_requests_pkey" on agent_declaration_requests';
    const issued = Date.now();
    const r = await postPending({ address: AGENT, operatorAddress: OPERATOR, model: MODEL, purpose: PURPOSE, timestampMs: issued, agentSignature: await agentHalf(issued) });
    expect(r.status).toBe(503);
    const body = (await r.json()) as { error: string };
    expect(body.error).toBe('the request verified but the register is not reachable just now — try again');
    expect(body.error).not.toContain('constraint');
    expect(body.error).not.toContain('agent_declaration_requests');

    expect(declarationStoreFault.next).toBeNull();
    const retried = await postPending({ address: AGENT, operatorAddress: OPERATOR, model: MODEL, purpose: PURPOSE, timestampMs: issued, agentSignature: await agentHalf(issued) });
    expect(retried.status, await retried.clone().text()).toBe(201);
  });

  it('the register route: a write that throws after both signatures verify answers a fixed sentence, never the raw database error — Security F1, 2026-09-04', async () => {
    declarationRecordFault.next = 'duplicate key value violates unique constraint "agent_accounts_pkey" on agent_accounts';
    const issued = Date.now();
    const half = { address: AGENT, operatorAddress: OPERATOR, model: MODEL, purpose: PURPOSE, timestampMs: issued, agentSignature: await agentHalf(issued) };
    const r = await postDeclare({ ...half, operatorSignature: await operatorHalf(issued) });
    expect(r.status).toBe(503);
    const body = (await r.json()) as { error: string };
    expect(body.error).toBe('both signatures verified but the register is not reachable just now — try again');
    expect(body.error).not.toContain('constraint');
    expect(body.error).not.toContain('agent_accounts');

    expect(declarationRecordFault.next).toBeNull();
    const freshIssued = Date.now() + 1;
    const freshHalf = { address: AGENT, operatorAddress: OPERATOR, model: MODEL, purpose: PURPOSE, timestampMs: freshIssued, agentSignature: await agentHalf(freshIssued) };
    const retried = await postDeclare({ ...freshHalf, operatorSignature: await operatorHalf(freshIssued) });
    expect(retried.status, await retried.clone().text()).toBe(201);
  });
});

const { operatorConflict } = await import('../lib/agents');

describe('operators and agents are disjoint sets', () => {
  const third = Ed25519Keypair.generate();
  const THIRD = third.toSuiAddress();

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
    await fileRow(OPERATOR, THIRD);
    const why = await operatorConflict(AGENT, OPERATOR);
    expect(why).toMatch(/is itself a declared agent/);

    const issued = Date.now();
    const agentSig = await agentHalf(issued);
    const r = await postDeclare({ address: AGENT, operatorAddress: OPERATOR, model: MODEL, purpose: PURPOSE, timestampMs: issued, agentSignature: agentSig, operatorSignature: await operatorHalf(issued) });
    expect(r.status, await r.clone().text()).toBe(409);
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
    await fileRow(THIRD, AGENT);
    expect(await operatorConflict(AGENT, OPERATOR)).toMatch(/is the declared operator of other agents/);
  });

  it('the two-key loop is refused at its second declaration', async () => {
    await fileRow(AGENT, OPERATOR);
    expect(await operatorConflict(OPERATOR, AGENT)).toMatch(/is itself a declared agent/);
  });

  it('an address with a live request to be declared cannot be named as an operator; an expired request is no objection', async () => {
    const issued = Date.now();
    await testDb().query(
      `INSERT INTO agent_declaration_requests (address, operator_address, model, purpose, issued_at_ms, agent_signature, created_at_ms)
       VALUES ($1, $2, 'm', 'p', $3, 'sig', $3)`,
      [OPERATOR, THIRD, issued],
    );
    expect(await operatorConflict(AGENT, OPERATOR)).toMatch(/has a live request to be declared an agent/);
    const r = await postPending({ address: AGENT, operatorAddress: OPERATOR, model: MODEL, purpose: PURPOSE, timestampMs: issued, agentSignature: await agentHalf(issued) });
    expect(r.status, await r.clone().text()).toBe(409);
    expect(await operatorConflict(AGENT, OPERATOR, issued + SIGNATURE_WINDOW_MS + 1)).toBeNull();
  });
});
