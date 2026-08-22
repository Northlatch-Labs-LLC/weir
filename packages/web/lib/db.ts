// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import 'server-only';

/**
 * The connection pool.
 *
 * # No default connection string
 *
 * `PROJECTX_DATABASE_URL` must be set. A default of `postgres://localhost/projectx_social` looks
 * harmless and is how a deployment silently writes to the wrong database — or to a developer's,
 * which is worse because it appears to work.
 *
 * # One pool per process
 *
 * Next reloads modules in development, so a pool created at module scope is recreated on every
 * edit and leaks connections until Postgres refuses new ones. The pool is therefore stashed on
 * `globalThis`, which survives the reload.
 */

import { Pool } from 'pg';

const KEY = Symbol.for('projectx.social.pool');

interface PoolHolder {
  [KEY]?: Pool;
}

export function db(): Pool {
  const holder = globalThis as PoolHolder;
  const existing = holder[KEY];
  if (existing !== undefined) return existing;

  const url = process.env['PROJECTX_DATABASE_URL'];
  if (url === undefined || url.trim() === '') {
    throw new Error(
      'PROJECTX_DATABASE_URL is not set. There is no default — a default connection string is ' +
        'how a deployment silently writes to the wrong database.',
    );
  }

  const pool = new Pool({
    connectionString: url,
    // Bounded. An unbounded pool turns a traffic spike into "too many clients already", which
    // takes down every request rather than queuing the excess.
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });

  // A pool that emits an unhandled 'error' takes the process down. Idle-client errors are normal
  // when a server restarts, so they are logged and swallowed rather than fatal.
  pool.on('error', (error) => {
    console.error(JSON.stringify({ poolError: error.message }));
  });

  holder[KEY] = pool;
  return pool;
}

/**
 * Normalise a Sui address for storage and comparison.
 *
 * Addresses are hex and case-insensitive, and they arrive from wallets, query strings and event
 * logs in whichever case each produced. Storing them as given makes `follower = $1` miss, which
 * turns a composite primary key into no key at all and lets the same person follow twice.
 */
export function normaliseAddress(address: string): string {
  return `0x${BigInt(address).toString(16).padStart(64, '0')}`;
}
