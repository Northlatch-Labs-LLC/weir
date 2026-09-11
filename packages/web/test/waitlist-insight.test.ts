// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DAY_MS, dayKey, fillDays, identify, tally } from '../lib/waitlist-insight';

const AUG_21 = Date.UTC(2026, 7, 21, 12, 0, 0);

describe('a day is a UTC day, whatever the host thinks', () => {
  it('buckets by UTC and not by the machine timezone', () => {
    expect(dayKey(Date.UTC(2026, 7, 21, 23, 30))).toBe('2026-08-21');
    expect(dayKey(Date.UTC(2026, 7, 21, 0, 5))).toBe('2026-08-21');
    expect(dayKey(Date.UTC(2026, 7, 22, 0, 5))).toBe('2026-08-22');
  });
});

describe('every day in the window is drawn', () => {
  it('emits a zero for a day nobody joined', () => {
    const filled = fillDays([{ day: '2026-08-21', count: 3 }], AUG_21, 5);
    expect(filled).toEqual([
      { day: '2026-08-17', count: 0 },
      { day: '2026-08-18', count: 0 },
      { day: '2026-08-19', count: 0 },
      { day: '2026-08-20', count: 0 },
      { day: '2026-08-21', count: 3 },
    ]);
  });

  it('does not let sparse days collapse into a run, which is the whole point', () => {
    const sparse = [
      { day: '2026-08-01', count: 1 },
      { day: '2026-08-12', count: 1 },
      { day: '2026-08-21', count: 1 },
    ];
    const filled = fillDays(sparse, AUG_21, 30);
    expect(filled).toHaveLength(30);
    expect(filled.filter((d) => d.count > 0)).toHaveLength(3);
    expect(filled.filter((d) => d.count === 0)).toHaveLength(27);
  });

  it('ends on the day of the timestamp given and runs backwards from it', () => {
    const filled = fillDays([], AUG_21, 3);
    expect(filled.map((d) => d.day)).toEqual(['2026-08-19', '2026-08-20', '2026-08-21']);
  });

  it('ignores a day outside the window rather than folding it into an edge', () => {
    const filled = fillDays([{ day: '2025-01-01', count: 900 }], AUG_21, 3);
    expect(filled.every((d) => d.count === 0)).toBe(true);
  });

  it('covers exactly the span asked for', () => {
    expect(fillDays([], AUG_21, 30)).toHaveLength(30);
    expect(fillDays([], AUG_21, 1)).toEqual([{ day: '2026-08-21', count: 0 }]);
    expect(fillDays([], AUG_21, 30)[0]!.day).toBe(dayKey(AUG_21 - 29 * DAY_MS));
  });
});

describe('a breakdown does not hide what it did not find', () => {
  it('shows a known value nobody chose, at zero', () => {
    const rows = tally([{ key: 'supporter', count: 4 }], ['creator', 'supporter', 'both']);
    expect(rows).toEqual([
      { key: 'supporter', count: 4 },
      { key: 'creator', count: 0 },
      { key: 'both', count: 0 },
    ]);
  });

  it('keeps a value that should be impossible rather than filtering it away', () => {
    const rows = tally([{ key: 'journalist', count: 2 }], ['creator', 'supporter', 'both']);
    expect(rows.map((r) => r.key)).toContain('journalist');
    expect(rows.reduce((sum, r) => sum + r.count, 0)).toBe(2);
  });

  it('orders by count, and breaks ties in the order the form offers them', () => {
    const rows = tally(
      [
        { key: 'both', count: 1 },
        { key: 'creator', count: 1 },
        { key: 'supporter', count: 9 },
      ],
      ['creator', 'supporter', 'both'],
    );
    expect(rows.map((r) => r.key)).toEqual(['supporter', 'creator', 'both']);
  });

  it('sums duplicate keys rather than letting the last one win', () => {
    const rows = tally(
      [
        { key: 'hero', count: 2 },
        { key: 'hero', count: 3 },
      ],
      ['hero'],
    );
    expect(rows).toEqual([{ key: 'hero', count: 5 }]);
  });
});

describe('what somebody is called when they gave us no name', () => {
  it('prefers the handle they asked for', () => {
    expect(identify({ handle: 'ada', code: 'ABCD1234' })).toEqual({ label: '@ada', kind: 'handle' });
  });

  it('falls back to the code they share', () => {
    expect(identify({ handle: null, code: 'ABCD1234' })).toEqual({ label: 'ABCD1234', kind: 'code' });
  });

  it('answers null rather than inventing a name', () => {
    expect(identify({ handle: null, code: null })).toBeNull();
  });

  it('treats an empty string as absent, not as a name', () => {
    expect(identify({ handle: '', code: '' })).toBeNull();
    expect(identify({ handle: '', code: 'ABCD1234' })).toEqual({ label: 'ABCD1234', kind: 'code' });
  });
});

describe('no query on the operator panel selects an email address', () => {
  const source = readFileSync(join(process.cwd(), 'lib/waitlist-admin.ts'), 'utf8');

  const queries = [...source.matchAll(/`([^`]*)`/g)]
    .map((m) => m[1] as string)
    .filter((literal) => literal.includes('SELECT') && literal.includes('FROM'));

  const projections = queries.flatMap((literal) =>
    [...literal.matchAll(/SELECT([\s\S]*?)\sFROM\s/g)].map((m) => m[1] as string),
  );

  it('found the queries it is meant to be checking', () => {
    expect(projections.length).toBeGreaterThanOrEqual(5);
  });

  it('projects no email column, in any of them', () => {
    for (const projection of projections) {
      expect(projection).not.toMatch(/email/i);
    }
  });

  it('returns nothing to the caller under that name either', () => {
    expect(source).not.toMatch(/\bemail\s*:/);
    for (const query of queries) expect(query).not.toMatch(/RETURNING[\s\S]*email/i);
  });

  it('adds no lookup keyed on an address, which would rebuild the membership oracle', () => {
    for (const query of queries) expect(query).not.toMatch(/WHERE\s+email\s*=/i);
  });
});
