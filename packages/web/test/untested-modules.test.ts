// Built-by: @projectx.sui · Co-authored-by: Claude
/**
 * The six modules that had no tests at all: earnings, purchases, referrals, discovery,
 * creator-setup and notifications.
 *
 * # What can and cannot be asserted here
 *
 * Every one of them is a single async function that reads the chain, so calling it needs a network
 * and a funded deployment — which is why they went untested. What is testable without either is the
 * part that actually breaks: mirrored constants that silently disagree with the contract, and the
 * discipline that keeps a failed read from rendering as a zero.
 *
 * Both bugs found in this codebase by hand were of exactly that shape. `entitlement.ts` skipped an
 * undecodable subscription and showed a paying subscriber a locked post; the salt derivation
 * disagreed with the SDK on issuer spelling and sent one person to two addresses. Neither threw,
 * neither logged, and neither would have been caught by a test that only exercised a happy path.
 *
 * # The constants are the sharpest of them
 *
 * `MAX_TIERS`, `MIN_PERIOD_MS` and `MAX_PERIOD_MS` are copied from `creator.move` into TypeScript.
 * The copy carried a comment claiming a drift test asserted it. There was no such test. A stale
 * mirror here means the interface accepts a tier the contract rejects, and the user finds out at
 * signing time from an abort code.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_PERIOD_MS, MAX_TIERS, MIN_PERIOD_MS } from '../lib/creator-setup';

const web = join(import.meta.dirname, '..');
const read = (path: string): string => readFileSync(join(web, path), 'utf8');
const move = (): string =>
  readFileSync(join(web, '../../sui-contracts/sources/creator.move'), 'utf8');

/** `const NAME: u64 = <expression>;` from the Move source, evaluated. */
function moveConstant(name: string): number {
  const source = move();
  const match = source.match(new RegExp(`const ${name}: u64 = ([^;]+);`));
  if (match?.[1] === undefined) throw new Error(`${name} is not declared in creator.move`);
  // Move writes `3_650 * 24 * 60 * 60 * 1000`. Underscores are digit separators in both languages,
  // and the expression is arithmetic on literals in both, so it evaluates identically.
  const expression = match[1].replaceAll('_', '').trim();
  if (!/^[\d\s*+]+$/.test(expression)) {
    throw new Error(`${name} is not a plain arithmetic literal: ${expression}`);
  }
  return Number(new Function(`return ${expression}`)());
}

describe('constants mirrored from creator.move', () => {
  /*
   * Read from the contract at test time rather than written down twice. A test that hardcoded 16
   * on both sides would pass forever after somebody changed the contract to 8.
   */
  it.each([
    ['MAX_TIERS', () => MAX_TIERS],
    ['MIN_PERIOD_MS', () => MIN_PERIOD_MS],
    ['MAX_PERIOD_MS', () => MAX_PERIOD_MS],
  ])('%s matches the contract', (name, actual) => {
    expect(actual()).toBe(moveConstant(name));
  });

  it('the bounds are ordered, so a period cannot be both too short and too long', () => {
    expect(MIN_PERIOD_MS).toBeLessThan(MAX_PERIOD_MS);
  });

  it('a one-day period is refused and thirty days is the floor', () => {
    // Both sides of the boundary. The upgraded contract rejects a period below MIN_PERIOD_MS,
    // and an interface that accepted one would spend a user's gas to learn that.
    expect(24 * 60 * 60 * 1000).toBeLessThan(MIN_PERIOD_MS);
    expect(30 * 24 * 60 * 60 * 1000).toBe(MIN_PERIOD_MS);
  });
});

/**
 * Doctrine, asserted by reading the source.
 *
 * These are not stylistic. Each pattern below is a specific way a chain read turns into a confident
 * wrong answer, and each has cost somebody money in a product like this one.
 */
describe('a failed read never becomes a value', () => {
  const modules = [
    'lib/earnings.ts',
    'lib/purchases.ts',
    'lib/referrals.ts',
    'lib/discovery.ts',
    'lib/creator-setup.ts',
    'lib/notifications.ts',
  ] as const;

  /** Source with comments removed — prose describing a defect is not the defect. */
  const code = (path: string): string =>
    read(path)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

  it.each(modules)('%s returns a Reading rather than a bare value', (path) => {
    // The type is what forces a caller to handle failure. A function returning `T` has already
    // decided what a failure looks like, and the only options are a lie or a throw.
    expect(read(path)).toMatch(/Promise<Reading</);
  });

  it.each(modules)('%s never defaults a measured quantity to zero', (path) => {
    /*
     * `?? 0` and `|| 0` on a number read from the chain is the exact mechanism that turns an
     * outage into "you have earned nothing". Zero is a real answer and must only ever be a
     * measured one.
     */
    expect(code(path)).not.toMatch(/\?\?\s*0[^0-9]/);
    expect(code(path)).not.toMatch(/\|\|\s*0[^0-9]/);
    expect(code(path)).not.toMatch(/\?\?\s*0n/);
  });

  it.each(modules)('%s never swallows an error into an empty result', (path) => {
    // `catch { return [] }` reports "nothing here" for "could not look", and an empty list is
    // indistinguishable from a working reader with no data.
    expect(code(path)).not.toMatch(/catch[^{]*\{\s*return\s*(\[\]|\{\})\s*[;}]/);
  });
});

describe('every walk over chain data is bounded', () => {
  /*
   * An unbounded `while (hasNextPage)` is how a scanner issues tens of thousands of calls against
   * a budget of a dozen. Worse, a walk that stops early and reports its partial result as complete
   * makes "that is all of them" and "we ran out" indistinguishable — and they imply opposite next
   * actions.
   */
  it.each([
    ['lib/discovery.ts', 'MAX_RESULTS'],
    ['lib/notifications.ts', 'MAX_PAGES'],
    ['lib/referrals.ts', 'MAX_PAGES'],
    /*
      `lib/verification.ts` was here while it walked `NameSold` events to award a badge. The badge
      is gone and so is the walk — what remains reads one registrar object, which is a single fetch
      with nothing to bound.
    */
    ['lib/chain.ts', 'MAX_PAGES'],
  ])('%s declares a ceiling', (path, ceiling) => {
    expect(read(path)).toContain(ceiling);
  });

  it.each(['lib/discovery.ts', 'lib/notifications.ts', 'lib/referrals.ts', 'lib/chain.ts'])(
    '%s flags a truncated result rather than presenting it as complete',
    (path) => {
      expect(read(path)).toMatch(/truncated/);
    },
  );
});

describe('money is never a float', () => {
  const modules = ['lib/earnings.ts', 'lib/purchases.ts', 'lib/referrals.ts'] as const;

  it.each(modules)('%s uses bigint for amounts', (path) => {
    // `Number` loses precision above 2^53 — for large balances only, which is the worst possible
    // failure schedule: correct in every test, wrong for the biggest creator on the platform.
    expect(read(path)).toMatch(/bigint/);
  });

  it.each(modules)('%s never parses an amount with parseFloat', (path) => {
    expect(read(path)).not.toMatch(/parseFloat/);
  });
});

describe('search does not leak what it searched', () => {
  const discovery = read('lib/discovery.ts');

  it('matches paid posts on preview text, never on the body', () => {
    expect(discovery).toMatch(/preview/);
    expect(discovery).not.toMatch(/to_tsvector\([^)]*\bbody\b/);
    expect(discovery).not.toMatch(/ILIKE[^)]*\bp\.body\b/);
  });
});
