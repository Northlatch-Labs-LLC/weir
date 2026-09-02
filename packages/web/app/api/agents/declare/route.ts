// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { verifyAction } from '@/lib/identity';
import { recordDeclaration, validateDeclaration } from '@/lib/agents';
import { markDeclarationRequestFiled } from '@/lib/agent-declarations';
import { markOfferFiled, markSeekingClaimed } from '@/lib/agent-seeking';
import { operatorFootprint } from '@/lib/operator-footprint';

export const dynamic = 'force-dynamic';

/**
 * Declaring that an address is a machine, and who answers for it.
 *
 * # Two signatures, verified independently, or nothing is written
 *
 * This route's only real content is that it calls `verifyAction` **twice, against two different
 * addresses, over two different statements**, and refuses the declaration if either fails:
 *
 *   the agent    signs  `declare agent`     — "I am operated by {operator}"
 *   the operator signs  `declare operator`  — "I operate {agent}"
 *
 * A declaration carrying one valid signature is refused. That is the security property, and it is
 * the reason this feature needs no Move change and no trust in this deployment: the row it writes
 * carries both signatures and the instant they were issued, so anybody can rebuild both statements
 * and check them for themselves. We are the filing cabinet, not the authority.
 *
 * The failure this closes, from the network that was compromised this month: with one signature, a
 * human can pose as an agent, and a human can pose *somebody else* as an agent. Both halves of that
 * needed closing and only the pair closes both.
 *
 * # What each half cannot be turned into
 *
 * Both statements bind both addresses — the signer's in the shared head, the counterparty's in the
 * body — so neither can be re-pointed. An agent's signature naming operator A does not verify
 * against a request naming operator B, because the bytes the server rebuilds are different bytes.
 * `model` and `purpose` are bound too, so two honest signatures cannot be filed against a
 * description neither party agreed to.
 *
 * The verbs differ (`declare agent` / `declare operator`) and the head's address differs, so an
 * operator's half cannot be filed as the agent's half. `validateDeclaration` refuses
 * `address === operatorAddress` on top of that, because one keypair producing both signatures is
 * one signature written twice — and `db/023_agent_accounts.sql` refuses it a third time as a CHECK,
 * where it outlives this route.
 *
 * # The order of verification, and what it costs
 *
 * The agent's half is verified first and the operator's second. `verifyAction` **spends** each
 * signature as it verifies it, so a declaration whose operator half is bad has already burnt the
 * agent's: both parties must sign again.
 *
 * That is a real cost and it is accepted deliberately. Verifying both before spending either is not
 * available — spending is what makes a signature single-use, and deferring it opens the window
 * `db/011_signature_replay.sql` exists to close. The griefing it allows is bounded and unattractive:
 * an attacker must already hold a captured agent-half signature, and all they achieve is making two
 * parties re-sign a declaration that is public anyway.
 */
export async function POST(request: Request) {
  const limited = rateLimit(request, 'write');
  if (limited !== null) return limited;

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'the body must be JSON' }, { status: 400 });
  }

  const checked = validateDeclaration(body);
  if (!checked.ok) return NextResponse.json({ error: checked.why }, { status: 400 });
  const declaration = checked.declaration;

  /*
    Half one: the machine.

    Note what is passed as `address` — the agent's own — and what is inside the action: the
    operator's. Both are rebuilt from the validated declaration and never taken from the request as
    text, so a caller cannot sign one statement and submit another.
  */
  const byAgent = await verifyAction({
    origin: new URL(request.url).origin,
    address: declaration.address,
    signature: declaration.agentSignature,
    timestampMs: declaration.timestampMs,
    action: {
      kind: 'declare-agent',
      operator: declaration.operatorAddress,
      model: declaration.model,
      purpose: declaration.purpose,
    },
  });
  if (!byAgent.ok) {
    return NextResponse.json(
      { error: `the agent's signature does not stand: ${byAgent.failure.detail}` },
      { status: 401 },
    );
  }

  /*
    Half two: the operator. Verified on its own terms against its own address.

    If this fails, NOTHING is written. A valid agent signature beside an invalid operator signature
    is not a partial declaration to be recorded as pending — it is an address claiming an operator
    who has not agreed to answer for it, which is the exact claim this register refuses to carry.
  */
  const byOperator = await verifyAction({
    origin: new URL(request.url).origin,
    address: declaration.operatorAddress,
    signature: declaration.operatorSignature,
    timestampMs: declaration.timestampMs,
    action: {
      kind: 'declare-operator',
      agent: declaration.address,
      model: declaration.model,
      purpose: declaration.purpose,
    },
  });
  if (!byOperator.ok) {
    return NextResponse.json(
      { error: `the operator's signature does not stand: ${byOperator.failure.detail}` },
      { status: 401 },
    );
  }

  try {
    const account = await recordDeclaration(
    declaration,
    /*
      Measured here, at the moment the declaration is filed, and stored with it. Measuring later
      would report today's chain against a claim made months ago, which is a different question
      from the one the register answers. A read that fails records 'not-measured' and nothing is
      refused on it — see lib/operator-footprint.ts.
    */
    await operatorFootprint(declaration.operatorAddress),
  );
    // The waiting room's row for this instant, if the agent used it. A missing row is fine: the
    // two halves may have met without the site's help, as they did before /agents/declare existed.
    await markDeclarationRequestFiled(declaration.address, declaration.timestampMs).catch(() => false);
    // And the reversed path: an agent that listed itself and answered an operator's offer. Both
    // marks are best-effort for the same reason as above — the declaration is the fact; these rows
    // are how the two pages stop showing something already done.
    await markOfferFiled(declaration.address, declaration.operatorAddress, declaration.timestampMs).catch(() => false);
    await markSeekingClaimed(declaration.address).catch(() => false);
    return NextResponse.json({ agent: account }, { status: 201 });
  } catch (error) {
    /*
      Fails closed and says so. The signatures are spent by now, so a caller who is told this must
      sign again — telling them it worked when the row is not there would put an agent in the
      register in name only, and the next reader would find nothing.
    */
    return NextResponse.json(
      {
        error: `both signatures verified but the declaration was not recorded: ${
          error instanceof Error ? error.message : String(error)
        }`,
      },
      { status: 503 },
    );
  }
}
