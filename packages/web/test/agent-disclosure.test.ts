// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { verifyPersonalMessageSignature } from '@mysten/sui/verify';

const ORIGIN = 'https://weir.social';

const identity = await vi.importActual<typeof import('../lib/identity')>('../lib/identity');
const { statementFor } = identity;

const recordDeclaration = vi.fn();

const verifyAction = vi.fn(
  async (input: {
    address: string;
    signature: string;
    timestampMs: number;
    action: Parameters<typeof statementFor>[0];
  }) => {
    const message = new TextEncoder().encode(
      statementFor(input.action, input.address, input.timestampMs, ORIGIN),
    );
    try {
      await verifyPersonalMessageSignature(message, input.signature, { address: input.address });
      return { ok: true as const, value: true as const };
    } catch (error) {
      return {
        ok: false as const,
        failure: {
          detail: `the signature does not prove control of ${input.address}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        },
      };
    }
  },
);

const agentAccount = vi.fn();
const operatorConflict = vi.fn<(agent: string, operator: string) => Promise<string | null>>(async () => null);

vi.mock('@/lib/rate-limit', () => ({
  simulateLimit: async () => null, rateLimit: () => null }));
vi.mock('@/lib/identity', async () => {
  const real = await vi.importActual<typeof import('../lib/identity')>('../lib/identity');
  return {
    ...real,
    verifyAction: (...args: [Parameters<typeof verifyAction>[0]]) => verifyAction(...args),
  };
});
// This file is about what two signatures mean, not about adoption. It runs without a database, so
// the register is declared to hold no offer for these pairs: every case here is the direct path,
// where both parties are present and the transaction window applies. Left unmocked the lookup
// would throw on the missing database and the route would answer 503 to every case, which is the
// correct answer to a broken register and a useless one to ask a signature question of.
vi.mock('@/lib/agent-seeking', async (importActual) => ({
  ...(await importActual<typeof import('../lib/agent-seeking')>()),
  unfiledOfferFor: async () => null,
  markOfferFiled: async () => false,
  markSeekingClaimed: async () => false,
}));

vi.mock('@/lib/agents', async () => {
  const real = await vi.importActual<typeof import('../lib/agents')>('../lib/agents');
  return {
    ...real,
    recordDeclaration: (...args: unknown[]) => recordDeclaration(...args),
    agentAccount: (...args: unknown[]) => agentAccount(...args),
    operatorConflict: (agent: string, operator: string) => operatorConflict(agent, operator),
  };
});

const { POST } = await import('../app/api/agents/declare/route');
const { GET } = await import('../app/api/agents/[address]/route');

const agent = new Ed25519Keypair();
const operator = new Ed25519Keypair();
const impostor = new Ed25519Keypair();

const AGENT = agent.getPublicKey().toSuiAddress();
const OPERATOR = operator.getPublicKey().toSuiAddress();
const IMPOSTOR = impostor.getPublicKey().toSuiAddress();

const MODEL = 'claude-opus-5';
const PURPOSE = 'Publishes protocol measurements and answers questions about them';

async function signAsAgent(operatorAddress: string, timestampMs: number, model = MODEL, purpose = PURPOSE) {
  const message = new TextEncoder().encode(
    statementFor({ kind: 'declare-agent', operator: operatorAddress, model, purpose }, AGENT, timestampMs, ORIGIN),
  );
  return (await agent.signPersonalMessage(message)).signature;
}

async function signAsOperator(agentAddress: string, timestampMs: number, model = MODEL, purpose = PURPOSE) {
  const message = new TextEncoder().encode(
    statementFor({ kind: 'declare-operator', agent: agentAddress, model, purpose }, OPERATOR, timestampMs, ORIGIN),
  );
  return (await operator.signPersonalMessage(message)).signature;
}

function declare(body: unknown): Request {
  return new Request('http://localhost/api/agents/declare', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function honest(timestampMs = Date.now()) {
  return {
    address: AGENT,
    operatorAddress: OPERATOR,
    model: MODEL,
    purpose: PURPOSE,
    timestampMs,
    agentSignature: await signAsAgent(OPERATOR, timestampMs),
    operatorSignature: await signAsOperator(AGENT, timestampMs),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  recordDeclaration.mockImplementation(async (d: Record<string, unknown>) => ({
    ...d,
    revokedAtMs: null,
    declaredAtMs: d['timestampMs'],
  }));
});

describe('the bytes each party signs', () => {
  const AT = 1_756_600_000_000;

  it('has the agent say who operates it', () => {
    expect(
      statementFor({ kind: 'declare-agent', operator: OPERATOR, model: MODEL, purpose: PURPOSE }, AGENT, AT, ORIGIN),
    ).toBe(
      `Weir\naddress: ${AGENT}\nissued: ${AT}\norigin: ${ORIGIN}\naction: declare agent\noperated by: ${OPERATOR}\nmodel: ${MODEL}\npurpose: ${PURPOSE}`,
    );
  });

  it('has the operator say what they operate', () => {
    expect(
      statementFor({ kind: 'declare-operator', agent: AGENT, model: MODEL, purpose: PURPOSE }, OPERATOR, AT, ORIGIN),
    ).toBe(
      `Weir\naddress: ${OPERATOR}\nissued: ${AT}\norigin: ${ORIGIN}\naction: declare operator\noperating: ${AGENT}\nmodel: ${MODEL}\npurpose: ${PURPOSE}`,
    );
  });

  it('binds both addresses into both halves', () => {
    const a = statementFor({ kind: 'declare-agent', operator: OPERATOR, model: MODEL, purpose: PURPOSE }, AGENT, AT, ORIGIN);
    const o = statementFor({ kind: 'declare-operator', agent: AGENT, model: MODEL, purpose: PURPOSE }, OPERATOR, AT, ORIGIN);
    for (const statement of [a, o]) {
      expect(statement).toContain(AGENT);
      expect(statement).toContain(OPERATOR);
    }
  });

  it('cannot be confused with each other', () => {
    const a = statementFor({ kind: 'declare-agent', operator: OPERATOR, model: MODEL, purpose: PURPOSE }, AGENT, AT, ORIGIN);
    const o = statementFor({ kind: 'declare-operator', agent: AGENT, model: MODEL, purpose: PURPOSE }, OPERATOR, AT, ORIGIN);
    expect(a).not.toBe(o);
    expect(a).toContain('action: declare agent');
    expect(o).toContain('action: declare operator');
  });
});

describe('two signatures', () => {
  it('is accepted, and files the pair', async () => {
    const response = await POST(declare(await honest()));
    expect(response.status).toBe(201);
    expect(recordDeclaration).toHaveBeenCalledTimes(1);
    const filed = recordDeclaration.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(filed['address']).toBe(AGENT);
    expect(filed['operatorAddress']).toBe(OPERATOR);
    expect(filed['model']).toBe(MODEL);
  });

  it('is verified twice, against two different addresses', async () => {
    await POST(declare(await honest()));
    expect(verifyAction).toHaveBeenCalledTimes(2);
    const [first, second] = verifyAction.mock.calls.map((call) => call[0]);
    expect(first?.address).toBe(AGENT);
    expect(first?.action.kind).toBe('declare-agent');
    expect(second?.address).toBe(OPERATOR);
    expect(second?.action.kind).toBe('declare-operator');
  });
});

describe('one signature is refused', () => {
  it('refuses a declaration with no operator signature at all', async () => {
    const body = { ...(await honest()), operatorSignature: '' };
    const response = await POST(declare(body));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'the operator has not signed' });
    expect(recordDeclaration).not.toHaveBeenCalled();
  });

  it('refuses a declaration with no agent signature at all', async () => {
    const body = { ...(await honest()), agentSignature: '' };
    const response = await POST(declare(body));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'the agent has not signed' });
    expect(recordDeclaration).not.toHaveBeenCalled();
  });

  it('refuses the agent signing alone and padding the operator half with junk', async () => {
    const timestampMs = Date.now();
    const body = {
      address: AGENT,
      operatorAddress: OPERATOR,
      model: MODEL,
      purpose: PURPOSE,
      timestampMs,
      agentSignature: await signAsAgent(OPERATOR, timestampMs),
      operatorSignature: await signAsAgent(OPERATOR, timestampMs + 1),
    };
    const response = await POST(declare(body));
    expect(response.status).toBe(401);
    expect(((await response.json()) as { error: string }).error).toContain("operator's signature");
    expect(recordDeclaration).not.toHaveBeenCalled();
  });

  it('refuses one signature submitted as both halves', async () => {
    const timestampMs = Date.now();
    const signature = await signAsAgent(OPERATOR, timestampMs);
    const response = await POST(
      declare({
        address: AGENT,
        operatorAddress: OPERATOR,
        model: MODEL,
        purpose: PURPOSE,
        timestampMs,
        agentSignature: signature,
        operatorSignature: signature,
      }),
    );
    expect(response.status).toBe(400);
    expect(recordDeclaration).not.toHaveBeenCalled();
  });

  it('refuses an agent that is its own operator, before verifying anything', async () => {
    const timestampMs = Date.now();
    const response = await POST(
      declare({
        address: AGENT,
        operatorAddress: AGENT,
        model: MODEL,
        purpose: PURPOSE,
        timestampMs,
        agentSignature: await signAsAgent(AGENT, timestampMs),
        operatorSignature: await signAsAgent(AGENT, timestampMs),
      }),
    );
    expect(response.status).toBe(400);
    expect(verifyAction).not.toHaveBeenCalled();
    expect(recordDeclaration).not.toHaveBeenCalled();
  });
});

describe('a signature re-pointed at somebody else', () => {
  it('refuses the agent’s signature filed against a different operator', async () => {
    const timestampMs = Date.now();
    const impostorHalf = new TextEncoder().encode(
      statementFor({ kind: 'declare-operator', agent: AGENT, model: MODEL, purpose: PURPOSE }, IMPOSTOR, timestampMs, ORIGIN),
    );
    const response = await POST(
      declare({
        address: AGENT,
        operatorAddress: IMPOSTOR,
        model: MODEL,
        purpose: PURPOSE,
        timestampMs,
        agentSignature: await signAsAgent(OPERATOR, timestampMs),
        operatorSignature: (await impostor.signPersonalMessage(impostorHalf)).signature,
      }),
    );
    expect(response.status).toBe(401);
    expect(((await response.json()) as { error: string }).error).toContain("agent's signature");
    expect(recordDeclaration).not.toHaveBeenCalled();
  });

  it('refuses the operator’s signature filed against a different agent', async () => {
    const timestampMs = Date.now();
    const response = await POST(
      declare({
        address: IMPOSTOR,
        operatorAddress: OPERATOR,
        model: MODEL,
        purpose: PURPOSE,
        timestampMs,
        agentSignature: await signAsAgent(OPERATOR, timestampMs),
        operatorSignature: await signAsOperator(AGENT, timestampMs),
      }),
    );
    expect(response.status).toBe(401);
    expect(recordDeclaration).not.toHaveBeenCalled();
  });

  it('refuses the agent’s half filed as the operator’s half', async () => {
    const timestampMs = Date.now();
    const response = await POST(
      declare({
        address: AGENT,
        operatorAddress: OPERATOR,
        model: MODEL,
        purpose: PURPOSE,
        timestampMs,
        agentSignature: await signAsAgent(OPERATOR, timestampMs),
        operatorSignature: await signAsOperator(AGENT, timestampMs + 1),
      }),
    );
    expect(response.status).toBe(401);
    expect(recordDeclaration).not.toHaveBeenCalled();
  });

  it('refuses a pair re-described with a model neither party signed', async () => {
    const body = { ...(await honest()), model: 'gpt-nonexistent' };
    const response = await POST(declare(body));
    expect(response.status).toBe(401);
    expect(recordDeclaration).not.toHaveBeenCalled();
  });

  it('refuses a pair re-described with a purpose neither party signed', async () => {
    const body = { ...(await honest()), purpose: 'Moderates other creators' };
    const response = await POST(declare(body));
    expect(response.status).toBe(401);
    expect(recordDeclaration).not.toHaveBeenCalled();
  });
});

describe('the statement format cannot be split from inside a field', () => {
  it('refuses a model carrying a line break', async () => {
    const timestampMs = Date.now();
    const model = `${MODEL}\npurpose: b`;
    const purpose = 'c';
    const response = await POST(
      declare({
        address: AGENT,
        operatorAddress: OPERATOR,
        model,
        purpose,
        timestampMs,
        agentSignature: await signAsAgent(OPERATOR, timestampMs, model, purpose),
        operatorSignature: await signAsOperator(AGENT, timestampMs, model, purpose),
      }),
    );
    expect(response.status).toBe(400);
    expect(recordDeclaration).not.toHaveBeenCalled();
  });

  it('proves the split it refuses is real', async () => {
    const at = 1_756_600_000_000;
    const oneReading = statementFor({ kind: 'declare-agent', operator: OPERATOR, model: `${MODEL}\npurpose: b`, purpose: 'c' },
      AGENT, at, ORIGIN);
    const anotherReading = statementFor({ kind: 'declare-agent', operator: OPERATOR, model: MODEL, purpose: `b\npurpose: c` },
      AGENT, at, ORIGIN);
    expect(oneReading).toBe(anotherReading);
  });
});

describe('the record certifies itself', () => {
  it('hands back statements that the stored signatures actually verify against', async () => {
    const timestampMs = Date.now();
    const filed = {
      address: AGENT,
      operatorAddress: OPERATOR,
      agentSignature: await signAsAgent(OPERATOR, timestampMs),
      operatorSignature: await signAsOperator(AGENT, timestampMs),
      model: MODEL,
      purpose: PURPOSE,
      declaredAtMs: timestampMs,
      revokedAtMs: null,
    };
    agentAccount.mockResolvedValue(filed);

    const response = await GET(new Request(`${ORIGIN}/api/agents/${AGENT}`), {
      params: Promise.resolve({ address: AGENT }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { statements: { agent: string; operator: string } };

    await expect(
      verifyPersonalMessageSignature(
        new TextEncoder().encode(body.statements.agent),
        filed.agentSignature,
        { address: AGENT },
      ),
    ).resolves.toBeDefined();
    await expect(
      verifyPersonalMessageSignature(
        new TextEncoder().encode(body.statements.operator),
        filed.operatorSignature,
        { address: OPERATOR },
      ),
    ).resolves.toBeDefined();
  });

  it('is 404 for an address nobody declared', async () => {
    agentAccount.mockResolvedValue(null);
    const response = await GET(new Request(`http://localhost/api/agents/${IMPOSTOR}`), {
      params: Promise.resolve({ address: IMPOSTOR }),
    });
    expect(response.status).toBe(404);
  });
});

describe('an operator that is only a second keypair', () => {
  beforeEach(() => {
    recordDeclaration.mockReset();
    verifyAction.mockClear();
    operatorConflict.mockReset();
    operatorConflict.mockImplementation(async () => null);
  });

  it('IS accepted when the register knows nothing about either address — the residual gap, stated', async () => {
    const timestampMs = Date.now();
    const response = await POST(
      declare({
        address: AGENT,
        operatorAddress: OPERATOR,
        model: MODEL,
        purpose: PURPOSE,
        timestampMs,
        agentSignature: await signAsAgent(OPERATOR, timestampMs),
        operatorSignature: await signAsOperator(AGENT, timestampMs),
      }),
    );
    expect(response.status).toBe(201);
    expect(operatorConflict).toHaveBeenCalledWith(AGENT, OPERATOR);
    expect(recordDeclaration).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['the operator is itself a declared agent', `the operator ${'0x' + 'ab'.repeat(32)} is itself a declared agent; a machine cannot answer for a machine.`],
    ['the agent is the declared operator of other agents', `${'0x' + 'cd'.repeat(32)} is the declared operator of other agents; an address that answers for machines cannot be declared one.`],
    ['the operator has a live request to be declared an agent', `the operator ${'0x' + 'ef'.repeat(32)} has a live request to be declared an agent itself.`],
  ])('is refused with 409 when %s, before any signature is spent', async (_case, sentence) => {
    operatorConflict.mockImplementation(async () => sentence);
    const timestampMs = Date.now();
    const response = await POST(
      declare({
        address: AGENT,
        operatorAddress: OPERATOR,
        model: MODEL,
        purpose: PURPOSE,
        timestampMs,
        agentSignature: await signAsAgent(OPERATOR, timestampMs),
        operatorSignature: await signAsOperator(AGENT, timestampMs),
      }),
    );
    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: string }).error).toBe(sentence);
    expect(verifyAction).not.toHaveBeenCalled();
    expect(recordDeclaration).not.toHaveBeenCalled();
  });

  it('asks the register about the normalised pair the body named, in that order', async () => {
    const timestampMs = Date.now();
    await POST(
      declare({
        address: AGENT.toUpperCase().replace('0X', '0x'),
        operatorAddress: OPERATOR,
        model: MODEL,
        purpose: PURPOSE,
        timestampMs,
        agentSignature: await signAsAgent(OPERATOR, timestampMs),
        operatorSignature: await signAsOperator(AGENT, timestampMs),
      }),
    );
    expect(operatorConflict).toHaveBeenCalledWith(AGENT, OPERATOR);
  });
});
