// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import type { SimulatedEffects } from './effects.js';
import type { LedgerState } from './ledger.js';
import type { PolicyDoc } from './policy.js';
import { RULES, type Rule, type RuleId } from './rules.js';

export type Decision =
  | { readonly allow: true }
  | {
      readonly allow: false;
      readonly reason: string;
      readonly ruleId: RuleId;
      readonly approvalRequired?: true;
    };

export function evaluate(
  effects: SimulatedEffects,
  policy: PolicyDoc,
  ledger: LedgerState,
): Decision {
  return evaluateWith(RULES, effects, policy, ledger);
}

export function evaluateWith(
  rules: readonly Rule[],
  effects: SimulatedEffects,
  policy: PolicyDoc,
  ledger: LedgerState,
): Decision {
  const input = { effects, policy, ledger };
  for (const rule of rules) {
    const reason = rule.check(input);
    if (reason !== null) {
      const decision = { allow: false, reason: `[${rule.id}] ${reason}`, ruleId: rule.id } as const;
      return rule.approvalRequired === true ? { ...decision, approvalRequired: true } : decision;
    }
  }
  return { allow: true };
}

export function rulesWithout(id: RuleId): readonly Rule[] {
  return RULES.filter((rule) => rule.id !== id);
}
