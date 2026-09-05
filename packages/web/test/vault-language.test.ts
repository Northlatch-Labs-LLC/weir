// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/**
 * The vault is never described in the vocabulary of an investment product.
 *
 * # Why a test and not a style note
 *
 * Sui staking pays roughly 1.46%. The vault is a loyalty mechanic and it is not income, and the
 * distance between those two sentences is the whole of the legal exposure: the SEC took $30M from
 * Kraken over a staking programme that advertised returns. The words below are not disliked, they
 * are the specific vocabulary that reintroduces Howey risk, and each of them is a word a well-meaning
 * person reaches for naturally while explaining what the vault does. "Savings product" was already
 * in the interface and in a doc comment when this was written, and nobody put it there in bad faith
 * — it is simply the shortest way to say the thing.
 *
 * That is exactly the shape of defect `scale-guard.test.ts` was written for, and its conclusion
 * applies unchanged: **a comment is not a constraint.** This test is.
 *
 * # What is forbidden, and what is deliberately not
 *
 * Forbidden: "yield vault", "savings", "APY", "earn interest", "guaranteed return", and
 * "investment" used to describe what the vault IS.
 *
 * **Bare "yield" is deliberately not forbidden, and this is the judgement in the file.** The
 * recommendation forbids the compound "yield vault", not the word. Sui produces a staking yield;
 * that is a fact about a validator, and it is the CREATOR's revenue. Howey risk attaches to what is
 * promised to the person putting money IN, not to the person receiving it, and a supporter here is
 * told the opposite of a promise: their deposit stays theirs, withdrawable in full, and it earns
 * them nothing by default. Where a supporter IS handed something, the copy says "give-back" — the
 * vocabulary the recommendation prescribes — rather than a share of a yield.
 *
 * Forbidding the word outright would also mean renaming `POST /api/stake/yield`, a published route
 * other people's software calls, and the on-chain field names underneath it. That is a breaking
 * change to a public interface, not a copy pass, and pretending otherwise would be the kind of
 * rule people learn to suppress.
 *
 * **"No-loss" is also not forbidden here.** It is a claim about capital that the contract actually
 * enforces — `StakePosition.tsx` opens by saying the withdraw button is what makes it real — and it
 * is the name the sibling product at protocolx.io is published under. Renaming it is a product
 * decision across two surfaces, not a language sweep, and it is recorded as out of scope rather
 * than quietly skipped.
 *
 * # The allowlist is exact
 *
 * Same discipline as `scale-guard.test.ts` and `reachability.test.ts`. An entry that stops tripping
 * fails this test as loudly as a new offender, so the list cannot become a quiet record of things
 * nobody intends to fix.
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
 * The vocabulary of a security being offered.
 *
 * `investment` is matched only in the phrases that ASSERT it — "as an investment", "an investment
 * in", "your investment". `Chests.tsx` says we would rather say a donation is a donation "than
 * dress a donation up as an investment", which is the strongest compliance sentence on the site,
 * and a rule that flagged a disclaimer would be teaching people to delete their disclaimers.
 */
const SELLING_A_SECURITY =
  /\byield vault\b|\bsavings\b|\bAPY\b|\bearns? interest\b|\bguaranteed (?:return|yield|income)\b|\b(?:as|an|your|their|the) investment\b/i;

/**
 * Files permitted to contain it. Exact, not a floor.
 *
 * `components/design/Chests.tsx` — the disclaimer described above. It contains "as an investment"
 *   inside the sentence that refuses the framing: a chest "is simply theirs … we would rather say
 *   so than dress a donation up as an investment." This entry disappears only if that sentence is
 *   rewritten, and it should not be.
 */
const ALLOWED = ['components/design/Chests.tsx'];

/**
 * Production source only, comments included.
 *
 * Unlike `scale-guard.test.ts`, comments are NOT stripped here, and the difference is deliberate. A
 * scale bug is a thing the code does; this is a thing the codebase SAYS, and the phrase that
 * prompted this test lived half in an interface string and half in a doc comment on
 * `prepareSetRebate`. A rule that read only the strings would have caught one of the two and
 * declared the pass finished.
 */
const sources = ['app', 'components', 'lib']
  .flatMap((d) => walk(d))
  .filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'));

describe('the vault is never sold as an investment', () => {
  it('finds the source tree at all, so a broken glob cannot pass silently', () => {
    expect(sources.length).toBeGreaterThan(50);
  });

  const offenders = sources.filter((f) =>
    SELLING_A_SECURITY.test(readFileSync(join(web, f), 'utf8')),
  );

  it('has no surface describing the vault in the vocabulary of a security', () => {
    expect(offenders.filter((f) => !ALLOWED.includes(f))).toEqual([]);
  });

  it('has no allowlisted file that has since been rewritten', () => {
    expect(ALLOWED.filter((f) => !offenders.includes(f))).toEqual([]);
  });

  /*
    The guard proving it can see its own quarry. Without this, a regex that matched nothing — a
    typo, a rewritten alternation — would report a clean tree for ever. Every line below is one
    that was actually in this repository, or one word away from a line that was.
  */
  it('would catch the exact phrases that shipped', () => {
    expect(SELLING_A_SECURITY.test('run the vault purely as a savings product for their audience')).toBe(true);
    expect(SELLING_A_SECURITY.test('a creator may run the vault purely as a savings product')).toBe(true);
    expect(SELLING_A_SECURITY.test('Open a yield vault behind your favourite creator')).toBe(true);
    expect(SELLING_A_SECURITY.test('Currently paying 1.46% APY')).toBe(true);
    expect(SELLING_A_SECURITY.test('your deposit earns interest while it sits there')).toBe(true);
    expect(SELLING_A_SECURITY.test('a guaranteed return on every deposit')).toBe(true);
    expect(SELLING_A_SECURITY.test('Think of it as an investment in the creator')).toBe(true);
  });

  it('leaves the disclaimer that refuses the framing alone in spirit, and allowlists it by name', () => {
    /*
      This asserts the mechanism honestly rather than flatteringly: the regex DOES match the
      disclaimer, and the allowlist is what permits it. Writing a regex clever enough to tell a
      disclaimer from a claim would be a heuristic, and a heuristic here fails in the direction that
      publishes the wrong sentence.
    */
    const disclaimer = 'we would rather say so than dress a donation up as an investment';
    expect(SELLING_A_SECURITY.test(disclaimer)).toBe(true);
    expect(ALLOWED).toContain('components/design/Chests.tsx');
  });

  it('leaves the language the vault is actually described in alone', () => {
    // Every one of these is current copy. Flagging them would push people back toward the old words.
    expect(SELLING_A_SECURITY.test('the creator earns the staking yield, and it costs the supporter nothing')).toBe(false);
    expect(SELLING_A_SECURITY.test('This creator hands back 10% of what their vault earns')).toBe(false);
    expect(SELLING_A_SECURITY.test('Some creators run the vault purely as a give-back to their audience')).toBe(false);
    expect(SELLING_A_SECURITY.test('Your deposit stays yours and is withdrawable in full at any time')).toBe(false);
    expect(SELLING_A_SECURITY.test('YOUR GIVE-BACK')).toBe(false);
  });

  it('leaves a technical guarantee about a mechanism alone', () => {
    /*
      The codebase says "guarantee" constantly and correctly — about what a contract enforces, what
      a type checker proves, what a database constraint holds. Only a guaranteed RETURN is a
      securities claim, which is why the pattern requires the second word.
    */
    expect(SELLING_A_SECURITY.test('the database constraint already guarantees it')).toBe(false);
    expect(SELLING_A_SECURITY.test('a build-time guarantee of that')).toBe(false);
    expect(SELLING_A_SECURITY.test('What the contracts guarantee, and what we do not claim')).toBe(false);
  });
});
