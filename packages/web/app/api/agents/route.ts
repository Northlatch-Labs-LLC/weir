// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { listDeclaredAgents } from '@/lib/agents';
import { recoveryOf } from '@/lib/agent-recovery';
import { normaliseAddress } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * The register, as a list.
 *
 * Every standing declaration — the machine's address, who answers for it, what it says it is —
 * and nothing that was withdrawn. `?operator=` narrows it to one operator's fleet. The signatures
 * are not repeated here; `GET /api/agents/{address}` hands one entry back with both, which is the
 * shape a verifier wants, and a list that carried them would be a page of base64 nobody checks.
 *
 * A malformed `operator` is a 400, not an empty list: an empty list would read as "this operator
 * declared nothing", which is a claim the request did not earn.
 */
export async function GET(request: Request) {
  const limited = rateLimit(request, 'read');
  if (limited !== null) return limited;

  const url = new URL(request.url);
  const rawOperator = url.searchParams.get('operator');
  let operator: string | null = null;
  if (rawOperator !== null) {
    try {
      operator = normaliseAddress(rawOperator);
    } catch {
      return NextResponse.json({ error: 'operator must be a Sui address' }, { status: 400 });
    }
  }

  /*
    Bounded before a fleet exists: the list is every standing declaration, and a register that has
    grown past this page is reported as truncated rather than read whole for every anonymous call.
  */
  const LIST_LIMIT = 500;
  const all = await listDeclaredAgents();
  const matching = operator === null ? all : all.filter((a) => a.operatorAddress === operator);
  const truncated = matching.length > LIST_LIMIT;
  const agents = matching.slice(0, LIST_LIMIT).map((a) => ({
    address: a.address,
    operatorAddress: a.operatorAddress,
    model: a.model,
    purpose: a.purpose,
    declaredAtMs: a.declaredAtMs,
    recovery: recoveryOf(a.agentSignature, a.operatorAddress),
    /*
      What we could see about the operator address when this was filed, and nothing more.

      Published because the guard behind this register is thinner than it reads: it refuses an agent
      that names ITSELF, and an agent that generates a second key and names that is accepted, with
      two real signatures. We cannot tell those apart cryptographically, so instead of implying a
      check we do not perform, the observation is handed to the reader.

      Absent on declarations filed before the measurement existed. 'unseen' is a signal and not a
      verdict: a new human wallet looks identical to a key an agent made a minute ago.
    */
    ...(a.operatorFootprint === undefined
      ? {}
      : {
          operatorFootprint: a.operatorFootprint,
          // Dated, so a reader can tell an observation taken at declaration from one taken since.
          ...(a.operatorFootprintAtMs === undefined ? {} : { operatorFootprintAtMs: a.operatorFootprintAtMs }),
        }),
  }));

  return NextResponse.json({ agents, count: agents.length, truncated, ...(operator === null ? {} : { operator }) });
}
