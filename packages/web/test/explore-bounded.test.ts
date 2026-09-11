// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const query = vi.fn();

vi.mock('@/lib/db', () => ({
  db: () => ({ query: (...a: unknown[]) => query(...a) }),
  normaliseAddress: (a: string) => a.toLowerCase(),
}));
vi.mock('@/lib/chain', () => ({ siteConfig: () => ({ ok: false, failure: { kind: 'unconfigured', detail: 'x' } }) }));

const statements = (): string[] =>
  query.mock.calls.map((c) => String(c[0] ?? '').replace(/\s+/g, ' ').trim());

const postQuery = (): string => statements().find((s) => /FROM posts p/i.test(s)) ?? '';

beforeEach(() => {
  vi.resetModules();
  query.mockReset();
  query.mockResolvedValue({ rows: [] });
});

afterEach(() => vi.resetModules());

describe('the explore query can actually stop early', () => {
  it('does not aggregate, so the LIMIT reaches the index', async () => {
    const { discover } = await import('../lib/discovery');

    await discover('');

    expect(postQuery()).not.toMatch(/GROUP BY/i);
    expect(postQuery()).not.toMatch(/LEFT JOIN assets/i);
  });

  it('still asks for the asset ids', async () => {
    const { discover } = await import('../lib/discovery');

    await discover('');

    expect(postQuery()).toMatch(/SELECT array_agg\(a\.id ORDER BY a\.id\) FROM assets a WHERE a\.post_id = p\.id/i);
    expect(postQuery()).toMatch(/asset_ids/i);
  });

  it('keeps the limit, as a parameter', async () => {
    const { discover } = await import('../lib/discovery');

    await discover('');

    expect(postQuery()).toMatch(/LIMIT \$\d+/i);
  });

  it('orders by a total key, like the feed', async () => {
    const { discover } = await import('../lib/discovery');

    await discover('');

    expect(postQuery()).toMatch(/ORDER BY p\.created_at_ms DESC, p\.id DESC/i);
  });

  it('is the same shape when a search term is given', async () => {
    const { discover } = await import('../lib/discovery');

    await discover('atlas');

    expect(postQuery()).not.toMatch(/GROUP BY/i);
    expect(postQuery()).toMatch(/ILIKE/i);
    expect(postQuery()).toMatch(/LIMIT \$\d+/i);
  });
});
