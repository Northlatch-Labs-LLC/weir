// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
/**
 * A disposable database for route tests.
 *
 * This helper truncates every table it is pointed at. It therefore reads `PROJECTX_TEST_DATABASE_URL`
 * and nothing else — never `PROJECTX_DATABASE_URL`, which names the database the application uses
 * and where real content lives.
 *
 * Two further guards below, because one name is a thin defence: the target must not equal the
 * application's URL, and its database name must end in `_test`.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';

/**
 * Point the whole process at the test database, and verify it is one.
 *
 * Call this before importing any route. The handler under test reaches Postgres through `lib/db`,
 * which reads `PROJECTX_DATABASE_URL` — so without this the test would assert against one database
 * while the code wrote to another, which is both meaningless and destructive.
 *
 * Vitest does not read `.env.local`, so it is parsed here for the test variable only. The
 * application's own value is then *overwritten* with it: for the life of this process there is one
 * database and it is disposable.
 */
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

  // Runs every guard below — unset, same as the application's, or not named _test — before the
  // application's variable is replaced.
  testDb();
  process.env['PROJECTX_DATABASE_URL'] = process.env['PROJECTX_TEST_DATABASE_URL'];
}

let pool: Pool | null = null;

/** The database name in a connection string, or null when it cannot be read. */
function databaseName(url: string): string | null {
  try {
    return new URL(url).pathname.replace(/^\//, '') || null;
  } catch {
    return null;
  }
}

/**
 * The pool these tests use.
 *
 * Its own pool rather than `lib/db`'s, so the application's connection can never be the one issuing
 * a TRUNCATE — the two cannot be confused by a shared module holding a cached handle.
 */
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

/**
 * Empty every table, in one statement.
 *
 * `CASCADE` because `posts` and `follows` carry foreign keys into `profiles`. One statement rather
 * than a delete per table: a new table added to the schema and forgotten here shows up as leaked
 * rows in an unrelated test, which is louder than a slow tidy-up.
 */
export async function resetDatabase(): Promise<void> {
  await testDb().query(
    /*
      `used_signatures` is deliberately NOT truncated here, though it looks like it belongs.

      Adding it made `test/replay.test.ts` fail in the full run while passing alone: suites share
      one database and run in parallel, so another file's `beforeEach` deleted a signature this one
      had just spent, and the replay it expected to be refused was accepted. A row that another
      test may remove mid-assertion is worse than a row left behind.

      Leaving them is safe because a digest is unique per signature — a stale row can never collide
      with a later test's, and rows expire on their own.
    */
    'TRUNCATE profiles, posts, assets, comments, follows, messages RESTART IDENTITY CASCADE',
  );
}

export async function closeDatabase(): Promise<void> {
  await pool?.end();
  pool = null;
}
