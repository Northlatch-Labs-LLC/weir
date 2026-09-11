// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';

export function useTestDatabase(): void {
  if (process.env['PROJECTX_TEST_DATABASE_URL'] === undefined) {
    const line = readFileSync(join(process.cwd(), '.env.local'), 'utf8')
      .split('\n')
      .find((l) => l.startsWith('PROJECTX_TEST_DATABASE_URL='));
    if (line !== undefined) {
      process.env['PROJECTX_TEST_DATABASE_URL'] = line
        .slice('PROJECTX_TEST_DATABASE_URL='.length)
        .trim();
    }
  }

  testDb();
  process.env['PROJECTX_DATABASE_URL'] = process.env['PROJECTX_TEST_DATABASE_URL'];
}

let pool: Pool | null = null;

function databaseName(url: string): string | null {
  try {
    return new URL(url).pathname.replace(/^\//, '') || null;
  } catch {
    return null;
  }
}

export function testDb(): Pool {
  if (pool !== null) return pool;

  const url = process.env['PROJECTX_TEST_DATABASE_URL'];
  if (url === undefined || url.trim() === '') {
    throw new Error(
      'PROJECTX_TEST_DATABASE_URL is not set. Route tests truncate every table, so they run only ' +
        'against a database named for that purpose. Create one and set the variable; the ' +
        'application database is deliberately unreachable from here.',
    );
  }

  const app = process.env['PROJECTX_DATABASE_URL'];
  if (app !== undefined && app.trim() === url.trim()) {
    throw new Error(
      'PROJECTX_TEST_DATABASE_URL is the same database as PROJECTX_DATABASE_URL. Refusing to run: ' +
        'this suite would erase the application data.',
    );
  }

  const name = databaseName(url);
  if (name === null || !name.endsWith('_test')) {
    throw new Error(
      `Refusing to run against database "${name ?? 'unknown'}". The name must end in _test, so a ` +
        'connection string pasted by mistake cannot be truncated.',
    );
  }

  pool = new Pool({ connectionString: url });
  return pool;
}

export async function resetDatabase(): Promise<void> {
  await testDb().query(
    'TRUNCATE profiles, posts, assets, comments, follows, messages RESTART IDENTITY CASCADE',
  );
}

export async function closeDatabase(): Promise<void> {
  await pool?.end();
  pool = null;
}
