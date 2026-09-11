// @vitest-environment happy-dom
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

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

    expect(magnitude?.body).toMatch(/not income/i);
    expect(risk?.body).toMatch(/not been independently audited/i);
  });
});

describe('the figures are derived, not typed', () => {
  it('computes the monthly multiple from the published range at both ends', () => {
    const expected = (annual: number) => Math.round(((100 / annual) * 12) / 100) * 100;

    expect(MONTHLY_MULTIPLE.low).toBe(expected(ANNUAL_RATE_PERCENT.high));
    expect(MONTHLY_MULTIPLE.high).toBe(expected(ANNUAL_RATE_PERCENT.low));
    expect(MONTHLY_MULTIPLE.low).toBeLessThan(MONTHLY_MULTIPLE.high);
  });

  it('writes the sentence from the range it is given, not from the range it was written against', () => {
    const other = { low: 4, high: 8 };
    const moved = vaultDisclosure(other).find((c) => c.id === 'magnitude');
    const expected = multipleFor(other);

    expect(moved?.body).toContain(`${other.low} to ${other.high} percent a year`);
    expect(moved?.body).toContain(expected.low.toLocaleString('en-US'));
    expect(moved?.body).toContain(expected.high.toLocaleString('en-US'));

    expect(expected.low).not.toBe(MONTHLY_MULTIPLE.low);
    expect(expected.high).not.toBe(MONTHLY_MULTIPLE.high);

    expect(vaultDisclosureShort(other)).toContain(`${other.low}–${other.high} percent a year`);

    const magnitude = VAULT_DISCLOSURE.find((c) => c.id === 'magnitude');
    expect(magnitude?.body).toContain(
      `${ANNUAL_RATE_PERCENT.low} to ${ANNUAL_RATE_PERCENT.high} percent a year`,
    );
    expect(magnitude?.body).toContain(MONTHLY_MULTIPLE.low.toLocaleString('en-US'));
    expect(magnitude?.body).toContain(MONTHLY_MULTIPLE.high.toLocaleString('en-US'));

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
    const surfaces = [read(VAULT_PAGE), read(DEPOSIT)].join('\n');

    for (const fragment of ['not income', 'independently audited', 'percent a year']) {
      expect(surfaces).not.toContain(fragment);
    }
  });
});

describe('the page and the agreement cannot drift apart', () => {
  it('finds each clause still standing in the terms it says it comes from', () => {
    const terms = read(TERMS);

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
    const source = [
      ...VAULT_DISCLOSURE.map((c) => `${c.title} ${c.body}`),
      VAULT_DISCLOSURE_SHORT,
    ].join('\n');

    for (const forbidden of ['APY', 'yield vault', 'savings', 'returns', 'earn interest', 'investment', 'guaranteed']) {
      expect(source.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });
});
