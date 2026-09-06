// Built-by: @projectx.sui · Co-authored-by: Claude
/**
 * The rebate pool is funded by staking yield and by nothing else.
 *
 * # Why this is a test and not a comment
 *
 * `stake_vault` divides harvested yield three ways and puts the depositors' share in
 * `rebate_pool`. That pool is a redistribution: money leaves one party and reaches another
 * because of a rule the platform wrote. The legal character of a redistribution depends
 * entirely on where the money came from.
 *
 * Yield the depositors' own principal earned, handed back to those depositors, is a rebate on
 * their own capital. The same pool fed by third-party payments — tips, subscriptions, anything
 * one person pays another — is a different object: money collected from many and paid out by a
 * formula, which is what pooling for profit looks like from the outside no matter what it is
 * called in the source.
 *
 * The distinction is one `join` call. Somebody adding a "tips boost the rebate" feature would
 * write a single line, it would pass every existing test, the yield split would still conserve,
 * the no-loss invariant would still hold, and nothing anywhere would object. That is the whole
 * reason this file exists: the property is invisible to every other check in the repository,
 * and the change that breaks it is one line long and looks like a feature.
 *
 * So the rule is not "do not do this". The rule is: this test fails, and whoever wants the
 * feature has to take counsel and then delete an assertion on purpose.
 *
 * # What is actually asserted
 *
 * Three structural facts about `sui-contracts/sources/stake_vault.move`, checked against the
 * source rather than assumed:
 *
 *   1. `rebate_pool` is added to at exactly one place, and that place is inside
 *      `credit_proceeds`.
 *   2. `credit_proceeds` is called from exactly `withdraw` and `harvest`, and in both the
 *      balance it is handed was bound by a `stake_ladder::` call in that same function.
 *   3. No other module in `sui-contracts/sources/` names `rebate_pool` at all.
 *
 * Together those close the path. A `Balance` inside a shared object cannot be reached from
 * outside the module that declares it, so 3 means the only routes in are the module's own; 1
 * means every route in runs through `credit_proceeds`; and 2 means every call to it carries
 * `stake_ladder` proceeds, which is Sui native staking and cannot be anything else.
 *
 * # The two callers are both correct, and the second one is not obvious
 *
 * `harvest` is the expected one. `withdraw` is the surprise: when the liquid buffer is short it
 * unwinds a tranche to pay the depositor, and unwinding realises staking rewards that have to
 * be split like any other yield. It is the same money from the same place, reaching the pool on
 * a different day. A guard that demanded a single caller would have been wrong about the
 * contract and would have been "fixed" by loosening it, which is how a guard becomes
 * decoration.
 *
 * # The allowlist is exact
 *
 * Same discipline as `scale-guard.test.ts`. The expected call sites are named, and a name that
 * stops appearing fails just as loudly as a new one that does. A guard whose list can quietly
 * shrink stops being evidence of anything.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sources = join(import.meta.dirname, '../../../sui-contracts/sources');
const vault = readFileSync(join(sources, 'stake_vault.move'), 'utf8');

/**
 * The functions that may hand `credit_proceeds` its balance, and why each is yield.
 *
 * Exact: a function here that no longer calls it fails, and a caller not here fails.
 */
const EXPECTED_CALLERS: Record<string, string> = {
  withdraw:
    'unwinds a tranche when the liquid buffer is short; unwinding realises staking rewards, ' +
    'which are split like any other yield',
  harvest: 'the ordinary path — rewards from matured tranches',
};

/** Every balance reaching `credit_proceeds` must be bound by one of these. */
const LADDER_CALL = /stake_ladder::[a-z_]+\s*\(/;

/**
 * Split the module into top-level functions: name → body text.
 *
 * Move declares every function at column zero in this module, so the start of the next
 * declaration is the end of the previous body. Crude, and sufficient — the assertions below
 * only ask which function a line sits in.
 */
function functions(source: string): Map<string, string> {
  const declaration = /^(?:public(?:\([a-z]+\))?\s+)?(?:entry\s+)?fun\s+([a-z_0-9]+)/gm;
  const starts: { name: string; at: number }[] = [];
  for (const match of source.matchAll(declaration)) {
    const name = match[1];
    if (name === undefined || match.index === undefined) continue;
    starts.push({ name, at: match.index });
  }
  const out = new Map<string, string>();
  starts.forEach((start, i) => {
    const next = starts[i + 1];
    out.set(start.name, source.slice(start.at, next ? next.at : source.length));
  });
  return out;
}

const bodies = functions(vault);

/** Lines that are code rather than documentation or comment. */
function code(body: string): string[] {
  return body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('//') && !line.startsWith('/*'));
}

describe('the rebate pool is funded by staking yield only', () => {
  it('parsed the module', () => {
    // If this fails the parser broke, and every assertion below is vacuous rather than passing.
    expect(bodies.has('credit_proceeds')).toBe(true);
    expect(bodies.has('harvest')).toBe(true);
    expect(bodies.has('withdraw')).toBe(true);
    expect(bodies.size).toBeGreaterThan(20);
  });

  it('adds to rebate_pool at exactly one place, inside credit_proceeds', () => {
    const adding: { fn: string; line: string }[] = [];
    for (const [name, body] of bodies) {
      for (const line of code(body)) {
        if (/rebate_pool\s*\.\s*join\s*\(/.test(line)) adding.push({ fn: name, line });
      }
    }

    expect(adding.map((a) => a.fn)).toEqual(['credit_proceeds']);
    // The amount joined is the rebate cut the split computed, not an arbitrary balance.
    expect(adding[0]?.line).toContain('rebate_cut');
  });

  it('calls credit_proceeds only from the expected functions', () => {
    const callers = [...bodies]
      .filter(([name, body]) =>
        name !== 'credit_proceeds' && code(body).some((l) => l.includes('credit_proceeds(')),
      )
      .map(([name]) => name)
      .sort();

    // Exact in both directions: an unexpected caller fails, and an expected one that stopped
    // calling fails too, because then this list no longer describes the contract.
    expect(callers).toEqual(Object.keys(EXPECTED_CALLERS).sort());
  });

  it('hands credit_proceeds a balance that came from the staking ladder', () => {
    for (const caller of Object.keys(EXPECTED_CALLERS)) {
      const body = bodies.get(caller);
      expect(body, `${caller} is missing`).toBeDefined();
      const lines = code(body ?? '');

      const call = lines.find((l) => l.includes('credit_proceeds('));
      expect(call, `${caller} does not call credit_proceeds`).toBeDefined();

      // The balance argument, i.e. `credit_proceeds(vault, <balance>, ...)`.
      const balance = call?.match(/credit_proceeds\s*\(\s*[a-z_]+\s*,\s*([a-z_0-9]+)/)?.[1];
      expect(balance, `could not read the balance argument in ${caller}`).toBeDefined();

      // That identifier must be bound, in this same function, by a stake_ladder call. Anything
      // else — a Coin a caller passed in, a balance taken from another field — is a funding
      // route recommendation 22 says needs counsel first.
      const binding = lines.find(
        (l) => l.includes(`let (`) && l.includes(balance!) && LADDER_CALL.test(l),
      );
      expect(
        binding,
        `${caller} passes '${balance}' to credit_proceeds without binding it from stake_ladder`,
      ).toBeDefined();
    }
  });

  it('is the only module that names the rebate pool', () => {
    const others = readdirSync(sources)
      .filter((f) => f.endsWith('.move') && f !== 'stake_vault.move')
      .filter((f) => readFileSync(join(sources, f), 'utf8').includes('rebate_pool'));

    // The flow leg (`creator`) moves third-party payments. If it ever learns this field's name,
    // that is the exact change this file exists to catch.
    expect(others).toEqual([]);
  });
});
