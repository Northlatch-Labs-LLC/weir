// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function sourceOf(...parts: string[]): string {
  const path = join(__dirname, '..', ...parts);
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

const MIGRATION = (): string =>
  sourceOf('db', '028_statement_timeout.sql')
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');

const RUNNER = (): string => sourceOf('scripts', 'migrate.mjs');

describe('the ceiling is on the role, where pooling cannot lose it', () => {
  it('sets a statement timeout on the role the application connects as', () => {
    expect(MIGRATION()).toMatch(/ALTER\s+ROLE\s+postgres\s+SET\s+statement_timeout\s*=\s*'8s'/i);
  });

  it('closes the case a statement timeout does not cover', () => {
    expect(MIGRATION()).toMatch(
      /ALTER\s+ROLE\s+postgres\s+SET\s+idle_in_transaction_session_timeout\s*=/i,
    );
    expect(MIGRATION()).toMatch(/ALTER\s+ROLE\s+postgres\s+SET\s+lock_timeout\s*=/i);
  });
});

describe('the migration runner is exempt from the ceiling', () => {
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
    expect(UNWRAPPED()).toContain('set statement_timeout = 0');
    expect(UNWRAPPED()).toContain('set lock_timeout = 0');
  });

  it('puts the ceilings back after a file that ran without a transaction', () => {
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
    expect(config?.['max']).toBeLessThanOrEqual(3);
  });

  it('carries a statement ceiling on the connection as well as on the role', async () => {
    const { db } = await import('../lib/db');
    db();

    expect(String(options[0]?.['options'] ?? '')).toMatch(/statement_timeout=\d+/);
  });

  it('releases idle connections quickly, because a frozen instance runs no timers', async () => {
    const { db } = await import('../lib/db');
    db();

    expect(Number(options[0]?.['idleTimeoutMillis'])).toBeLessThanOrEqual(10_000);
  });
});
