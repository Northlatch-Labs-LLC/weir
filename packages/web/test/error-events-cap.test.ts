// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
//
// The drill for the error_events cap. The sweep runs every 64th write in production and
// swallows its own errors, which makes it invisible when it stops working — so this test
// IS the drill: seed past the cap, sweep, and count what remains. Deterministic by
// construction: the cap trim deletes exactly the rows ranked past 50,000 and the age trim
// deletes exactly the oldest 500 expired ones per pass, both on the at_ms index.

import { afterAll, describe, expect, it } from 'vitest';
import { closeDatabase, testDb, useTestDatabase } from './helpers/database';

useTestDatabase();

const { sweepErrorEvents } = await import('../lib/error-log');

afterAll(closeDatabase);

const DAY_MS = 24 * 60 * 60 * 1000;

async function count(where = ''): Promise<number> {
  const r = await testDb().query(`SELECT count(*)::int AS n FROM error_events ${where}`);
  return r.rows[0]?.n ?? 0;
}

describe('the error_events cap drill', () => {
  it('trims past the cap, then trims the expired — and stops at the cap', async () => {
    // The drill owns the whole table: leftovers from an earlier run would make every
    // count below a lie, so this starts from empty, not from "whatever survived".
    await testDb().query('DELETE FROM error_events');
    // Fresh rows, 300 past the cap, in one statement. The at_ms seed is cast to bigint
    // explicitly: generate_series hands back integers, and `$1 + i` would infer integer
    // and overflow on the first epoch-scale number.
    await testDb().query(
      `INSERT INTO error_events (at_ms, source, detail)
       SELECT $1::bigint + i, 'drill', 'fresh ' || i FROM generate_series(1, 50300) AS s(i)`,
      [Date.now()],
    );
    expect(await count()).toBe(50300);

    await sweepErrorEvents();

    // The cap trim deletes exactly the 300 ranked past 50,000.
    expect(await count()).toBe(50000);

    // 600 rows older than the retention window: the age trim takes the oldest 500 per pass.
    // The offset is computed in JS — `400 * ${DAY_MS}` inside the SQL would overflow int4
    // before any cast could see it, the same trap the seed above dodged.
    await testDb().query(
      `INSERT INTO error_events (at_ms, source, detail)
       SELECT ((extract(epoch from now()) * 1000)::bigint - ${400 * DAY_MS}) - i, 'drill-expired', 'old ' || i
       FROM generate_series(1, 600) AS s(i)`,
    );
    expect(await count()).toBe(50600);

    await sweepErrorEvents();

    // Age trim took 500 of the expired; the cap trim then took the remaining 100, because
    // ORDER BY at_ms DESC ranks every expired row behind every fresh one. The cap wins
    // both times, which is the property the availability concern needs.
    expect(await count()).toBe(50000);
    expect(
      await count("WHERE at_ms < (extract(epoch from now() - make_interval(days => 365)) * 1000)"),
    ).toBe(0);
  });
});
