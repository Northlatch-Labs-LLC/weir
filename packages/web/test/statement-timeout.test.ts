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
    Asserted against the source. The property is an ORDERING — the exemption has to happen INSIDE
    the transaction and BEFORE the migration body, or it does not protect it — and an ordering is
    not something a substring test can see.

    # Why these read a region rather than the whole file

    The runner now has TWO paths. A migration carrying `-- weir:outside-a-transaction` runs with no
    transaction at all, because `CREATE INDEX CONCURRENTLY` cannot run inside one, and that path
    lifts the ceiling too — earlier in the file than `begin`. `indexOf` over the whole source found
    that first occurrence and reported the exemption as happening BEFORE the transaction, which was
    false of the path it was describing and true only of a different one.

    So each assertion now names the path it is about. Both are checked; neither can borrow the
    other's evidence.

    # A note for whoever touches this next

    The original reason for reading source instead of behaviour — "the runner is a top-level script
    that connects on import" — is no longer true: its entry point is guarded, and `vi.doMock('pg')`
    further down this same file already shows how a fake client would be injected. A test that runs
    `main()` against one and asserts the actual query sequence would be strictly better than this,
    and is deliberately not being written here, in a change about migrations rather than about
    tests.
  */
  const WRAPPED = (): string => RUNNER().slice(RUNNER().indexOf("await client.query('begin')"));
  const UNWRAPPED = (): string =>
    RUNNER().slice(RUNNER().indexOf('if (unwrapped) {'), RUNNER().indexOf("await client.query('begin')"));

  const begin = (): number => RUNNER().indexOf("await client.query('begin')");
  const exempt = (): number => WRAPPED().indexOf('set statement_timeout = 0');
  const body = (): number => WRAPPED().indexOf('await client.query(m.sql)');

  it('lifts the statement ceiling for migrations', () => {
    expect(exempt(), 'migrate.mjs does not lift the statement ceiling for migrations').toBeGreaterThan(-1);
  });

  it('lifts it inside the transaction and before the migration runs', () => {
    // Ordering is the whole property. After the body, an index build has already been killed.
    expect(begin()).toBeGreaterThan(-1);
    expect(body()).toBeGreaterThan(-1);
    expect(exempt()).toBeGreaterThan(-1);
    expect(exempt()).toBeLessThan(body());
  });

  it('lifts the lock ceiling too, for the same reason', () => {
    const lock = WRAPPED().indexOf('set lock_timeout = 0');
    expect(lock).toBeGreaterThan(-1);
    expect(lock).toBeLessThan(body());
  });

  it('lifts both ceilings on the path that runs without a transaction as well', () => {
    /*
      That path exists for `CREATE INDEX CONCURRENTLY`, which is the longest-running statement any
      migration here will ever issue. Leaving the role's ceiling in force on the one file most
      likely to exceed it would be the exact failure this exemption was written to prevent.
    */
    expect(UNWRAPPED()).toContain('set statement_timeout = 0');
    expect(UNWRAPPED()).toContain('set lock_timeout = 0');
  });

  it('puts the ceilings back after a file that ran without a transaction', () => {
    /*
      Set on the SESSION, not inside a transaction, so nothing takes them away at COMMIT. This
      connection runs every later migration, and one unwrapped file would otherwise exempt all of
      them from a limit they never asked to be exempt from.
    */
    expect(UNWRAPPED()).toContain('reset statement_timeout');
    expect(UNWRAPPED()).toContain('reset lock_timeout');
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
