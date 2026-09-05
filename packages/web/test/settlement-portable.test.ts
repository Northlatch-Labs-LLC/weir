// Built-by: @projectx.sui · Co-authored-by: Claude
/**
 * A coin's decimals are read from that coin, never written into a call site.
 *
 * # Why settlement portability reduces to this one rule
 *
 * `CreatorVault<phantom T>` fixes the settlement coin as the vault's type parameter, there is no
 * on-chain allowlist, `vaultCoinTypes()` reads the offered denominations from configuration with no
 * default, and every surface that renders an amount reaches for `readDecimals` against the coin it
 * is actually showing. The settlement layer is already portable in the only sense that matters:
 * nothing in it decides what coin a creator's business is denominated in.
 *
 * What can quietly un-portable it is one number. An amount is an integer in a coin's smallest
 * units, and turning it into something a person reads — or turning what a person typed into one —
 * requires that coin's decimals. Native USDC has six and SUI has nine, so a compiled-in scale is
 * not off by a rounding: it is off by a thousand, in whichever direction happens to apply, and it
 * renders a plausible figure while doing it.
 *
 * # Why `scale-guard.test.ts` does not already cover this
 *
 * That test forbids hand-rolled decimal arithmetic — `/ 1_000_000n`, `* 1e9`, `10n ** 6n` — which
 * is the shape the five shipped copies of this bug had. It is the right rule and it still holds.
 *
 * But once `lib/units.ts` existed, the sixth copy did not need to divide by anything. It called the
 * shared formatter and passed the assumption as an argument:
 *
 *     formatUnits(keyPrice.price, target?.decimals ?? 6)
 *
 * That reads as correct code. It imports the agreed helper, it defers to the vault when the vault
 * is known, and it contains no forbidden literal — `scale-guard` sees nothing, because there is
 * nothing there of the shape it looks for. The assumption has simply moved from the operator to the
 * argument. Three such call sites were in `StudioComposer.tsx` and are removed in the same commit
 * as this file.
 *
 * # What is forbidden, exactly
 *
 * A **numeric literal** in the decimals position of `formatUnits`, `parseUnits` or `toMinor` — bare
 * (`, 9)`) or as the right-hand side of a `??` (`, target?.decimals ?? 6)`). The second form is the
 * one worth naming: a fallback is a decision about a coin nobody has read yet, which is precisely
 * the case where no decision can be right. A missing vault is not a six-decimal vault.
 *
 * # What is deliberately permitted
 *
 * A **named constant** — `SUI_DECIMALS`, `USDC_DECIMALS`, both declared in `lib/units.ts`. Nine is
 * a fact about SUI, and a `Balance<SUI>` in `stake_vault.move` really is nine decimals; the stake
 * ladder, the platform treasury and every gas figure are SUI by protocol and not by assumption.
 * What separates the fact from the assumption is that the constant says which coin it is talking
 * about, so a reader can see it is wrong when it is applied to something else. This is the same
 * distinction `scale-guard` draws when it leaves `MIN_STAKE_MIST = 1_000_000_000n` alone: a rule
 * that flagged a named protocol constant is a rule people learn to suppress.
 *
 * Fourteen bare `9`s became `SUI_DECIMALS` in the same commit for that reason. Not one of them was
 * computing a wrong figure — every one was formatting a genuinely SUI-denominated balance. They
 * were changed because a bare `9` and a wrong `6` are indistinguishable at a glance, and a guard
 * that cannot tell them apart either has to forbid both or neither.
 *
 * # The allowlist is empty, and that is an assertion
 *
 * Not an oversight. `lib/units.ts` takes `decimals` as a parameter and raises `10n ** BigInt(...)`;
 * every other module either passes what it read or passes a named constant. The correct
 * implementation needs no exemption from the rule it carries, which is what makes the rule
 * enforceable. The exactness check below fails if an entry is ever added and then cleaned up
 * without being removed, so the list cannot become a quiet record of things nobody intends to fix.
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

/** The three functions that take a scale. Two are shared; `toMinor` is written locally twice. */
const TAKES_DECIMALS = /\b(formatUnits|parseUnits|toMinor)\s*\(/g;

/**
 * The second top-level argument of each such call.
 *
 * Balanced-paren scanning rather than a regex, because the amount argument is routinely itself a
 * call — `formatUnits(BigInt(mist), …)`, `formatUnits(view.claimableSumMist, …)` — and a regex that
 * stopped at the first comma or the first `)` would read the wrong argument and report a clean tree
 * while doing it. The extractor is proved against both shapes below.
 */
export function decimalsArguments(code: string): string[] {
  const found: string[] = [];
  for (const match of code.matchAll(TAKES_DECIMALS)) {
    let i = match.index + match[0].length;
    let depth = 1;
    const start = i;
    while (i < code.length && depth > 0) {
      const ch = code[i];
      if (ch === '(') depth += 1;
      else if (ch === ')') depth -= 1;
      i += 1;
    }
    if (depth !== 0) continue;

    const args = code.slice(start, i - 1);
    const parts: string[] = [];
    let current = '';
    let nesting = 0;
    for (const ch of args) {
      if (ch === '(' || ch === '[' || ch === '{') nesting += 1;
      else if (ch === ')' || ch === ']' || ch === '}') nesting -= 1;
      if (ch === ',' && nesting === 0) {
        parts.push(current);
        current = '';
      } else current += ch;
    }
    parts.push(current);
    const decimals = parts[1];
    if (decimals !== undefined) found.push(decimals.trim());
  }
  return found;
}

/** A scale the call site decided: a bare literal, or one reached through `??`. */
export function isAssumed(argument: string): boolean {
  return /(^|\?\?\s*)\d+$/.test(argument);
}

/**
 * Files permitted to contain one. Exact, not a floor — see the header.
 */
const ALLOWED: string[] = [];

/** Production source only. This file quotes the forbidden shapes in order to assert against them. */
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

describe('a coin decides its own scale', () => {
  it('finds the source tree at all, so a broken glob cannot pass silently', () => {
    // `scale-guard` records a hand-grep that failed exactly this way and reported a clean tree
    // while five copies of the bug sat in it.
    expect(sources.length).toBeGreaterThan(50);
  });

  it('reads the decimals argument at all, so a silent extractor cannot pass either', () => {
    // If this ever returns nothing, every assertion below passes vacuously and for ever.
    const seen = sources.flatMap(({ code }) => decimalsArguments(code));
    expect(seen.length).toBeGreaterThan(20);
  });

  const offenders = sources
    .filter(({ code }) => decimalsArguments(code).some(isAssumed))
    .map(({ file }) => file);

  it('has no module passing a scale it decided for itself', () => {
    expect(offenders.filter((f) => !ALLOWED.includes(f))).toEqual([]);
  });

  it('has no allowlisted module that has since been cleaned up', () => {
    expect(ALLOWED.filter((f) => !offenders.includes(f))).toEqual([]);
  });
});

describe('the extractor reads the argument it claims to read', () => {
  it('takes the second argument past a nested call in the first', () => {
    expect(decimalsArguments('formatUnits(BigInt(mist), SUI_DECIMALS)')).toEqual(['SUI_DECIMALS']);
  });

  it('takes it past a nested call in the second', () => {
    expect(decimalsArguments('formatUnits(a, decimalsOf(coinType))')).toEqual(['decimalsOf(coinType)']);
  });

  it('reads every call on one line, not just the first', () => {
    // `effectivePrice` was one expression containing two of these.
    expect(decimalsArguments('x ? toMinor(p, 6) : (q ?? toMinor(p, t.decimals))')).toEqual([
      '6',
      't.decimals',
    ]);
  });

  it('ignores a call with no second argument rather than inventing one', () => {
    expect(decimalsArguments('formatUnits(amount)')).toEqual([]);
  });
});

describe('the rule catches the shape that shipped, and only it', () => {
  it('catches the exact line this file was written for', () => {
    // Without this the rule could match nothing for ever and report a clean tree.
    expect(isAssumed('target?.decimals ?? 6')).toBe(true);
  });

  it('catches a bare literal', () => {
    expect(isAssumed('9')).toBe(true);
    expect(isAssumed('6')).toBe(true);
  });

  it('leaves a named protocol constant alone', () => {
    // `SUI_DECIMALS` says which coin it is a fact about. A bare `9` does not, which is the whole
    // difference: the constant is wrong visibly when misapplied, the literal is wrong silently.
    expect(isAssumed('SUI_DECIMALS')).toBe(false);
    expect(isAssumed('USDC_DECIMALS')).toBe(false);
  });

  it('leaves a scale that was read alone', () => {
    // The correct form. Flagging it would push people back to the literal.
    expect(isAssumed('target.decimals')).toBe(false);
    expect(isAssumed('decimals.value')).toBe(false);
    expect(isAssumed('await readDecimals(client, coinType)')).toBe(false);
  });

  it('leaves a fallback to something that was also read alone', () => {
    // A `??` is not itself the defect. Deciding the scale is.
    expect(isAssumed('vault?.decimals ?? coin.decimals')).toBe(false);
  });
});
