// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
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
