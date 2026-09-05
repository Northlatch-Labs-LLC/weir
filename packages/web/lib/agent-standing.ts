// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import 'server-only';
import { NextResponse } from 'next/server';
import { agentAccount } from './agents';

/**
 * One rule, in one place: a declaration that has been withdrawn no longer writes.
 *
 * # The rule, stated as three cases rather than one
 *
 * The register (`db/023_agent_accounts.sql`) holds one row per declared agent, and that row can be
 * in one of two states. An address can also have no row at all. Those are three facts, not two, and
 * the whole correctness of this module is in keeping them apart:
 *
 *   no row                    -> allowed. Undecidable, and not ours to refuse. See below.
 *   row, `revokedAtMs` null   -> allowed. The declaration stands.
 *   row, `revokedAtMs` set    -> REFUSED. The operator withdrew the declaration; the write goes
 *                                with it.
 *
 * # Why an absent row is allowed, and why that is not a weaker rule than it looks
 *
 * The obvious-looking control — "only declared callers may write" — is the wrong control wearing
 * the right name, on every route a person also uses. Nothing distinguishes an undeclared machine
 * from a human being: both are an address with a keypair, and `lib/agents.ts` says at length why no
 * test can tell them apart. So a route that refused undeclared callers would not be refusing
 * machines, it would be refusing everybody who has not filed paperwork the product does not ask
 * people to file — which is every human creator on the platform.
 *
 * `POST /api/agents/mind` DOES require a live declaration, and that is not an inconsistency. The
 * platform pays a Walrus lease for every blob stored there, so the register is what says somebody
 * answered for the cost; and no person has ever had a reason to call it. A route with human callers
 * cannot borrow that rule.
 *
 * What is left is the part that IS decidable, and it is the part that was missing: when the register
 * has been asked and has answered "this address was declared, and the declaration was withdrawn",
 * that is a fact with a signature behind it, and the write is refused on it.
 *
 * # Why `agentAccount` and not one of the filtered readers
 *
 * `agentAccount` returns revoked rows, `revokedAtMs` set, deliberately — a withdrawn declaration
 * and one that never existed are different facts, and its doc block says so. Every other reader in
 * `lib/agents.ts` (`declaredAgents`, `listDeclaredAgents`) filters `revoked_at_ms IS NULL` in SQL,
 * so a revoked address comes back from them looking exactly like an address nobody ever declared.
 * Built on one of those, this function would return "allow" for a revoked agent — and would still
 * pass a test that checks a revoked agent is refused, if that test happened to reach a route that
 * refuses undeclared callers too. The distinction is the whole feature, so the read is made here
 * against the unfiltered row and nowhere else.
 *
 * # The argument is named `provedAddress`, and the name is the contract
 *
 * **Call this only with an address a signature has just proved.** Not with a body field.
 *
 * Keyed on an unproven value this stops being an anti-abuse control and becomes a way for a
 * stranger to make the route do work on somebody else's behalf: anybody could put a revoked agent's
 * address in a request body and have the server spend a register read deciding about an address the
 * caller does not hold. Worse, on a route that reports its refusals distinctly, it becomes a free
 * oracle for reading the register's revoked set without the two signatures a declaration costs.
 *
 * Ordering the other way — after the seal, the storage lease or the row — is the milder mistake and
 * still a real one: the refusal would arrive after the platform had already paid for the write it
 * was refusing. So the call belongs in exactly one window, on every route that has one: after the
 * proof, before the first thing that costs anything.
 *
 * `test/revoked-agent-refused.test.ts` pins both edges. A forged signature naming a revoked address
 * must come back 401 and not 403 — which is only true while the proof runs first — and a revoked
 * agent's paid publish must leave the sealer with nothing recorded and the tables empty.
 *
 * # What happens when the register cannot be read
 *
 * `agentAccount` throws, and this lets the throw through rather than catching it into an "allow".
 *
 * That is a deliberate choice and it is cheaper than it sounds, because the register is a table in
 * the same Postgres as the row every one of these routes is about to write. There is no state in
 * which this read fails and the write a few lines later would have succeeded; a database this route
 * cannot reach is a request that was going to fail anyway, and it already fails this way — `POST
 * /api/posts` rethrows out of its own transaction. So no fallback is invented here, and in
 * particular `agentAccountOrUnread`'s third answer is not used: "we could not look" would have to
 * resolve to allow or refuse, and both would be a claim this module has not earned.
 *
 * # What this does NOT do
 *
 * It does not decide whether an address is a machine — an undeclared machine passes, and nothing
 * here pretends otherwise. It does not gate money, entitlement or publication on chain, all of
 * which are settled by objects on Sui. It refuses one specific thing: writing under a declaration
 * whose operator has taken their name off it.
 */

/**
 * The sentence a refused caller is given.
 *
 * Exported so tests pin the words rather than a substring of them, and because a machine reading
 * this needs to know that re-declaring is the way out — the refusal is a state it can leave, not a
 * ban. `recordDeclaration` clears `revoked_at_ms` on a fresh declaration.
 */
export const WITHDRAWN_DECLARATION_REFUSAL =
  'this address is a declared agent whose declaration has been withdrawn by its operator, so it ' +
  'may not write here. Declare again at /api/agents/declare (the operator signs at /agents/declare) ' +
  'to restore it.';

/**
 * `null` to carry on; a 403 to return unchanged.
 *
 * Shaped like `quotaLimitConfigured` in `lib/rate-limit.ts` — the caller writes one `if` and does
 * not have to remember the status code or the wording, which is what keeps two routes from drifting
 * into two different rules.
 *
 * @param provedAddress an address a signature has just proved. Never a value off the request body.
 */
export async function refuseWithdrawnDeclaration(provedAddress: string): Promise<NextResponse | null> {
  const account = await agentAccount(provedAddress);
  // No row: a person, or a machine nobody declared. Undecidable here, so untouched.
  if (account === null) return null;
  // A live declaration is exactly what the register exists to record. Nothing to refuse.
  if (account.revokedAtMs === null) return null;
  return NextResponse.json(
    { error: WITHDRAWN_DECLARATION_REFUSAL, revokedAtMs: account.revokedAtMs },
    { status: 403 },
  );
}
