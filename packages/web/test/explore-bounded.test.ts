// @vitest-environment node
// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
//
// /explore had the limit the feed was missing, and it bought nothing.
//
// The query carried `LIMIT $1` and still read the whole table: aggregating before limiting means
// the group key (`p.id`) is not the sort key (`created_at_ms`), so no plan walks `posts_created_idx`
// in order and stops after twenty-six groups. The whole `posts ⋈ assets` product is built and
// sorted first, and the LIMIT bounds the rows RETURNED rather than the rows READ. On the empty
// query — which is what a visitor arriving at /explore sends — that is the entire table to show
// twenty-five rows.
//
// This is why a test on the returned array would have passed throughout: it returned the right
// twenty-five.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const query = vi.fn();

vi.mock('@/lib/db', () => ({
  db: () => ({ query: (...a: unknown[]) => query(...a) }),
  normaliseAddress: (a: string) => a.toLowerCase(),
}));
vi.mock('@/lib/chain', () => ({ siteConfig: () => ({ ok: false, failure: { kind: 'unconfigured', detail: 'x' } }) }));

/** Every statement issued, whitespace collapsed. */
const statements = (): string[] =>
  query.mock.calls.map((c) => String(c[0] ?? '').replace(/\s+/g, ' ').trim());

/** The one that reads posts. */
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

    // The defect: a LIMIT above a GroupAggregate bounds what comes back, not what is read.
    expect(postQuery()).not.toMatch(/GROUP BY/i);
    expect(postQuery()).not.toMatch(/LEFT JOIN assets/i);
  });

  it('still asks for the asset ids', async () => {
    // The join was doing a real job. Removing it without replacing it would strip the pictures off
    // a directory whose whole point is showing them.
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
    // Two posts in the same millisecond have no defined order without the tiebreak. The feed learned
    // this when it grew a cursor; this query shares the ordering and should share the reasoning.
    const { discover } = await import('../lib/discovery');

    await discover('');

    expect(postQuery()).toMatch(/ORDER BY p\.created_at_ms DESC, p\.id DESC/i);
  });

  it('is the same shape when a search term is given', async () => {
    /*
      The searching branch is a separate string in the source, so a fix applied to one and not the
      other is the ordinary way half a defect survives.
    */
    const { discover } = await import('../lib/discovery');

    await discover('atlas');

    expect(postQuery()).not.toMatch(/GROUP BY/i);
    expect(postQuery()).toMatch(/ILIKE/i);
    expect(postQuery()).toMatch(/LIMIT \$\d+/i);
  });
});
