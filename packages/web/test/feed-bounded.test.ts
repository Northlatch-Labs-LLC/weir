// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const query = vi.fn();

vi.mock('@/lib/db', () => ({
  db: () => ({ query: (...a: unknown[]) => query(...a) }),
  normaliseAddress: (a: string) => a.toLowerCase(),
}));

function lastSql(): string {
  const call = query.mock.calls.at(-1);
  return String(call?.[0] ?? '').replace(/\s+/g, ' ').trim();
}

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

    expect(lastSql()).toMatch(/LIMIT \$\d+/i);
  });

  it('passes the limit as a parameter rather than interpolating it', async () => {
    const { listPosts } = await import('../lib/content');
    await listPosts({ limit: 10 });

    expect(lastParams()).toContain(10);
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

    expect(lastSql()).not.toMatch(/GROUP BY/i);
    expect(lastSql()).not.toMatch(/LEFT JOIN assets/i);
  });

  it('orders by a total key, so a page boundary cannot lose a row', async () => {
    const { listPosts } = await import('../lib/content');
    await listPosts();

    expect(lastSql()).toMatch(/ORDER BY p\.created_at_ms DESC, p\.id DESC/i);
  });

  it('seeks past the previous page by value rather than counting past it', async () => {
    const { listPosts } = await import('../lib/content');
    await listPosts({ after: { createdAtMs: 1756600000000, id: 'pabc' } });

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
    expect(sql).toMatch(/SELECT vault_id, content_key, title FROM posts/i);
    expect(sql).toMatch(/\(vault_id, content_key\) IN/i);
    expect(lastParams()[1]).toEqual(['key-1', 'key-2']);
    expect(sql).not.toMatch(/p\.body/i);

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
