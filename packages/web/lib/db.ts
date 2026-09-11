// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import 'server-only';

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
    max: 3,
    idleTimeoutMillis: 5_000,
    connectionTimeoutMillis: 5_000,
    options: '-c statement_timeout=8000 -c idle_in_transaction_session_timeout=30000',
  });

  pool.on('error', (error) => {
    console.error(JSON.stringify({ poolError: error.message }));
  });

  holder[KEY] = pool;
  return pool;
}

const HEX_ID = /^0x[0-9a-fA-F]{1,64}$/;

export function isSuiId(value: unknown): value is string {
  return typeof value === 'string' && HEX_ID.test(value);
}

export function normaliseAddress(address: string): string {
  if (!isSuiId(address)) {
    throw new TypeError(
      `not a Sui address: ${JSON.stringify(address)}. Expected 0x followed by 1-64 hex digits.`,
    );
  }
  return `0x${BigInt(address).toString(16).padStart(64, '0')}`;
}
