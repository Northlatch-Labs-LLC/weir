// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/**
 * What a profile says about the declaration register, from one register answer.
 *
 * Three states, because the register gives three answers and a profile must not merge any two:
 *
 *   - `declared` — a live row. The identity row says so, with the record to verify it against.
 *   - `none` — no row, or a withdrawn one. Nothing is said. Not "human", not "unverified": the
 *     register proves a declaration was made, never that one was not. A withdrawn row is `none`
 *     for now because what a withdrawn declaration should say on a profile is an open decision
 *     (the spec's D-6); until it is taken, a withdrawn agent is treated exactly as `declaredAgents`
 *     treats it for the pill — not a machine now — and nothing is invented.
 *   - `unread` — the register could not be read. Said in one quiet sentence that does not contain
 *     the word "agent", so an unread register on a person's page never reads as a claim about
 *     them, and is still distinguishable from `none` by anyone who looks.
 *
 * The operator's address is NOT carried. The record has it and `/api/agents/{address}` hands it
 * out; whether the product shows it is the spec's D-2, and until that is ruled the line says
 * "verified by two signatures" and points at the record.
 *
 * Pure, so the rule is testable without a database and a mutation of it is one line.
 */

import type { AgentAccount } from '@/lib/agents';

export type DesignAgentIdentity =
  | {
      state: 'declared';
      /** The parties' own signed words. Rendered as text, never as markup. */
      model: string;
      purpose: string;
      /** `Declared 1 Sep 2026`, UTC — the `issued:` instant inside both statements. */
      declared: string;
      /** Relative: `/api/agents/0x…`. Never an origin. */
      recordPath: string;
    }
  | { state: 'none' }
  | { state: 'unread' };

/** The sentence for an unread register. No "agent" in it, by design — see the module note. */
export const REGISTER_UNREAD_LINE = 'Declaration register not read just now.';

export function agentIdentityFor(account: AgentAccount | null | undefined): DesignAgentIdentity {
  if (account === undefined) return { state: 'unread' };
  if (account === null || account.revokedAtMs !== null) return { state: 'none' };
  return {
    state: 'declared',
    model: account.model,
    purpose: account.purpose,
    declared: `Declared ${new Date(account.declaredAtMs).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}`,
    recordPath: `/api/agents/${account.address}`,
  };
}

/** The value `PostCard` takes, from the same answer — so the line and the pill cannot disagree. */
export function authorIsAgentFrom(identity: DesignAgentIdentity): boolean | undefined {
  return identity.state === 'unread' ? undefined : identity.state === 'declared';
}
