// @vitest-environment node
// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
//
// `listProfiles` took no arguments and returned the whole table.
//
// Three callers then threw most of it away in JavaScript: the entity markers kept the handles on
// the current page, the earnings page kept the rows belonging to one address, and the sidebar kept
// the first few. `RightRail` sits in the shell, so that last one happened on EVERY page of the site.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const query = vi.fn();

vi.mock('@/lib/db', () => ({
  db: () => ({ query: (...a: unknown[]) => query(...a) }),
  normaliseAddress: (a: string) => `0x${BigInt(a).toString(16).padStart(64, '0')}`,
}));

const sql = (): string => String(query.mock.calls.at(-1)?.[0] ?? '').replace(/\s+/g, ' ').trim();
const params = (): unknown[] => (query.mock.calls.at(-1)?.[1] as unknown[]) ?? [];

beforeEach(() => {
  vi.resetModules();
  query.mockReset();
  query.mockResolvedValue({ rows: [] });
});

afterEach(() => vi.resetModules());

describe('narrowing happens in SQL', () => {
  it('filters by handle in the query, not in JavaScript', async () => {
    const { listProfiles } = await import('../lib/content');
    await listProfiles({ handles: ['atlas', 'bleep'] });
    expect(sql()).toMatch(/WHERE handle = ANY\(\$1::text\[\]\)/i);
    expect(params()[0]).toEqual(['atlas', 'bleep']);
  });

  it('treats an empty handle list as an empty answer, not as everybody', async () => {
    // "These creators" with an empty list is nobody. Falling back to an unfiltered read is how a
    // narrowed query silently becomes a full one.
    const { listProfiles } = await import('../lib/content');
    await listProfiles({ handles: [] });
    expect(sql()).toMatch(/WHERE handle = ANY/i);
    expect(params()[0]).toEqual([]);
  });

  it('filters by owner, normalised, so the index can serve it', async () => {
    const { listProfiles } = await import('../lib/content');
    await listProfiles({ owner: `0x${'AB'.repeat(32)}` });
    expect(sql()).toMatch(/WHERE owner = \$1/i);
    expect(params()[0]).toBe(`0x${'ab'.repeat(32)}`);
  });

  it('answers nothing for an owner that is not an address, without querying', async () => {
    const { listProfiles } = await import('../lib/content');
    await expect(listProfiles({ owner: 'not-an-address' })).resolves.toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });

  it('bounds in SQL when asked for a limit', async () => {
    const { listProfiles } = await import('../lib/content');
    await listProfiles({ limit: 6 });
    expect(sql()).toMatch(/LIMIT \$1/i);
    expect(params()[0]).toBe(6);
  });

  it('still returns everything when nothing is narrowed', async () => {
    /*
      Deliberate, and the reason there is no DEFAULT limit here as there is on posts. The remaining
      callers build a lookup map over every creator, and a silently truncated map is not a smaller
      answer — it is a wrong one, in which a missing creator renders as though they do not exist.
    */
    const { listProfiles } = await import('../lib/content');
    await listProfiles();
    expect(sql()).toBe('SELECT * FROM profiles ORDER BY handle');
    expect(params()).toEqual([]);
  });

  it('counts without fetching the rows', async () => {
    const { countProfiles } = await import('../lib/content');
    await countProfiles();
    expect(sql()).toMatch(/SELECT count\(\*\)/i);
    expect(sql()).not.toMatch(/SELECT \*/i);
  });
});

describe('the callers that discarded most of what they asked for', () => {
  const read = (p: string): string =>
    readFileSync(join(process.cwd(), p), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');

  it('the sidebar asks for a bounded list and a count, not the table', () => {
    // In the shell, so this ran on every page of the site.
    const code = read('components/shell/RightRail.tsx');
    expect(code).toMatch(/listProfiles\(\{ limit: SHOWN \}\)/);
    expect(code).toMatch(/countProfiles\(\)/);
    expect(code).not.toMatch(/\.slice\(0, SHOWN\)/);
  });

  it('the entity markers ask for the handles on the page', () => {
    const code = read('components/EntityType.tsx');
    expect(code).toMatch(/listProfiles\(\{ handles \}\)/);
    expect(code).not.toMatch(/wanted\.has/);
  });

  it('the earnings page asks for one owner', () => {
    const code = read('lib/earnings.ts');
    expect(code).toMatch(/listProfiles\(\{ owner: address \}\)/);
    expect(code).not.toMatch(/filter\(\(p\) => normaliseAddress\(p\.owner\)/);
  });
});
