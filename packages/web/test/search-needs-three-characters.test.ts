// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
//
// A one- or two-character search is a sequential scan over five columns, on a public route.
//
// The five indexes behind `discover` are GIN with `gin_trgm_ops`, which decomposes a string into
// three-character sequences. `pg_trgm` extracts NO trigrams from a shorter pattern, so
// `ILIKE '%ab%'` has nothing to look up: Postgres cannot use any of them and reads both tables in
// full. The answer is useless as well as expensive — two characters match a large fraction of any
// real corpus, and MAX_RESULTS then truncates the noise.
//
// The empty query is deliberately NOT refused. This module already says an empty query is "a
// directory rather than an error", and that is still true.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const query = vi.fn();

vi.mock('@/lib/db', () => ({
  db: () => ({ query: (...a: unknown[]) => query(...a) }),
  normaliseAddress: (a: string) => a.toLowerCase(),
}));

const { discover } = await import('../lib/discovery');

beforeEach(() => {
  vi.resetModules();
  query.mockReset();
  query.mockResolvedValue({ rows: [], rowCount: 0 });
});

describe('a search short enough to defeat its own index is refused', () => {
  it('refuses one character, and issues no statement at all', async () => {
    const r = await discover('a');
    expect(r.ok).toBe(false);
    // The point is not the error. It is that the database was never asked.
    expect(query).not.toHaveBeenCalled();
  });

  it('refuses two characters', async () => {
    const r = await discover('ab');
    expect(r.ok).toBe(false);
    expect(query).not.toHaveBeenCalled();
  });

  it('counts characters after trimming, so "  a  " is one character and not five', async () => {
    const r = await discover('  a  ');
    expect(r.ok).toBe(false);
    expect(query).not.toHaveBeenCalled();
  });

  /*
    The converse half, and it is three separate cases because a guard that refused any of them
    would be worse than the scan it prevents: an empty query is the directory this page exists to
    show, and three characters is the shortest search a trigram index can actually serve.
  */
  it('still serves the empty query as a directory', async () => {
    const r = await discover('');
    expect(r.ok).toBe(true);
    expect(query).toHaveBeenCalled();
  });

  it('serves three characters, which is the shortest a trigram index can answer', async () => {
    const r = await discover('abc');
    expect(r.ok).toBe(true);
    expect(query).toHaveBeenCalled();
  });

  it('serves a longer search', async () => {
    const r = await discover('kaela');
    expect(r.ok).toBe(true);
    expect(query).toHaveBeenCalled();
  });
});
