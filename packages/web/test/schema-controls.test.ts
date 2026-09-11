// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const DIR = join(process.cwd(), 'db');

function codeOf(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*--[^\n]*$/gm, '');
}

const files = readdirSync(DIR)
  .filter((f) => /^\d+_.*\.sql$/.test(f))
  .sort()
  .map((filename) => ({ filename, sql: codeOf(readFileSync(join(DIR, filename), 'utf8')) }));

function tablesCreatedBy(sql: string): string[] {
  const out: string[] = [];
  for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?["`]?(\w+)["`]?/gi)) {
    if (m[1] !== undefined) out.push(m[1].toLowerCase());
  }
  return out;
}

describe('every table ships with both controls, not one of them', () => {
  it('has migrations to check at all', () => {
    expect(files.length).toBeGreaterThan(20);
  });

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
      if (table === 'schema_migrations') continue;
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
