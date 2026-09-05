// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
  The feed asks for a page, not for the archive.

  `listPosts` carried no `LIMIT` at all. The home feed called it with no arguments and sliced ten
  rows off the front in JavaScript, so showing a logged-out visitor ten posts selected every post in
  the table — every body, and every asset row joined to it — and threw the rest away. The cost of
  the front page grew with the archive, and it was paid on one of a small number of pooled
  connections.

  These assert the SQL, because that is where the defect was. A test that only checked the returned
  array length would have passed against the original code: it returned the right ten posts. It read
  the whole table to do it.
*/

const query = vi.fn();

vi.mock('@/lib/db', () => ({
  db: () => ({ query: (...a: unknown[]) => query(...a) }),
  normaliseAddress: (a: string) => a.toLowerCase(),
}));

/** The SQL of the last query issued, whitespace collapsed so assertions can be written plainly. */
function lastSql(): string {
  const call = query.mock.calls.at(-1);
  return String(call?.[0] ?? '').replace(/\s+/g, ' ').trim();
}

/** The parameters of the last query issued. */
function lastParams(): unknown[] {
  return (query.mock.calls.at(-1)?.[1] as unknown[]) ?? [];
}

beforeEach(() => {
  query.mockReset();
  query.mockResolvedValue({ rows: [] });
});

afterEach(() => {
  vi.resetModules();
});

describe('listPosts is bounded at the database', () => {
  it('always sends a LIMIT, even when the caller names none', async () => {
    const { listPosts } = await import('../lib/content');
    await listPosts();

    // The defect was the absence of this word. Nothing else in the query mattered as much.
    expect(lastSql()).toMatch(/LIMIT \$\d+/i);
  });

  it('passes the limit as a parameter rather than interpolating it', async () => {
    const { listPosts } = await import('../lib/content');
    await listPosts({ limit: 10 });

    expect(lastParams()).toContain(10);
    // A number pasted into SQL is a number that can one day be a string from a caller.
    expect(lastSql()).not.toMatch(/LIMIT 10/i);
  });

  it('refuses to be talked into an unbounded read', async () => {
    const { listPosts } = await import('../lib/content');
    await listPosts({ limit: 10_000_000 });

    const limit = Number(lastParams().at(-1));
    expect(limit).toBeLessThanOrEqual(200);
    expect(limit).toBeGreaterThan(0);
  });

  it('does not aggregate, so the limit can reach the index', async () => {
    const { listPosts } = await import('../lib/content');
    await listPosts({ limit: 10 });

    /*
      With `LEFT JOIN assets … GROUP BY p.id`, the limit bounds the rows returned and not the rows
      read: the group key is not the sort key, so the whole join is aggregated and sorted first. The
      asset ids come from a correlated subquery for exactly this reason.
    */
    expect(lastSql()).not.toMatch(/GROUP BY/i);
    expect(lastSql()).not.toMatch(/LEFT JOIN assets/i);
  });

  it('orders by a total key, so a page boundary cannot lose a row', async () => {
    const { listPosts } = await import('../lib/content');
    await listPosts();

    // Two posts written in the same millisecond have no defined order without the tiebreak, and a
    // cursor landing between them would drop or repeat one.
    expect(lastSql()).toMatch(/ORDER BY p\.created_at_ms DESC, p\.id DESC/i);
  });

  it('seeks past the previous page by value rather than counting past it', async () => {
    const { listPosts } = await import('../lib/content');
    await listPosts({ after: { createdAtMs: 1756600000000, id: 'pabc' } });

    // Keyset, not OFFSET: OFFSET reads and discards everything before the page.
    expect(lastSql()).not.toMatch(/OFFSET/i);
    expect(lastSql()).toMatch(/\(p\.created_at_ms, p\.id\) </i);
    expect(lastParams()).toContain('pabc');
  });
});

describe('naming unlocks does not read the archive', () => {
  it('asks for the keys it holds, not for every post', async () => {
    const { titlesForContentKeys } = await import('../lib/content');
    const vaultId = `0x${'a1'.repeat(32)}`;
    await titlesForContentKeys([
      { vaultId, contentKey: 'key-1' },
      { vaultId, contentKey: 'key-2' },
      { vaultId, contentKey: 'key-1' },
      { vaultId, contentKey: '' },
    ]);

    const sql = lastSql();
    // Three columns, for named (vault, key) pairs. Not bodies, not assets, not everything.
    expect(sql).toMatch(/SELECT vault_id, content_key, title FROM posts/i);
    expect(sql).toMatch(/\(vault_id, content_key\) IN/i);
    // One row per distinct pair: the duplicate and the empty key are not sent.
    expect(lastParams()[1]).toEqual(['key-1', 'key-2']);
    expect(sql).not.toMatch(/p\.body/i);

    // Deduplicated, and the empty key never reaches the database.
    const keys = lastParams()[1] as string[];
    expect(keys.sort()).toEqual(['key-1', 'key-2']);
  });

  it('asks nothing at all when there is nothing to name', async () => {
    const { titlesForContentKeys } = await import('../lib/content');
    const titles = await titlesForContentKeys([]);

    expect(titles.size).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });
});
