// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migrate = await import('../scripts/migrate.mjs');
const { OUTSIDE_MARKER, needsToRunOutsideATransaction, runsOutsideATransaction, statementsOnly } =
  migrate as unknown as {
    OUTSIDE_MARKER: string;
    needsToRunOutsideATransaction: (sql: string) => boolean;
    runsOutsideATransaction: (sql: string) => boolean;
    statementsOnly: (sql: string) => string;
  };

describe('importing the runner', () => {
  it('does not run it', () => {
    expect(typeof runsOutsideATransaction).toBe('function');
  });
});

describe('the opt-out marker', () => {
  it('is read when a file declares it on its own line', () => {
    expect(runsOutsideATransaction(`-- ${OUTSIDE_MARKER}\nCREATE INDEX CONCURRENTLY i ON t (c);`))
      .toBe(true);
  });

  it('is absent when a file does not declare it', () => {
    expect(runsOutsideATransaction('CREATE INDEX i ON t (c);')).toBe(false);
  });

  it('is not granted by a sentence that merely mentions it', () => {
    const prose = `/* Set ${OUTSIDE_MARKER} on a file that needs it. */\nCREATE INDEX i ON t (c);`;
    expect(runsOutsideATransaction(prose)).toBe(false);
  });

  it('is not granted by the words appearing mid-line', () => {
    expect(runsOutsideATransaction(`SELECT '${OUTSIDE_MARKER}';`)).toBe(false);
  });
});

describe('detecting what cannot run in a transaction', () => {
  it('sees CREATE INDEX CONCURRENTLY', () => {
    expect(needsToRunOutsideATransaction('CREATE INDEX CONCURRENTLY i ON t (c);')).toBe(true);
  });

  it('sees it whatever case it is written in', () => {
    expect(needsToRunOutsideATransaction('create index concurrently i on t (c);')).toBe(true);
  });

  it('sees DROP INDEX CONCURRENTLY, which carries the same restriction', () => {
    expect(needsToRunOutsideATransaction('DROP INDEX CONCURRENTLY i;')).toBe(true);
  });

  it('does NOT see it in a block comment describing it', () => {
    expect(
      needsToRunOutsideATransaction('/* CREATE INDEX CONCURRENTLY is why this exists. */\nCREATE INDEX i ON t (c);'),
    ).toBe(false);
  });

  it('does NOT see it in a line comment describing it', () => {
    expect(needsToRunOutsideATransaction('-- concurrently, one day\nCREATE INDEX i ON t (c);')).toBe(
      false,
    );
  });

  it('strips comments rather than the statements beside them', () => {
    expect(statementsOnly('/* gone */ SELECT 1; -- gone\nSELECT 2;')).toContain('SELECT 1;');
    expect(statementsOnly('/* gone */ SELECT 1; -- gone\nSELECT 2;')).not.toContain('gone');
  });
});

describe('the migrations actually in this repository', () => {
  const DB = join(process.cwd(), 'db');
  const files = readdirSync(DB).filter((f) => f.endsWith('.sql'));

  it('were found, so an empty set cannot pass as a clean one', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('contains none that would be refused by the runner', () => {
    const refused = files.filter((f) => {
      const sql = readFileSync(join(DB, f), 'utf8');
      return needsToRunOutsideATransaction(sql) && !runsOutsideATransaction(sql);
    });
    expect(refused).toEqual([]);
  });
});
