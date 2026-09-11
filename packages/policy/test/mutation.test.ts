// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { describe, expect, it } from 'vitest';
import { RULES, evaluate, evaluateWith, rulesWithout } from '../src/index.js';
import { BASELINE, LEDGER, POLICY, VIOLATIONS } from './fixtures.js';

describe('the baseline', () => {
  it('is permitted by the full rule set, so every denial below is caused by its own mutation', () => {
    expect(evaluate(BASELINE, POLICY, LEDGER)).toEqual({ allow: true });
  });
});

describe('rule coverage', () => {
  it('covers every rule exactly once', () => {
    const ruleIds = RULES.map((r) => r.id).sort();
    const fixtureIds = VIOLATIONS.map((v) => v.ruleId).sort();
    expect(fixtureIds).toEqual(ruleIds);
  });
});

describe.each(VIOLATIONS)('rule $ruleId', ({ ruleId, what, effects, policy, ledger }) => {
  it(`refuses ${what}`, () => {
    const decision = evaluate(effects, policy, ledger);
    expect(decision.allow).toBe(false);
    expect(decision.allow === false && decision.ruleId).toBe(ruleId);
  });

  it(`is permitted once ${ruleId} is deleted — so the rule carries the refusal`, () => {
    const mutated = evaluateWith(rulesWithout(ruleId), effects, policy, ledger);
    expect(mutated).toEqual({ allow: true });
  });
});
