// @vitest-environment happy-dom
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
/**
 * The vault's clauses reach the screen, and stay tied to the agreement they came from.
 *
 * # The defect this exists to catch
 *
 * A disclosure is the easiest thing in a codebase to quietly weaken. Nothing throws when a clause
 * is deleted, nothing renders wrong, no other test notices, and the page looks better without it.
 * The vault page's own history is the example: it carried an honest note about the mechanics for
 * months while the two facts that would change somebody's mind — how little this earns, and that
 * the contract is unaudited — sat in `content/legal/terms.md` at 9.1 and 9.3 where nobody reads
 * them at the moment they deposit.
 *
 * So this test asserts three separate things, and each one fails on its own:
 *
 *   Every clause in `VAULT_DISCLOSURE` is on the rendered screen, by identity against the module
 *   rather than against prose copied into the test. A reworded clause keeps passing; a deleted or
 *   emptied one does not.
 *   The magnitude figures are DERIVED from the published rate range. A hand-typed multiple beside
 *   a range is two numbers that drift, which is `scale-guard.test.ts`'s defect class in a new
 *   place.
 *   The terms still say what the page claims they say. The page tells the reader these are "the
 *   same terms you agree to", so a clause removed from `terms.md` and left standing on the page
 *   turns that sentence into a false one.
 *
 * # The surfaces are checked by source, not by rendering the page
 *
 * `app/(app)/vault/[id]/page.tsx` is a server component that reads the chain, and standing a fake
 * chain up to prove one import would test the fake. What matters is narrower and is exactly what a
 * source read answers: the surfaces render the module instead of holding prose of their own.
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { VaultDisclosure } from '@/components/VaultDisclosure';
import {
  ANNUAL_RATE_PERCENT,
  MONTHLY_MULTIPLE,
  multipleFor,
  vaultDisclosure,
  vaultDisclosureShort,
  VAULT_DISCLOSURE,
  VAULT_DISCLOSURE_SHORT,
} from '@/lib/vault-disclosure';

const web = join(import.meta.dirname, '..');
const read = (rel: string) => readFileSync(join(web, rel), 'utf8');

const VAULT_PAGE = 'app/(app)/vault/[id]/page.tsx';
const DEPOSIT = 'components/DepositCheckout.tsx';
const TERMS = 'content/legal/terms.md';

afterEach(cleanup);

describe('the clauses reach the screen', () => {
  it('renders every clause in the module, and nothing is empty', () => {
    render(<VaultDisclosure />);

    expect(VAULT_DISCLOSURE.length).toBeGreaterThan(0);
    for (const clause of VAULT_DISCLOSURE) {
      expect(clause.title.length).toBeGreaterThan(0);
      expect(clause.body.length).toBeGreaterThan(0);
      // Identity against the module, not prose repeated here: rewording a clause must not fail.
      expect(screen.getByText(clause.title)).toBeTruthy();
      expect(screen.getByText(clause.body)).toBeTruthy();
    }
  });

  it('keeps the four clauses recommendation 20 turns on, addressed by id rather than by wording', () => {
    const ids = VAULT_DISCLOSURE.map((c) => c.id);
    for (const required of ['principal', 'magnitude', 'not-promised', 'contract-risk']) {
      expect(ids).toContain(required);
    }
  });

  it('says the two things a supporter cannot get from the numbers on the page', () => {
    const magnitude = VAULT_DISCLOSURE.find((c) => c.id === 'magnitude');
    const risk = VAULT_DISCLOSURE.find((c) => c.id === 'contract-risk');

    // The whole of recommendation 20: this is a loyalty mechanic, not income.
    expect(magnitude?.body).toMatch(/not income/i);
    expect(risk?.body).toMatch(/not been independently audited/i);
  });
});

describe('the figures are derived, not typed', () => {
  it('computes the monthly multiple from the published range at both ends', () => {
    // 100 / percent * 12, to the nearest hundred. Recomputed here from the exported range so a
    // change to the range moves both sides of the comparison together — the point is that the
    // multiple FOLLOWS the rate, not that it equals any particular number today.
    const expected = (annual: number) => Math.round(((100 / annual) * 12) / 100) * 100;

    expect(MONTHLY_MULTIPLE.low).toBe(expected(ANNUAL_RATE_PERCENT.high));
    expect(MONTHLY_MULTIPLE.high).toBe(expected(ANNUAL_RATE_PERCENT.low));
    expect(MONTHLY_MULTIPLE.low).toBeLessThan(MONTHLY_MULTIPLE.high);
  });

  it('writes the sentence from the range it is given, not from the range it was written against', () => {
    /*
      The check that matters, and the one the first version of this test got wrong.

      Asserting the body contains "600" passes whether the figure was interpolated or typed,
      because 600 is what the interpolation evaluates to today. So the clauses are built from a
      DIFFERENT range and the sentence has to move: at 4–8 percent a year the multiples are 200×
      and 300×, and a hand-typed 600 cannot follow.
    */
    const other = { low: 4, high: 8 };
    const moved = vaultDisclosure(other).find((c) => c.id === 'magnitude');
    const expected = multipleFor(other);

    expect(moved?.body).toContain(`${other.low} to ${other.high} percent a year`);
    expect(moved?.body).toContain(expected.low.toLocaleString('en-US'));
    expect(moved?.body).toContain(expected.high.toLocaleString('en-US'));

    // And the figures actually differ from the published ones, so the assertion above is not
    // quietly comparing a number to itself.
    expect(expected.low).not.toBe(MONTHLY_MULTIPLE.low);
    expect(expected.high).not.toBe(MONTHLY_MULTIPLE.high);

    // The short form is built the same way and must move with it.
    expect(vaultDisclosureShort(other)).toContain(`${other.low}–${other.high} percent a year`);

    // The published clause carries the published range.
    const magnitude = VAULT_DISCLOSURE.find((c) => c.id === 'magnitude');
    expect(magnitude?.body).toContain(
      `${ANNUAL_RATE_PERCENT.low} to ${ANNUAL_RATE_PERCENT.high} percent a year`,
    );
    expect(magnitude?.body).toContain(MONTHLY_MULTIPLE.low.toLocaleString('en-US'));
    expect(magnitude?.body).toContain(MONTHLY_MULTIPLE.high.toLocaleString('en-US'));

    // The rate is the network's. A disclosure that let the reader think Weir sets it would be
    // worse than none, because it would read as a rate somebody here could be held to.
    expect(magnitude?.body).toMatch(/not by Weir/i);
  });

  it('carries the magnitude and the audit status into the short form at the signature', () => {
    expect(VAULT_DISCLOSURE_SHORT).toContain(String(ANNUAL_RATE_PERCENT.low));
    expect(VAULT_DISCLOSURE_SHORT).toContain(String(ANNUAL_RATE_PERCENT.high));
    expect(VAULT_DISCLOSURE_SHORT).toMatch(/unaudited/i);
  });
});

describe('the surfaces render the module instead of their own prose', () => {
  it('puts the full clauses on the vault page', () => {
    const page = read(VAULT_PAGE);

    expect(page).toContain("from '@/components/VaultDisclosure'");
    expect(page).toContain('<VaultDisclosure />');
  });

  it('puts the short form at the moment of signature', () => {
    const deposit = read(DEPOSIT);

    expect(deposit).toContain("from '@/lib/vault-disclosure'");
    expect(deposit).toContain('{VAULT_DISCLOSURE_SHORT}');
  });

  it('leaves no hand-written copy of a clause behind on either surface', () => {
    /*
      A clause duplicated in JSX is a clause that stops changing when the module does. Checked by a
      distinctive fragment of each body rather than the whole string, because JSX would break a long
      sentence across lines and an exact match would pass for the wrong reason.

      The list is deliberately narrow, and one obvious entry is deliberately absent. The vault
      page's hero says "withdrawable in full at any time" and is meant to: it is the page's
      headline, it predates this module, and the `principal` clause restating it lower down is the
      long form of a promise the contract actually keeps. Flagging it would teach the next person
      to delete a true headline to satisfy a test. What has no business outside the module is the
      substance nothing else on the page carries — the magnitude and the audit status.
    */
    const surfaces = [read(VAULT_PAGE), read(DEPOSIT)].join('\n');

    for (const fragment of ['not income', 'independently audited', 'percent a year']) {
      expect(surfaces).not.toContain(fragment);
    }
  });
});

describe('the page and the agreement cannot drift apart', () => {
  it('finds each clause still standing in the terms it says it comes from', () => {
    const terms = read(TERMS);

    /*
      Addressed by substance, not by section number: renumbering the terms is editorial, removing
      the unaudited-beta clause is not. Each of these is what one rendered clause claims the terms
      already say.

      No alternation. The first version wrote `/not been independently audited|unaudited/`, and the
      terms happen to carry both phrasings — 1.4 says the contracts "have not been independently
      audited" and 9.1 calls them "unaudited software" — so deleting either one still matched the
      other and the mutation survived. Two clauses, two assertions.
    */
    expect(terms).toMatch(/not been independently audited/i);
    expect(terms).toMatch(/unaudited/i);
    expect(terms).toMatch(/may be zero/i);
    expect(terms).toMatch(/not interest/i);
    expect(terms).toMatch(/Nothing on the Service is a deposit account/i);
  });

  it('keeps the link the page offers pointing at a page that exists', () => {
    const component = read('components/VaultDisclosure.tsx');

    expect(component).toContain('href="/legal/terms"');
    expect(() => read('app/legal/terms/page.tsx')).not.toThrow();
  });
});

describe('the disclosure does not borrow the vocabulary it exists to avoid', () => {
  it('states the limits without any of the words recommendation 23 forbids', () => {
    // A disclaimer is the most tempting place to write "this is not an investment" or "returns are
    // not guaranteed" — and every one of those words reintroduces the register the language pass
    // removed everywhere else. "Nobody promises it" and "not income" carry the same meaning and
    // borrow none of it. Checked on the module rather than on the whole tree, which is
    // `vault-language.test.ts`'s job.
    const source = [
      ...VAULT_DISCLOSURE.map((c) => `${c.title} ${c.body}`),
      VAULT_DISCLOSURE_SHORT,
    ].join('\n');

    for (const forbidden of ['APY', 'yield vault', 'savings', 'returns', 'earn interest', 'investment', 'guaranteed']) {
      expect(source.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
});
