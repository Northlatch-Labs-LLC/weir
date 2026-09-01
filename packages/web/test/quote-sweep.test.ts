// @vitest-environment node
// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
//
// The table that grew on one path and was reclaimed on another.
//
// Every `prepare` route writes a row to `issued_quotes`, and thirteen of them do so with no
// session, no signature and no admin check. The sweep that deletes expired rows lived only inside
// `submitSigned` — the path that CONSUMES a quote. So a caller who only ever prepares and never
// submits inserted rows that nothing reclaimed until some unrelated caller happened to complete a
// purchase. On a deployment where nobody buys anything for an hour, nothing is swept for an hour.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const query = vi.fn();

vi.mock('@/lib/db', () => ({
  db: () => ({ query: (...a: unknown[]) => query(...a) }),
  normaliseAddress: (a: string) => a.toLowerCase(),
}));

/** The SQL of every statement issued, whitespace collapsed. */
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

    // The property: an unauthenticated prepare pays for its own housekeeping.
    expect(deletes().length).toBe(1);
    expect(deletes()[0]).toMatch(/expires_at_ms < \$1/i);
  });

  it('bounds the sweep, so one unlucky caller does not pay for every row ever written', async () => {
    const { rememberQuote } = await import('../lib/checkout');

    await rememberQuote('AAAA');

    expect(deletes()[0]).toMatch(/LIMIT 500/i);
  });

  it('still writes the quote', async () => {
    // The sweep is housekeeping attached to the write; it must not replace it.
    const { rememberQuote } = await import('../lib/checkout');

    const returned = await rememberQuote('AAAA');

    expect(returned).toBe('AAAA');
    expect(statements().some((s) => /^INSERT INTO issued_quotes/i.test(s))).toBe(true);
  });

  it('throttles: a burst of quotes does not become a burst of deletes', async () => {
    /*
      Once a minute per instance. Without the throttle this turns every prepare into two statements
      against a pool of three connections, which is a worse bill than the rows it reclaims.
    */
    const { rememberQuote } = await import('../lib/checkout');

    await rememberQuote('A');
    await rememberQuote('B');
    await rememberQuote('C');

    expect(statements().filter((s) => /^INSERT INTO issued_quotes/i.test(s)).length).toBe(3);
    expect(deletes().length).toBe(1);
  });

  it('a failed sweep does not fail the quote', async () => {
    /*
      The caller is in the middle of being quoted a price. Housekeeping that did not happen is not
      their problem, and the next request tries again — but a sweep that threw would turn a
      bookkeeping error into a refused purchase.
    */
    const { rememberQuote } = await import('../lib/checkout');
    query.mockImplementation((sql: string) =>
      /^\s*DELETE FROM issued_quotes/i.test(sql)
        ? Promise.reject(new Error('connection terminated'))
        : Promise.resolve({ rows: [], rowCount: 0 }),
    );

    await expect(rememberQuote('AAAA')).resolves.toBe('AAAA');
  });
});
