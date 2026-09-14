// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { RULES, type RuleId } from '@projectx-social/policy';

export const PURSE_REFUSAL_IDS = [
  'request-malformed',
  'request-too-large',
  'intent-invalid',
  'intent-unbuildable',
  'gate-refused',
  'intent-invalid-locally',
  'purse-unreachable',
  /**
   * A chain read the caller needed did not happen: the node refused, timed out, or answered a
   * shape this estate does not recognise.
   *
   * Its own id rather than a shared "error" because the ledger settles a citizen's epoch on these
   * numbers. A read that failed and a read that returned zero must never arrive at the same place:
   * one of them retires a citizen, and only one of them is a fact.
   */
  'chain-unreadable',
  /*
    The statement intent's own refusals (statement.ts). Each is a bound named in that file's
    header: the flags absent, the origin wrong, the clock off, the object or coin outside the
    policy, a price shape or ceiling wrong, the daily count reached.
  */
  'statement-disabled',
  'statement-origin',
  'statement-clock',
  'statement-object',
  'statement-price',
  'statement-ceiling',
] as const;

export type PurseRefusalId = (typeof PURSE_REFUSAL_IDS)[number];

export type RefusalId = RuleId | PurseRefusalId;

export interface Refusal {
  readonly ruleId: RefusalId;
  readonly reason: string;
}

export type Outcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly refused: Refusal };

export function allow<T>(value: T): Outcome<T> {
  return { ok: true, value };
}

export function refuse<T>(ruleId: RefusalId, reason: string): Outcome<T> {
  return { ok: false, refused: { ruleId, reason } };
}

const POLICY_RULE_IDS: ReadonlySet<string> = new Set(RULES.map((rule) => rule.id));

export function ruleIdIn(reason: string): RuleId | null {
  if (!reason.startsWith('[')) return null;
  const end = reason.indexOf(']');
  if (end === -1) return null;
  const candidate = reason.slice(1, end);
  return POLICY_RULE_IDS.has(candidate) ? (candidate as RuleId) : null;
}
