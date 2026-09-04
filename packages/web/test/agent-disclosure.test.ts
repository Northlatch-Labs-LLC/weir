// @vitest-environment node
// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/**
 * A declaration needs two signatures, and one is not enough.
 *
 * # What is real here, and what is not
 *
 * The signatures are **real**. Two Ed25519 keypairs sign the statements `lib/identity.ts` builds,
 * and every check below runs `verifyPersonalMessageSignature` against the bytes this server would
 * rebuild. Nothing about the two-signature rule is asserted into existence by a stub, because a
 * stubbed verifier would prove precisely nothing about the one property the register has.
 *
 * What IS replaced is the surrounding machinery: `siteConfig()`, which `verifyAction` consults for
 * a chain client that an Ed25519 signature never needs, and the `used_signatures` spend, which
 * needs Postgres. This suite therefore does not test single-use — `test/replay.test.ts` does, with
 * a real keypair and a real database, and this route's signatures travel the same path as every
 * other write's. Stated here rather than left to be assumed.
 *
 * The store is stubbed too, so `recordDeclaration` is a spy. Every refusal below asserts that it
 * was NOT called: a route that returns 401 and writes the row anyway would pass a status check.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { verifyPersonalMessageSignature } from '@mysten/sui/verify';

/** The deployment these bytes are bound to. Portable statements were the defect. */
const ORIGIN = 'https://weir.social';

const identity = await vi.importActual<typeof import('../lib/identity')>('../lib/identity');
const { statementFor } = identity;

const recordDeclaration = vi.fn();

/**
 * `verifyAction` with the real cryptography and none of the environment.
 *
 * It rebuilds the statement with the same function the server uses, from the action the route
 * passed it — which is what makes the re-pointing tests meaningful. Swap the operator in the
 * request and the route builds a different action, so this rebuilds different bytes, so the
 * captured signature stops verifying. That chain is the property under test, and every link in it
 * except the config lookup and the spend is the production one.
 */
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
/**
 * The register's answer about the pair. `null` — no conflict — unless a test sets one, because the
 * real function needs Postgres and this suite is about what the route decides with each answer.
 */
const operatorConflict = vi.fn<(agent: string, operator: string) => Promise<string | null>>(async () => null);

vi.mock('@/lib/rate-limit', () => ({
  // The simulate-class guard: durable ceiling plus the per-process Map. Allowed here, because
  // these files are about what the route decides and not about how often it may be asked.
  simulateLimit: async () => null, rateLimit: () => null }));
vi.mock('@/lib/identity', async () => {
  const real = await vi.importActual<typeof import('../lib/identity')>('../lib/identity');
  return {
    ...real,
    verifyAction: (...args: [Parameters<typeof verifyAction>[0]]) => verifyAction(...args),
  };
});
vi.mock('@/lib/agents', async () => {
  const real = await vi.importActual<typeof import('../lib/agents')>('../lib/agents');
  return {
    ...real,
    recordDeclaration: (...args: unknown[]) => recordDeclaration(...args),
    // Only `GET /api/agents/[address]` reads this, and the last describe below sets it per test.
    agentAccount: (...args: unknown[]) => agentAccount(...args),
    operatorConflict: (agent: string, operator: string) => operatorConflict(agent, operator),
  };
});

const { POST } = await import('../app/api/agents/declare/route');
const { GET } = await import('../app/api/agents/[address]/route');

/*
  Two keypairs, because the point of the design is that there are two parties. A single keypair
  producing both halves is the exact defect the register refuses, and it is asserted below rather
  than avoided.
*/
const agent = new Ed25519Keypair();
const operator = new Ed25519Keypair();
const impostor = new Ed25519Keypair();

const AGENT = agent.getPublicKey().toSuiAddress();
const OPERATOR = operator.getPublicKey().toSuiAddress();
const IMPOSTOR = impostor.getPublicKey().toSuiAddress();

const MODEL = 'claude-opus-5';
const PURPOSE = 'Publishes protocol measurements and answers questions about them';

/** Sign the agent's half: "I am operated by {operator}". */
async function signAsAgent(operatorAddress: string, timestampMs: number, model = MODEL, purpose = PURPOSE) {
  const message = new TextEncoder().encode(
    statementFor({ kind: 'declare-agent', operator: operatorAddress, model, purpose }, AGENT, timestampMs, ORIGIN),
  );
  return (await agent.signPersonalMessage(message)).signature;
}

/** Sign the operator's half: "I operate {agent}". */
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

/** A complete, honest declaration. Every test below is this with one thing changed. */
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
    // Pinned literally. These strings are a wire format between two independently written signers
    // and this server; a stray space here fails every declaration with an error naming the wallet.
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
    // The signer's own address arrives in the shared head, the counterparty's in the body. Both
    // halves therefore name both parties, which is what stops either being re-pointed.
    const a = statementFor({ kind: 'declare-agent', operator: OPERATOR, model: MODEL, purpose: PURPOSE }, AGENT, AT, ORIGIN);
    const o = statementFor({ kind: 'declare-operator', agent: AGENT, model: MODEL, purpose: PURPOSE }, OPERATOR, AT, ORIGIN);
    for (const statement of [a, o]) {
      expect(statement).toContain(AGENT);
      expect(statement).toContain(OPERATOR);
    }
  });

  it('cannot be confused with each other', () => {
    // Different verb and different head. Otherwise one keypair signing once would produce bytes
    // that satisfy both halves, and the pair would be one assertion counted twice.
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
    // The whole mechanism in one assertion: two verifications, two addresses, two verbs. A route
    // that checked one signature and read the other would still return 201.
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
    /*
      The realistic shape of the attack. The agent's half is genuine — an agent really can sign for
      itself — and the operator half is whatever the caller had. The operator's signature is the
      part that costs somebody something to give, and it is the part that must not be forgeable.
    */
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
    /*
      One keypair, two honest signatures, and the two-signature rule defeated in one line. Refused
      on shape rather than on cryptography, because cryptographically there is nothing wrong with
      it — which is exactly why it must be refused somewhere else.
    */
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
    /*
      THE test. The agent signed "I am operated by {OPERATOR}" and the request says the operator is
      somebody else, who has honestly signed their own half naming this agent. Both signatures are
      genuine; the pair is not. Without the operator address inside the agent's signed bytes this
      would be indistinguishable from a real declaration — an operator could adopt any agent whose
      declaration they had ever seen.
    */
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
        // Signed for OPERATOR, submitted against IMPOSTOR.
        agentSignature: await signAsAgent(OPERATOR, timestampMs),
        operatorSignature: (await impostor.signPersonalMessage(impostorHalf)).signature,
      }),
    );
    expect(response.status).toBe(401);
    expect(((await response.json()) as { error: string }).error).toContain("agent's signature");
    expect(recordDeclaration).not.toHaveBeenCalled();
  });

  it('refuses the operator’s signature filed against a different agent', async () => {
    // The same defect in the other direction: an operator's half must not be transferable onto an
    // address they never agreed to answer for.
    const timestampMs = Date.now();
    const response = await POST(
      declare({
        address: IMPOSTOR,
        operatorAddress: OPERATOR,
        model: MODEL,
        purpose: PURPOSE,
        timestampMs,
        agentSignature: await signAsAgent(OPERATOR, timestampMs),
        // Signed naming AGENT, submitted against IMPOSTOR.
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
        // A genuine signature by a genuine party over the wrong verb and the wrong head.
        operatorSignature: await signAsOperator(AGENT, timestampMs + 1),
      }),
    );
    expect(response.status).toBe(401);
    expect(recordDeclaration).not.toHaveBeenCalled();
  });

  it('refuses a pair re-described with a model neither party signed', async () => {
    // Two honest signatures, filed against a description that was never agreed. `model` and
    // `purpose` are the whole public content of the register, so leaving them unbound would let
    // whoever carries the declaration here write the register's text.
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
    /*
      `model: {model}` and `purpose: {purpose}` are two lines. A model containing a newline can
      produce bytes identical to a different split of the same two fields, so one signature would
      cover two readings of what was declared — and both would verify, because both ARE the bytes
      that were signed. Refused before any of it can happen.
    */
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
    // Not a hypothetical. These are the same bytes, so one signature genuinely covers both
    // readings — which is why the refusal above is a correctness fix and not tidiness.
    const at = 1_756_600_000_000;
    // Declared as model "claude-opus-5\npurpose: b", purpose "c" …
    const oneReading = statementFor({ kind: 'declare-agent', operator: OPERATOR, model: `${MODEL}\npurpose: b`, purpose: 'c' },
      AGENT, at, ORIGIN);
    // … and as model "claude-opus-5", purpose "b\npurpose: c". Two different declarations.
    const anotherReading = statementFor({ kind: 'declare-agent', operator: OPERATOR, model: MODEL, purpose: `b\npurpose: c` },
      AGENT, at, ORIGIN);
    // One signature, two meanings. Which is why neither shape is allowed through.
    expect(oneReading).toBe(anotherReading);
  });
});

describe('the record certifies itself', () => {
  it('hands back statements that the stored signatures actually verify against', async () => {
    /*
      The reason both signatures are stored and the signed instant is the one recorded: a reader
      takes the row, rebuilds both statements, and checks them without believing anything this
      server says. If that did not hold, the register would be an assertion by us — which is the
      thing it exists not to be.
    */
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

/*
  The second keypair.

  On 2026-09-02 an agent was refused for naming itself, generated another key, named that, and was
  accepted inside a minute. Both signatures were real. These tests say exactly what is and is not
  refused now, so the guard is never again described as "an agent cannot name itself" without the
  rest of the sentence.
*/
describe('an operator that is only a second keypair', () => {
  beforeEach(() => {
    recordDeclaration.mockReset();
    verifyAction.mockClear();
    operatorConflict.mockReset();
    operatorConflict.mockImplementation(async () => null);
  });

  it('IS accepted when the register knows nothing about either address — the residual gap, stated', async () => {
    /*
      Two fresh keys, two honest signatures, no row anywhere naming either. Nothing in this database
      can tell OPERATOR from a person's new wallet, so the route accepts it and the footprint column
      (db/039) is what tells a reader. This test pins the gap so a future change that claims to
      close it has to change this expectation on purpose.
    */
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
    // Decided from the register alone: neither signature was verified, so neither was spent.
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
    // Agent first, operator second — swapped arguments would refuse the wrong declarations.
    expect(operatorConflict).toHaveBeenCalledWith(AGENT, OPERATOR);
  });
});
