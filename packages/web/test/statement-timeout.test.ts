// @vitest-environment node
// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
  The statement ceiling, and the exemption that keeps it from breaking migrations.

  Every role on this database except one carries a timeout; the exception is the role this
  application connects as. A single slow query can therefore hold a pooled connection indefinitely,
  and with a bounded pool in front of a shared pooler a handful of those is the whole request path.

  Three properties are asserted here, and they are three because the fix is only correct as a set:

    1. The ceiling exists on the ROLE, which is the only form that survives transaction pooling.
    2. The pool is sized and configured for a runtime that multiplies instances.
    3. The migration runner is EXEMPT, because the work that legitimately runs long is migration
       work — an index build, or the whole-table UPDATE in 019. A ceiling that breaks the runner is
       not a fix, and this is the assertion that stops the next person removing the exemption.
*/

/*
  Read inside the assertion rather than at module scope, deliberately. A missing file at module
  scope throws during collection and vitest reports "no tests" with exit 1 — which is a red run that
  names nothing, and is indistinguishable from a broken harness. Read here, a missing file fails one
  assertion by name and says which file it wanted.
*/
function sourceOf(...parts: string[]): string {
  const path = join(__dirname, '..', ...parts);
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

/*
  The EXECUTABLE part of the migration, with SQL comments stripped.

  This is not tidiness. The first version of this file matched the raw text, and a mutation test
  proved it worthless: commenting the statements out — turning the whole migration into a no-op —
  left every assertion passing, because `-- ALTER ROLE postgres SET …` still contains
  `ALTER ROLE postgres SET …`. A test that cannot tell a statement from a comment about a statement
  asserts nothing. This file is mostly prose, so that was not a hypothetical.
*/
const MIGRATION = (): string =>
  sourceOf('db', '028_statement_timeout.sql')
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');

const RUNNER = (): string => sourceOf('scripts', 'migrate.mjs');

describe('the ceiling is on the role, where pooling cannot lose it', () => {
  it('sets a statement timeout on the role the application connects as', () => {
    // `postgres` specifically: it is the role with no ceiling, read from pg_roles.rolconfig.
    expect(MIGRATION()).toMatch(/ALTER\s+ROLE\s+postgres\s+SET\s+statement_timeout\s*=\s*'8s'/i);
  });

  it('closes the case a statement timeout does not cover', () => {
    // A transaction left open by an instance frozen mid-request runs no statement at all, so
    // statement_timeout never fires on it while it holds its locks and its connection.
    expect(MIGRATION()).toMatch(
      /ALTER\s+ROLE\s+postgres\s+SET\s+idle_in_transaction_session_timeout\s*=/i,
    );
    expect(MIGRATION()).toMatch(/ALTER\s+ROLE\s+postgres\s+SET\s+lock_timeout\s*=/i);
  });
});

describe('the migration runner is exempt from the ceiling', () => {
  /*
    Asserted against the source rather than by running the runner, which is a top-level script that
    connects on import. The assertion is structural rather than a substring: the exemption has to
    happen INSIDE the transaction and BEFORE the migration body, or it does not protect it.
  */
  const begin = (): number => RUNNER().indexOf("await client.query('begin')");
  const exempt = (): number => RUNNER().indexOf('set statement_timeout = 0');
  const body = (): number => RUNNER().indexOf('await client.query(m.sql)');

  it('lifts the statement ceiling for migrations', () => {
    expect(exempt(), 'migrate.mjs does not lift the statement ceiling for migrations').toBeGreaterThan(-1);
  });

  it('lifts it inside the transaction and before the migration runs', () => {
    // Ordering is the whole property. After the body, an index build has already been killed.
    expect(begin()).toBeGreaterThan(-1);
    expect(body()).toBeGreaterThan(-1);
    expect(exempt()).toBeGreaterThan(begin());
    expect(exempt()).toBeLessThan(body());
  });

  it('lifts the lock ceiling too, for the same reason', () => {
    const lock = RUNNER().indexOf('set lock_timeout = 0');
    expect(lock).toBeGreaterThan(begin());
    expect(lock).toBeLessThan(body());
  });
});

describe('the pool is sized for a runtime that multiplies instances', () => {
  const KEY = Symbol.for('projectx.social.pool');
  const options: Array<Record<string, unknown>> = [];

  beforeEach(() => {
    options.length = 0;
    delete (globalThis as Record<symbol, unknown>)[KEY];
    process.env['PROJECTX_DATABASE_URL'] = 'postgres://u@localhost/db';
    vi.resetModules();
    vi.doMock('pg', () => ({
      Pool: class {
        constructor(config: Record<string, unknown>) {
          options.push(config);
        }
        on(): void {}
      },
    }));
  });

  afterEach(() => {
    delete (globalThis as Record<symbol, unknown>)[KEY];
    vi.doUnmock('pg');
    vi.resetModules();
  });

  it('bounds each instance low, because max is per-instance and the pooler is shared', async () => {
    const { db } = await import('../lib/db');
    db();

    const config = options[0];
    expect(config).toBeDefined();
    // Ten per instance is not a ceiling of ten — it is ten times however many instances are warm.
    expect(config?.['max']).toBeLessThanOrEqual(3);
  });

  it('carries a statement ceiling on the connection as well as on the role', async () => {
    const { db } = await import('../lib/db');
    db();

    // Belt and braces: correct in session mode and on a direct connection, and it means the
    // ceiling does not vanish silently if the URL is ever repointed at one.
    expect(String(options[0]?.['options'] ?? '')).toMatch(/statement_timeout=\d+/);
  });

  it('releases idle connections quickly, because a frozen instance runs no timers', async () => {
    const { db } = await import('../lib/db');
    db();

    expect(Number(options[0]?.['idleTimeoutMillis'])).toBeLessThanOrEqual(10_000);
  });
});
