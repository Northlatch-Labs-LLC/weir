// Built-by: @projectx.sui · Co-authored-by: Claude
import 'server-only';
import { opaqueDetail } from './opaque';

/**
 * # The rule this file is written under
 *
 * **No query here names the `email` column.** Not in a `SELECT`, not in a `RETURNING`, not joined
 * through and dropped afterwards. `lib/waitlist-insight.ts` explains why, and `test/waitlist-insight
 * .test.ts` reads this file to check it — the same trick `test/waitlist.test.ts` plays on the route,
 * because an invariant that is only a comment is an invariant that gets edited away.
 *
 * The one place an email appears is `GROUP BY r.email` in the referrer roll-up, where it is the key
 * rows are grouped *by* and is not selected. That is called out in the query, because a reader
 * checking the rule needs to see why the exception is not one.
 *
 * # Why there is still no lookup by address
 *
 * `waitlist-store.ts` refuses to answer questions about a given email, so that nobody can test
 * whether an address is on the list. Nothing here weakens that: these are aggregates and recent
 * arrivals, none of them keyed on an address, and adding `WHERE email = $1` to any of them would
 * rebuild the oracle behind a gate — which is better than in the open, and still not something this
 * platform needs.
 *
 * # A failed read is not an empty list
 */

import { db } from './db';
import { WAITLIST_ROLES, WAITLIST_SOURCES } from './waitlist';
import {
  DAY_MS,
  fillDays,
  tally,
  type Arrival,
  type DayCount,
  type Referrer,
  type WaitlistInsight,
} from './waitlist-insight';

/** How many days the arrivals strip covers. */
export const DAILY_SPAN = 30;
/** How many referrers the leaderboard names. */
export const TOP_REFERRERS = 10;
/** How many arrivals the table lists. */
export const RECENT_ARRIVALS = 25;

export async function readWaitlistInsight(now: number = Date.now()): Promise<WaitlistInsight | null> {
  try {
    const pool = db();

    /*
      Five queries rather than one, deliberately.

      They could be one statement with five CTEs. Read once by whoever changes this next, five
      short queries each answering one question are what makes the "no email is selected" rule
      checkable at a glance — which is the property this file is actually protecting.
    */
    const totals = pool.query<{ total: string; with_handle: string; via_referral: string }>(
      `SELECT count(*)                                        AS total,
              count(*) FILTER (WHERE handle IS NOT NULL)      AS with_handle,
              count(*) FILTER (WHERE referred_by IS NOT NULL) AS via_referral
         FROM waitlist_signups`,
    );

    const roles = pool.query<{ key: string; n: string }>(
      `SELECT role AS key, count(*) AS n FROM waitlist_signups GROUP BY role`,
    );

    const sources = pool.query<{ key: string; n: string }>(
      `SELECT source AS key, count(*) AS n FROM waitlist_signups GROUP BY source`,
    );

    /*
      Grouped in SQL so the result is bounded by the window rather than by the size of the list.
      The day is derived in Postgres and pinned to UTC — `to_timestamp` yields `timestamptz`, and
      without `AT TIME ZONE 'UTC'` the bucket would follow whatever the server's timezone happens
      to be, which is a different answer on a different host.
    */
    const daily = pool.query<{ day: string; n: string }>(
      `SELECT to_char(to_timestamp(created_at_ms / 1000.0) AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
              count(*) AS n
         FROM waitlist_signups
        WHERE created_at_ms >= $1
        GROUP BY day`,
      [now - DAILY_SPAN * DAY_MS],
    );

    /*
      Who brought people.

      `r.email` is the grouping key and is not selected — it is what identifies one referrer, and
      two people cannot share it. What comes back is their handle and their code, both of which are
      theirs to give out.
    */
    const referrers = pool.query<{ handle: string | null; ref_code: string | null; n: string }>(
      `SELECT r.handle, r.ref_code, count(*) AS n
         FROM waitlist_signups s
         JOIN waitlist_signups r ON r.email = s.referred_by
        GROUP BY r.email, r.handle, r.ref_code
        ORDER BY n DESC, r.handle NULLS LAST
        LIMIT ${TOP_REFERRERS}`,
    );

    const recent = pool.query<{
      handle: string | null;
      ref_code: string | null;
      role: string;
      source: string;
      created_at_ms: string;
      referred: boolean;
    }>(
      `SELECT handle, ref_code, role, source, created_at_ms,
              (referred_by IS NOT NULL) AS referred
         FROM waitlist_signups
        ORDER BY created_at_ms DESC
        LIMIT ${RECENT_ARRIVALS}`,
    );

    const [totalsRows, roleRows, sourceRows, dailyRows, referrerRows, recentRows] = await Promise.all([
      totals,
      roles,
      sources,
      daily,
      referrers,
      recent,
    ]);

    const head = totalsRows.rows[0];
    if (head === undefined) return null;

    const dayCounts: DayCount[] = dailyRows.rows.map((row) => ({ day: row.day, count: Number(row.n) }));

    const topReferrers: Referrer[] = referrerRows.rows.map((row) => ({
      handle: row.handle,
      code: row.ref_code,
      referred: Number(row.n),
    }));

    const arrivals: Arrival[] = recentRows.rows.map((row) => ({
      handle: row.handle,
      code: row.ref_code,
      role: row.role,
      source: row.source,
      joinedAtMs: Number(row.created_at_ms),
      referred: row.referred,
    }));

    return {
      total: Number(head.total),
      withHandle: Number(head.with_handle),
      viaReferral: Number(head.via_referral),
      byRole: tally(
        roleRows.rows.map((row) => ({ key: row.key, count: Number(row.n) })),
        WAITLIST_ROLES,
      ),
      bySource: tally(
        sourceRows.rows.map((row) => ({ key: row.key, count: Number(row.n) })),
        WAITLIST_SOURCES,
      ),
      daily: fillDays(dayCounts, now, DAILY_SPAN),
      topReferrers,
      recent: arrivals,
    };
  } catch (error) {
    console.error(
      JSON.stringify({
        // Already a server-side log, so the real message belongs here rather than an opaque one.
        waitlistInsightFailed: error instanceof Error ? error.message : String(error),
      }),
    );
    return null;
  }
}
