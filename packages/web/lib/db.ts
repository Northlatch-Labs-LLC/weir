// Built-by: @projectx.sui · Co-authored-by: Claude
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
    /*
      Bounded, and bounded LOW. An unbounded pool turns a traffic spike into "too many clients
      already", which takes down every request rather than queuing the excess — but `max` is a
      per-INSTANCE bound and the resource it protects is shared by every instance at once. This
      runtime starts more instances under exactly the load that makes the ceiling matter, so ten
      here is not a ceiling of ten; it is ten multiplied by however many instances are warm, against
      one pooler. A serverless instance serves a small number of concurrent requests and rarely
      needs more than two or three connections to do it.
    */
    max: 3,
    /*
      Short, because the timer that reaps idle clients does not run while an instance is frozen.
      This runtime freezes an instance the moment it returns a response, so a long idle timeout means
      connections stay claimed on the shared pooler until the instance thaws or the pooler reaps them
      itself — whichever is longer.
    */
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 5_000,
    /*
      A statement ceiling, client side. The authoritative one is on the role (`db/028`), because this
      is a startup parameter and a startup parameter needs a connection whose startup we own — which
      a transaction-pooled client does not have. This is kept anyway: it costs nothing, it is correct
      in session mode and on a direct connection, and it means the ceiling does not silently vanish
      if the connection string is ever repointed at one.
    */
    options: '-c statement_timeout=8000 -c idle_in_transaction_session_timeout=30000',
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
const HEX_ID = /^0x[0-9a-fA-F]{1,64}$/;

/**
 * Whether this string is a Sui object id or address at all.
 *
 * `0x` followed by one to sixty-four hex digits. Short forms are real — `0x2` is the Sui framework
 * — so they are accepted and padded by {@link normaliseAddress}, not rejected.
 */
export function isSuiId(value: unknown): value is string {
  return typeof value === 'string' && HEX_ID.test(value);
}

export function normaliseAddress(address: string): string {
  /*
    Validated before it is parsed, because `BigInt` accepts far more than Sui does.

    This was `BigInt(address)` alone, and `BigInt` reads JavaScript numeric literal syntax rather
    than hex addresses. Measured, not assumed:

        ''        -> 0x000…000   the ZERO ADDRESS, silently
        '  '      -> 0x000…000   the zero address again
        '10'      -> 0x000…00a   a decimal string, reinterpreted as hex
        '0b1010'  -> 0x000…00a   a binary literal
        '0o17'    -> 0x000…00f   an octal one

    Only two of those throw anything at all. The rest return a well-formed address that is not the
    one the caller named, and the first two return the SAME well-formed address for two different
    kinds of nothing — so an empty field and a whitespace field both become an address that can be
    stored, compared, and matched against a row.

    Thirty-three call sites reach this function, several on money paths, and none of them could
    tell the difference between "normalised" and "invented".
  */
  if (!isSuiId(address)) {
    throw new TypeError(
      `not a Sui address: ${JSON.stringify(address)}. Expected 0x followed by 1-64 hex digits.`,
    );
  }
  return `0x${BigInt(address).toString(16).padStart(64, '0')}`;
}
