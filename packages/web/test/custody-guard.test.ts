// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
/**
 * "Weir never takes custody" is checked here, not asserted in prose.
 *
 * # What recommendation 26 actually asks for
 *
 * It asks that the non-custodial architecture be *provable rather than asserted* — flow-of-funds
 * documentation somebody outside this company can follow. A document alone cannot do that: it is a
 * comment at repository scale, and a comment is not a constraint. `CUSTODY.md` states the claim in
 * a form a reader can follow into the source, and this file is what stops the source moving out
 * from under it.
 *
 * # The claim, and why it reduces to something mechanical
 *
 * A `Balance` inside a shared object is unreachable from outside the module that declares it, and
 * Move enforces that. So every way value can leave is a place a module splits one of those stored
 * fields, and the complete list of exits is a grep away — seven of them, one per balance.
 *
 * The whole non-custodial claim is then one property of that list: the two balances that hold
 * supporters' money, `StakeVault.liquid` and `StakeVault.rebate_pool`, are split ONLY inside
 * functions that authenticate the caller as the depositor, and NEVER inside a function reachable
 * by holding a capability. `StakeCap` and `PlatformCap` are the two keys this company or a creator
 * can possess; if neither appears in the signature of either function, no key we hold can move a
 * supporter's principal.
 *
 * That is not restraint and it is not policy. It is the absence of a function, and the way to add
 * one is to add a `split` of a supporter's balance to something holding a cap — which is precisely
 * what fails below.
 *
 * # Why the exact set, in both directions
 *
 * Same discipline as `scale-guard.test.ts` and `rebate-source-guard.test.ts`. An exit that appears
 * fails; an exit that disappears fails too. A list that only grows quietly becomes a record of
 * things nobody intends to check, and a removed exit is a real change to the flow of funds that
 * should have to be looked at, even when it is a good one.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const repo = join(import.meta.dirname, '..', '..', '..');
const SOURCES = join(repo, 'sui-contracts', 'sources');
const CUSTODY = join(repo, 'CUSTODY.md');

/** `public fun x`, `public(package) fun x`, `entry fun x`, `fun x`. */
const FUNCTION = /^\s*(?:public(?:\(package\))?\s+)?(?:entry\s+)?fun\s+(\w+)/;

/** `vault.liquid.split(` — a split of a STORED field, which is an exit from the object. */
const STORED_SPLIT = /(\w+)\.(\w+)\.split\(/g;

type Exit = {
  /** `module::function` */
  readonly where: string;
  /** The field split, e.g. `liquid`. */
  readonly balance: string;
  /** The whole text of the function it sits in, for reading its signature. */
  readonly body: string;
};

/**
 * Every module split into its top-level functions.
 *
 * Brace counting from the `fun` line rather than a parser: these modules are formatted, one
 * top-level function per brace pair, and a real Move parser to answer "which function is this line
 * in" would be more moving parts than the question deserves.
 */
function functionsOf(source: string): Map<string, string> {
  const out = new Map<string, string>();
  const lines = source.split('\n');

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    const named = FUNCTION.exec(line);
    const name = named?.[1];
    if (name === undefined) continue;

    let depth = 0;
    let started = false;
    const body: string[] = [];

    for (let j = i; j < lines.length; j += 1) {
      const inner = lines[j] ?? '';
      body.push(inner);
      for (const ch of inner) {
        if (ch === '{') {
          depth += 1;
          started = true;
        } else if (ch === '}') depth -= 1;
      }
      if (started && depth <= 0) break;
    }

    out.set(name, body.join('\n'));
  }

  return out;
}

/** Move source with `//` line comments removed, for rules that must read code and not prose. */
function withoutComments(source: string): string {
  return source
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
}

function exits(): Exit[] {
  const found: Exit[] = [];

  for (const file of readdirSync(SOURCES).sort()) {
    if (!file.endsWith('.move')) continue;
    const module = file.slice(0, -'.move'.length);

    for (const [name, body] of functionsOf(readFileSync(join(SOURCES, file), 'utf8'))) {
      for (const match of body.matchAll(STORED_SPLIT)) {
        const balance = match[2];
        if (balance === undefined) continue;
        found.push({ where: `${module}::${name}`, balance, body });
      }
    }
  }

  return found;
}

/**
 * The flow of funds, exactly as `CUSTODY.md` states it.
 *
 * Every stored balance in the system, the one function that lets value out of it, and what a
 * caller has to hold to get there. `owner` is what the table in that document calls "what the
 * caller must hold": `depositor` means the supporter's own `SocialAccount` authenticated against
 * `ctx.sender()`, and the two caps are the keys a creator or this company can possess.
 */
const FLOW = [
  { balance: 'liquid', where: 'stake_vault::withdraw', owner: 'depositor' },
  { balance: 'rebate_pool', where: 'stake_vault::claim_rebate', owner: 'depositor' },
  { balance: 'creator_yield', where: 'stake_vault::claim_creator_yield', owner: 'StakeCap' },
  { balance: 'platform_yield', where: 'stake_vault::claim_platform_yield', owner: 'PlatformCap' },
  { balance: 'earnings', where: 'creator::claim_earnings', owner: 'CreatorCap' },
  { balance: 'platform_fees', where: 'creator::claim_platform_fees', owner: 'PlatformCap' },
  { balance: 'treasury', where: 'platform::sweep_treasury', owner: 'PlatformCap' },
] as const;

/** The balances holding money that belongs to a supporter rather than to a creator or to us. */
const SUPPORTER_OWNED = ['liquid', 'rebate_pool'];

/** The capabilities a creator or this company can hold. */
const CAPABILITIES = ['StakeCap', 'PlatformCap', 'CreatorCap'];

describe('the exits are the ones the document names, and only those', () => {
  it('finds one exit per stored balance, in the function CUSTODY.md names', () => {
    const found = exits()
      .map((e) => `${e.balance} -> ${e.where}`)
      .sort();
    const documented = FLOW.map((f) => `${f.balance} -> ${f.where}`).sort();

    // Exact in both directions. A new exit fails; a removed one fails too, because either is a
    // change to the flow of funds and the document is what people will be reading instead.
    expect(found).toEqual(documented);
  });

  it('lets value out of each balance in exactly one place', () => {
    const perBalance = new Map<string, number>();
    for (const exit of exits()) {
      perBalance.set(exit.balance, (perBalance.get(exit.balance) ?? 0) + 1);
    }

    for (const { balance } of FLOW) {
      expect(perBalance.get(balance)).toBe(1);
    }
  });
});

describe('no key this company can hold reaches a supporter’s money', () => {
  it('authenticates the depositor at both supporter-owned balances', () => {
    for (const exit of exits()) {
      if (!SUPPORTER_OWNED.includes(exit.balance)) continue;

      // The caller must prove they are the address the position is recorded against. Not a cap,
      // not an owner check on the vault: the depositor's own account, against ctx.sender().
      expect(exit.body).toContain('account::assert_authenticates');
      expect(exit.body).toContain('let who = ctx.sender();');
    }
  });

  it('never lets a capability into a function that splits a supporter-owned balance', () => {
    for (const exit of exits()) {
      if (!SUPPORTER_OWNED.includes(exit.balance)) continue;

      // The signature only — a capability named in a comment inside the body is prose, and
      // failing on it would teach people to stop explaining themselves.
      const signature = exit.body.slice(0, exit.body.indexOf('{'));
      for (const capability of CAPABILITIES) {
        expect(signature).not.toContain(capability);
      }
    }
  });

  it('keeps every capability-reachable exit off the supporters’ balances', () => {
    // The same property from the other side, so it cannot be satisfied by renaming a balance:
    // whatever a cap can reach must be one of the four this document says it can.
    const byCap = FLOW.filter((f) => f.owner !== 'depositor').map((f) => f.balance);

    expect(byCap.sort()).toEqual(
      ['creator_yield', 'earnings', 'platform_fees', 'platform_yield', 'treasury'].sort(),
    );
    for (const balance of byCap) {
      expect(SUPPORTER_OWNED).not.toContain(balance);
    }
  });
});

describe('the platform’s fee is segregated rather than intermediated', () => {
  it('splits an incoming payment where it lands and stores both legs in the creator’s own vault', () => {
    const settle = functionsOf(readFileSync(join(SOURCES, 'creator.move'), 'utf8')).get('settle');
    expect(settle).toBeDefined();

    // The commission accrues inside the creator's vault object, per creator, never pooled, so no
    // payment passes through an account this company controls.
    expect(settle).toContain('vault.platform_fees.join(');
    expect(settle).toContain('vault.earnings.join(funds)');

    /*
      The remainder is JOINED, not split: conservation of value is structural rather than
      something the arithmetic has to come out even for. Splitting a computed creator_net and
      destroying a supposedly-zero remainder is the version this must not become.

      Checked against the CODE, with line comments stripped. The first version of this assertion
      matched the phrase inside `settle`'s own comment — which says, in as many words, that it is
      deliberately NOT doing this — and failed the file for explaining itself well. That is the
      same mistake the capability check above avoids by reading only the signature, made one test
      later. A rule that punishes a good comment teaches people to delete their comments.
    */
    expect(withoutComments(settle ?? '')).not.toMatch(/funds\.split\(creator_net\)/);
  });
});

describe('the document cannot fall behind the code', () => {
  const custody = readFileSync(CUSTODY, 'utf8');

  it('names every balance and every exit that actually exists, on one row together', () => {
    /*
      Balance and exit on THE SAME LINE, which in this document means the same row of the table.

      The first version asserted each name appeared somewhere in the file, and a mutation renaming
      the treasury row survived it: the word "treasury" also occurs in the prose about what a
      PlatformCap can do, so the check was satisfied by a sentence rather than by the row a reader
      would follow. Requiring the pairing makes the assertion about the table.
    */
    const lines = custody.split('\n');

    for (const { balance, where } of FLOW) {
      /*
        The balance as its own code span, `treasury`, and not as a bare substring. The second
        version of this check still survived the renamed-row mutation, because the exit in that
        same row is `platform::sweep_treasury` and "treasury" is a substring of it — so the row
        matched itself through the function name after the balance had been renamed away.
      */
      const row = lines.find((line) => line.includes(`\`${balance}\``) && line.includes(where));

      expect(row, `no row in CUSTODY.md pairs \`${balance}\` with ${where}`).toBeDefined();
    }
  });

  it('still points at the guard that keeps the rebate pool yield-sourced', () => {
    // The neighbouring guard is load-bearing for one of this document's claims: that the only
    // money entering rebate_pool came from staking. If that file is renamed, the reader following
    // this document is sent nowhere.
    expect(custody).toContain('rebate-source-guard.test.ts');
  });

  it('sends the reader to a page that exists', () => {
    /*
      Where this document tells somebody to go next for the upgrade authority. A custody document
      with a dead link is worse than one with no links: it reads as though it has been checked.

      The document's other pointer, `packages/web/test/rebate-source-guard.test.ts`, is checked as
      TEXT above and deliberately not checked for existence here. That file is on a sibling branch
      that lands in the same daily merge as this one; asserting it from this branch would fail for
      a reason about branch order rather than about the code, and loosening a guard to accommodate
      that is how a guard becomes decoration. When both branches are on main, the reference is
      live, and the text assertion is what keeps its name honest in the meantime.
    */
    expect(custody).toContain('weir.social/security');
    expect(() => readFileSync(join(import.meta.dirname, '..', 'app/security/page.tsx'))).not.toThrow();
  });

  it('claims the count it can actually support', () => {
    // The prose says seven stored balances. A reader who counts should get the same answer the
    // parser does, and a document that says "eight" while the code has seven is the drift this
    // whole file exists to prevent.
    expect(custody).toMatch(/\*\*seven stored balances\*\*/);
    expect(exits().length).toBe(7);
    expect(FLOW.length).toBe(7);
  });
});
