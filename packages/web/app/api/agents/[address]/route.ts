// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { statementFor } from '@/lib/identity';
import { agentAccount } from '@/lib/agents';
import { recoveryOf } from '@/lib/agent-recovery';

export const dynamic = 'force-dynamic';

/**
 * One entry in the register, or nothing.
 *
 * # It hands back the bytes, not just the verdict
 *
 * The response carries both signatures **and both statements** — the exact text each party signed,
 * rebuilt here by the same `statementFor` the verification used. A reader can therefore check this
 * record without asking us anything: take the two statements, the two signatures and the two
 * addresses, and verify. If we lied, it does not verify.
 *
 * Rebuilding the statements rather than storing them is the same rule the write path follows: the
 * server never trusts text it was handed. A stored statement string could drift from the function
 * that produced it and would then certify the wrong bytes forever; this cannot, because there is one
 * implementation and it is the one that verified the signatures in the first place.
 *
 * # Why 404 and not an empty record
 *
 * "Not in the register" is the answer for the overwhelming majority of addresses — every person on
 * the platform. It is not an error and it is not a partial record. A `200` carrying nulls would
 * invite a caller to read it as "declared, details unknown", which is the one reading that must
 * never be available.
 *
 * A **revoked** declaration is returned, not hidden, with `revokedAtMs` set. A relationship that
 * ended is a different fact from one that never existed, and flattening the two would let an
 * operator erase their history by withdrawing.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ address: string }> },
) {
  const limited = rateLimit(request, 'read');
  if (limited !== null) return limited;

  const origin = new URL(request.url).origin;

  const { address } = await params;
  const account = await agentAccount(address);
  if (account === null) {
    return NextResponse.json({ error: 'this address is not in the agent register' }, { status: 404 });
  }

  return NextResponse.json({
    agent: account,
    /*
      Read from the stored agent signature, never from a claim: a multisig signature carries its
      committee, so whether the operator holds one of the agent's keys is decodable by anyone who
      has this record. See lib/agent-recovery.ts.
    */
    recovery: recoveryOf(account.agentSignature, account.operatorAddress),
    /*
      What each party signed, so the caller can verify rather than believe.

      `declaredAtMs` is the `issued:` value inside both — which is why the route stores the signed
      instant rather than the write time, and why both halves must carry the same one. With two
      independent timestamps and one column, these two strings could not be rebuilt and this whole
      block would be decoration.
    */
    /*
      Rebuilt against THIS deployment's origin, which is now part of the signed bytes.

      Faithful while the origin is stable, and this route stores `declaredAtMs` precisely so these
      can be rebuilt — but it does not store the origin. If this deployment ever answers on a
      different name, declarations made under the old one cannot be reconstructed from here. The
      honest fix is a column; it is a schema change and it is not this one.
    */
    statements: {
      agent: statementFor(
        {
          kind: 'declare-agent',
          operator: account.operatorAddress,
          model: account.model,
          purpose: account.purpose,
        },
        account.address,
        account.declaredAtMs,
        origin,
      ),
      operator: statementFor(
        {
          kind: 'declare-operator',
          agent: account.address,
          model: account.model,
          purpose: account.purpose,
        },
        account.operatorAddress,
        account.declaredAtMs,
        origin,
      ),
    },
  });
}
