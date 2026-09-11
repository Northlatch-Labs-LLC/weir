// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
/**
 * No amount is ever divided by a scale somebody assumed.
 *
 * # The defect class, and why five fixes were not enough
 *
 * A price, a balance and an earning are all integers in a coin's smallest units, and turning one
 * into something a person reads requires knowing that coin's decimals. Reading them is one call.
 * Assuming them is one literal — and the literal is shorter, so it kept winning.
 *
 * Five surfaces shipped with `1_000_000n` compiled in: `explore`, the creator page, the home page,
 * the notifications feed and the messages component. Each was correct for native USDC and wrong by
 * three orders of magnitude for a nine-decimal coin. None of them threw, logged, or looked wrong:
 * the figure rendered, it was plausible, and it was false. They were found one at a time, by eye,
 * over two days.
 *
 * A sixth would have been found the same way. `lib/units.ts` had opened with a note saying exactly
 * this, `SubscribeButton` repeated it at the top of its own file, and both were being read by
 * whoever wrote copies four and five. **A comment is not a constraint.** This test is.
 *
 * # What it actually forbids
 *
 * Dividing, taking a modulus of, or multiplying by a decimal-scale literal — `1_000_000n`,
 * `1_000_000_000n`, `1e6`, `1e9`, `10n ** 6n`. That is precisely the shape of a hand-rolled
 * formatter, and it cannot be written without one of them.
 *
 * It does **not** forbid naming such a number. `MIN_STAKE_MIST = 1_000_000_000n` is a protocol
 * constant mirrored from `stake_ladder.move`, not an assumption about anybody's coin, and a rule
 * that flagged it would be a rule people learn to suppress.
 *
 * # The allowlist is exact
 *
 * Same discipline as `reachability.test.ts`. An entry that stops tripping fails this test just as
 * loudly as a new offender, so the list cannot quietly become a record of things nobody intends to
 * fix. Every entry says why it is allowed and what would remove it.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const web = join(import.meta.dirname, '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(join(web, dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(web, rel)).isDirectory()) walk(rel, out);
    else out.push(rel);
  }
  return out;
}

/**
 * Division, modulus or multiplication by a fixed decimal scale.
 */
const ASSUMED_SCALE =
  /[/%*]\s*(1_000_000n|1000000n|1_000_000_000n|1000000000n|1e6|1e9|10n\s*\*\*\s*[69]n)/;

/**
 * Files permitted to contain it. Exact, not a floor.
 *
 * `lib/names-purchase.ts` — the only genuine float conversion in the codebase. A name is priced in
 *   USD and paid in SUI, and the bridge between them is an oracle rate that is itself a float, so
 *   there is no integer path to take. It converts USD micros with `/ 1e6` and ceilings the result
 *   into whole MIST with `* 1e9`, rounding **up** so a rounded-down conversion cannot underpay and
 *   abort. This entry disappears if the rate is ever read as a fixed-point integer.
 *
 * **`lib/units.ts` is deliberately not here.** It was, until the exactness check below rejected it
 * on the day this was written — because it does not assume a scale either. It takes `decimals` as
 * an argument and raises `10n ** BigInt(decimals)`, so the module every other module defers to
 * turns out to need no exemption from the rule it exists to carry. That is the shape a correct
 * implementation has, and the reason the rule is enforceable at all.
 */
const ALLOWED = ['lib/names-purchase.ts'];

/** Production source only. Tests quote the forbidden literals in order to assert against them. */
const sources = ['app', 'components', 'lib']
  .flatMap((d) => walk(d))
  .filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'))
  .map((f) => ({
    file: f,
    // Comments explain the defect at length and must not be mistaken for it.
    code: readFileSync(join(web, f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, ''),
  }));

describe('scale is read, never assumed', () => {
  it('finds the source tree at all, so a broken glob cannot pass silently', () => {
    // The hand-grep this test replaces failed exactly this way once, on a zsh glob, and reported
    // a clean tree while five copies of the bug were sitting in it.
    expect(sources.length).toBeGreaterThan(50);
  });

  const offenders = sources.filter(({ code }) => ASSUMED_SCALE.test(code)).map(({ file }) => file);

  it('has no module dividing by a scale it decided for itself', () => {
    expect(offenders.filter((f) => !ALLOWED.includes(f))).toEqual([]);
  });

  it('has no allowlisted module that has since been cleaned up', () => {
    expect(ALLOWED.filter((f) => !offenders.includes(f))).toEqual([]);
  });

  it('would catch the exact line that shipped five times', () => {
    /*
      The guard proving it can see its own quarry. Without this, a regex that matched nothing —
      a typo, an escaping mistake, a rewritten literal — would report a clean tree for ever.
    */
    expect(ASSUMED_SCALE.test('const w = n / 1_000_000n;')).toBe(true);
    expect(ASSUMED_SCALE.test('const f = (n % 1_000_000n).toString();')).toBe(true);
    expect(ASSUMED_SCALE.test('const gas = Number(mist) / 1e9;')).toBe(true);
  });

  it('leaves a named protocol constant alone', () => {
    // `lib/ladder.ts` declares this, mirrored from `stake_ladder.move`. It is a value, not a scale.
    expect(ASSUMED_SCALE.test('export const MIN_STAKE_MIST = 1_000_000_000n;')).toBe(false);
    expect(ASSUMED_SCALE.test('const MIST_PER_SUI = 1_000_000_000n;')).toBe(false);
  });

  it('leaves a scale built from decimals it was given alone', () => {
    // The correct generic form. Flagging it would push people back to the literal.
    expect(ASSUMED_SCALE.test('const scale = 10n ** BigInt(decimals);')).toBe(false);
  });
});
