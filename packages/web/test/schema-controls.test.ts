// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
//
// Every table in `public` must carry BOTH controls, and this test is what stops that decaying.
//
// Migration `026` found `creator_perks` exposed in production and said why both are needed.
// `023`–`027` were written the same day and took only half the lesson: six tables shipped with a
// REVOKE and no RLS. Eight OTHER tables had the opposite gap — RLS on, and `anon` still holding
// DELETE, INSERT, UPDATE and TRUNCATE on the content layer, held back only by RLS denying by
// default.
//
// Neither gap was caught by anything, because nothing checked. A migration that fixes the current
// tables does not stop the next one reintroducing it, so the check has to live here rather than in
// a migration that has already run.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(process.cwd(), 'db');

/** SQL with comments stripped, so a control that exists only in prose never satisfies this. */
function codeOf(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*--[^\n]*$/gm, '');
}

const files = readdirSync(DIR)
  .filter((f) => /^\d+_.*\.sql$/.test(f))
  .sort()
  .map((filename) => ({ filename, sql: codeOf(readFileSync(join(DIR, filename), 'utf8')) }));

/** Tables this migration set creates in `public`. */
function tablesCreatedBy(sql: string): string[] {
  const out: string[] = [];
  for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?["`]?(\w+)["`]?/gi)) {
    if (m[1] !== undefined) out.push(m[1].toLowerCase());
  }
  return out;
}

describe('every table ships with both controls, not one of them', () => {
  it('has migrations to check at all', () => {
    // A test that silently examines nothing is the failure mode this whole file exists to prevent.
    expect(files.length).toBeGreaterThan(20);
  });

  /*
    A SWEEP ONLY COVERS WHAT ALREADY EXISTED WHEN IT RAN.

    The first version of this test accepted a sweep anywhere in the set as covering every table,
    and so it could not fail: a probe table created in `030` with no controls at all passed, twice,
    because `029` contains a loop over `public`. But `029` has already run. A table created after
    it is not covered by it, and never will be.

    A sweep therefore counts only for tables created in a migration at or before the sweep's own
    filename. Anything created after must be named explicitly. Verified by mutation both ways.
  */
  const sweepAt = (re: RegExp): string | null => {
    for (const f of files) if (re.test(f.sql)) return f.filename;
    return null;
  };
  const createdWithFile = files.flatMap((f) => tablesCreatedBy(f.sql).map((t) => [t, f.filename] as const));
  const all = files.map((f) => f.sql).join('\n').toLowerCase();

  const covered = (table: string, createdIn: string, sweep: string | null, named: RegExp): boolean =>
    named.test(all) || (sweep !== null && createdIn <= sweep);

  it('leaves no table created without row level security reaching it', () => {
    const sweep = sweepAt(/for\s+t\s+in[\s\S]*?enable\s+row\s+level\s+security/i);
    for (const [table, createdIn] of createdWithFile) {
      if (table === 'schema_migrations') continue; // the runner creates its own ledger
      const named = new RegExp(`alter\\s+table\\s+(public\\.)?["\`]?${table}["\`]?\\s+enable\\s+row\\s+level\\s+security`, 'i');
      expect(
        covered(table, createdIn, sweep, named),
        `${table} (created in ${createdIn}) has no row level security: no migration names it, and ` +
          `the sweep in ${sweep ?? 'none'} ran before it existed`,
      ).toBe(true);
    }
  });

  it('revokes anon on every table it creates', () => {
    const sweep = sweepAt(/for\s+t\s+in[\s\S]*?revoke\s+all[\s\S]*?from\s+anon/i);
    for (const [table, createdIn] of createdWithFile) {
      if (table === 'schema_migrations') continue;
      const named = new RegExp(`revoke\\s+all\\s+on\\s+(public\\.)?["\`]?${table}["\`]?\\s+from\\s+anon`, 'i');
      expect(
        covered(table, createdIn, sweep, named),
        `${table} (created in ${createdIn}) never has anon revoked: no migration names it, and the ` +
          `sweep in ${sweep ?? 'none'} ran before it existed`,
      ).toBe(true);
    }
  });
});
