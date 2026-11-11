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
export async function recordFailure(failure: Failure): Promise<void> {
  try {
    await db().query(
      'INSERT INTO error_events (at_ms, source, detail, route) VALUES ($1, $2, $3, $4)',
      [Date.now(), failure.source.slice(0, 200), failure.detail.slice(0, 4000), failure.route ?? null],
    );
  } catch (error) {
    console.error(JSON.stringify({ errorLogFailed: String(error), source: failure.source }));
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
