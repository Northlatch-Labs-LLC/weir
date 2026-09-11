// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const query = vi.fn();

vi.mock('@/lib/db', () => ({
  db: () => ({ query: (...a: unknown[]) => query(...a) }),
  normaliseAddress: (a: string) => a.toLowerCase(),
}));

function statements(): string[] {
  return query.mock.calls.map((c) => String(c[0] ?? '').replace(/\s+/g, ' ').trim());
}

const deletes = (): string[] => statements().filter((s) => /^DELETE FROM issued_quotes/i.test(s));

beforeEach(async () => {
  vi.resetModules();
  query.mockReset();
  query.mockResolvedValue({ rows: [], rowCount: 0 });
  const { resetQuoteSweep } = await import('../lib/checkout');
  resetQuoteSweep();
});

afterEach(() => {
  vi.resetModules();
});

describe('writing a quote reclaims expired ones', () => {
  it('sweeps on the path that writes, not only on the path that submits', async () => {
    const { rememberQuote } = await import('../lib/checkout');

    await rememberQuote('AAAA');

    expect(deletes().length).toBe(1);
    expect(deletes()[0]).toMatch(/expires_at_ms < \$1/i);
  });

  it('bounds the sweep, so one unlucky caller does not pay for every row ever written', async () => {
    const { rememberQuote } = await import('../lib/checkout');

    await rememberQuote('AAAA');

    expect(deletes()[0]).toMatch(/LIMIT 500/i);
  });

  it('still writes the quote', async () => {
    const { rememberQuote } = await import('../lib/checkout');

    const returned = await rememberQuote('AAAA');

    expect(returned).toBe('AAAA');
    expect(statements().some((s) => /^INSERT INTO issued_quotes/i.test(s))).toBe(true);
  });

  it('throttles: a burst of quotes does not become a burst of deletes', async () => {
    const { rememberQuote } = await import('../lib/checkout');

    await rememberQuote('A');
    await rememberQuote('B');
    await rememberQuote('C');

    expect(statements().filter((s) => /^INSERT INTO issued_quotes/i.test(s)).length).toBe(3);
    expect(deletes().length).toBe(1);
  });

  it('a failed sweep does not fail the quote', async () => {
    const { rememberQuote } = await import('../lib/checkout');
    query.mockImplementation((sql: string) =>
      /^\s*DELETE FROM issued_quotes/i.test(sql)
        ? Promise.reject(new Error('connection terminated'))
        : Promise.resolve({ rows: [], rowCount: 0 }),
    );

    await expect(rememberQuote('AAAA')).resolves.toBe('AAAA');
  });
});
