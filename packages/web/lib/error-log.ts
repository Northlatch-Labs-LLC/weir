import 'server-only';

import { db } from './db';

export interface Failure {
  source: string;
  detail: string;
  route?: string;
}

/*
  Record a failure and never let recording become the failure.

  Two rules, both learned from how this codebase already behaves: the caller keeps its console line
  so nothing depends on the database being up, and this swallows its own errors — a logging path that
  can throw is a second outage on top of the first.
*/

/// The bounds this table is kept within, both enforced by the same bounded sweep.
///
/// 365 days is what migration 044's comment has asked for since the table shipped; nothing
/// implemented it. The row cap is newer reasoning: /api/csp-report and /api/telemetry/error
/// accept unauthenticated writes, rate limits are IP-keyed, and IP rotation grows the table
/// without limit — poisoning the one channel the error alarm reads (an hourly count query that
/// slows as the table grows) rather than filling a disk. The cap sits far above a healthy
/// platform's real volume, so normal operation never reaches it.
const ERROR_EVENTS_MAX_AGE_DAYS = 365;
const ERROR_EVENTS_MAX_ROWS = 50_000;
/// Rows deleted per sweep, in each direction. Small, bounded, and indexed (error_events_at_idx),
/// so the sweep can run on the hot path without becoming its own incident.
const SWEEP_BATCH = 500;
/// Sweep every 64th write. Per-instance counters drift apart across serverless instances,
/// which only means a few more or fewer sweeps — deletes outpace inserts eight to one, so the
/// table converges to the cap from either direction.
const SWEEP_EVERY = 64;

let writesSinceSweep = 0;

/// Bounded trim: delete the OLDEST rows past the age limit and the row cap, at most
/// SWEEP_BATCH each, using ctid so the statement is one pass over the at_ms index and needs
/// no count query. Under the cap the OFFSET selects nothing and the sweep is a no-op.
/// Exported for the cap drill — test/error-events-cap.test.ts is the drill, and a drill
/// that can only run against production is not a drill.
export async function sweepErrorEvents(): Promise<void> {
  try {
    await db().query(
      `DELETE FROM error_events
        WHERE ctid IN (
          SELECT ctid FROM error_events
           WHERE at_ms < (extract(epoch from now() - make_interval(days => $1)) * 1000)
           ORDER BY at_ms ASC, id ASC
           LIMIT $2
        )`,
      [ERROR_EVENTS_MAX_AGE_DAYS, SWEEP_BATCH],
    );
    await db().query(
      `DELETE FROM error_events
        WHERE ctid IN (
          SELECT ctid FROM error_events
           ORDER BY at_ms DESC, id DESC
           OFFSET $1
           LIMIT $2
        )`,
      [ERROR_EVENTS_MAX_ROWS, SWEEP_BATCH],
    );
  } catch (error) {
    // Same rule as the insert: a hygiene path that can throw is a second outage on top of
    // the first. The cap is a backstop, not a correctness condition.
    console.error(JSON.stringify({ errorEventSweepFailed: String(error) }));
  }
}

export async function recordFailure(failure: Failure): Promise<void> {
  try {
    await db().query(
      'INSERT INTO error_events (at_ms, source, detail, route) VALUES ($1, $2, $3, $4)',
      [Date.now(), failure.source.slice(0, 200), failure.detail.slice(0, 4000), failure.route ?? null],
    );
  } catch (error) {
    console.error(JSON.stringify({ errorLogFailed: String(error), source: failure.source }));
    return;
  }
  writesSinceSweep += 1;
  if (writesSinceSweep % SWEEP_EVERY === 0) {
    // Fire-and-forget: recording stays fast, and the sweep swallows its own errors.
    void sweepErrorEvents();
  }
}

export interface RecentFailure {
  atMs: number;
  source: string;
  detail: string;
  route: string | null;
}

export async function readRecentFailures(limit = 50): Promise<{ rows: RecentFailure[]; total: number }> {
  const capped = Math.max(1, Math.min(limit, 200));
  const [rows, total] = await Promise.all([
    db().query<{ at_ms: string; source: string; detail: string; route: string | null }>(
      'SELECT at_ms, source, detail, route FROM error_events ORDER BY at_ms DESC LIMIT $1',
      [capped],
    ),
    db().query<{ n: string }>('SELECT count(*)::text AS n FROM error_events'),
  ]);
  return {
    rows: rows.rows.map((r) => ({ atMs: Number(r.at_ms), source: r.source, detail: r.detail, route: r.route })),
    total: Number(total.rows[0]?.n ?? '0'),
  };
}
