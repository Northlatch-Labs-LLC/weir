// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import 'server-only';
import { opaqueDetail } from './opaque';

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

export const DAILY_SPAN = 30;
export const TOP_REFERRERS = 10;
export const RECENT_ARRIVALS = 25;

export async function readWaitlistInsight(now: number = Date.now()): Promise<WaitlistInsight | null> {
  try {
    const pool = db();

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

    const daily = pool.query<{ day: string; n: string }>(
      `SELECT to_char(to_timestamp(created_at_ms / 1000.0) AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day,
              count(*) AS n
         FROM waitlist_signups
        WHERE created_at_ms >= $1
        GROUP BY day`,
      [now - DAILY_SPAN * DAY_MS],
    );

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
        waitlistInsightFailed: error instanceof Error ? error.message : String(error),
      }),
    );
    return null;
  }
}
