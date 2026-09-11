// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { Pool, type PoolClient } from 'pg';
import { classify, fail, ok, type Reading } from '@projectx-social/sdk';
import type { TickResult } from '../engine.js';

const LOCK_KEY = 0x70783a68617276n;

export interface RunHandle {
  id: number;
}

export interface Journal {
  begin(input: { mode: 'live' | 'dry-run'; signer: string }): Promise<Reading<RunHandle>>;
  finish(run: RunHandle, result: TickResult & { discoveryTruncated: boolean }): Promise<Reading<true>>;
  abandon(run: RunHandle, failure: { kind: string; detail: string }): Promise<Reading<true>>;
  anchorAudit(
    run: RunHandle,
    head: { signer: string; headHash: string; entries: number; intact: boolean },
  ): Promise<Reading<true>>;
  stuckRuns(olderThanMs: number): Promise<Reading<Array<{ id: number; startedAtMs: number }>>>;
  recentRuns(limit: number): Promise<Reading<RunSummary[]>>;
  lastHarvestOf(vaultId: string): Promise<Reading<{ atMs: number; digest: string } | null>>;
  close(): Promise<void>;
}

export interface RunSummary {
  id: number;
  startedAtMs: number;
  endedAtMs: number | null;
  mode: string;
  epoch: bigint | null;
  vaultsSeen: number;
  harvested: number;
  skipped: number;
  failed: number;
  outcome: string;
  failureDetail: string | null;
  truncated: boolean;
  auditHead: { headHash: string; entries: number; intact: boolean } | null;
}

export async function openJournal(databaseUrl: string): Promise<Reading<Journal>> {
  const source = 'daemon journal';
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });

  let lockConnection: PoolClient;
  try {
    lockConnection = await pool.connect();
  } catch (error) {
    await pool.end().catch(() => undefined);
    const failure = classify(error, source);
    return fail(failure.kind, source, `could not reach the journal database: ${failure.detail}`);
  }

  try {
    const { rows } = await lockConnection.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock($1::bigint) AS locked',
      [LOCK_KEY.toString()],
    );
    if (rows[0]?.locked !== true) {
      lockConnection.release();
      await pool.end().catch(() => undefined);
      return fail(
        'unconfigured',
        source,
        'another harvest daemon already holds the run lock on this database. ' +
          'Two instances would both pay gas for the same work — the second one for transactions ' +
          'that change nothing, because the contract refuses a second rung in an epoch.',
      );
    }
  } catch (error) {
    lockConnection.release();
    await pool.end().catch(() => undefined);
    const failure = classify(error, source);
    return fail(failure.kind, source, failure.detail);
  }

  const guard = async <T>(what: string, run: () => Promise<T>): Promise<Reading<T>> => {
    try {
      return ok(await run());
    } catch (error) {
      const failure = classify(error, `${source}: ${what}`);
      return fail(failure.kind, failure.source, failure.detail);
    }
  };

  const journal: Journal = {
    begin: (input) =>
      guard('begin', async () => {
        const { rows } = await pool.query<{ id: string }>(
          `INSERT INTO daemon_runs (started_at_ms, mode, signer, outcome)
           VALUES ($1, $2, $3, 'running')
           RETURNING id`,
          [Date.now(), input.mode, input.signer],
        );
        return { id: Number(rows[0]!.id) };
      }),

    finish: (run, result) =>
      guard('finish', async () => {
        const connection = await pool.connect();
        try {
          await connection.query('BEGIN');
          await connection.query(
            `UPDATE daemon_runs
                SET ended_at_ms = $2, epoch = $3, vaults_seen = $4, harvested = $5,
                    skipped = $6, failed = $7, discovery_truncated = $8, tick_truncated = $9,
                    outcome = 'ok'
              WHERE id = $1`,
            [
              run.id,
              Date.now(),
              result.epoch.toString(),
              result.harvested.length + result.skipped.length + result.failed.length,
              result.harvested.length,
              result.skipped.length,
              result.failed.length,
              result.discoveryTruncated,
              result.truncated,
            ],
          );

          const at = Date.now();
          const write = async (
            outcome: 'harvested' | 'skipped' | 'failed',
            outcomes: TickResult['harvested'],
          ) => {
            for (const o of outcomes) {
              await connection.query(
                `INSERT INTO daemon_harvests (run_id, vault_id, epoch, outcome, reason, digest, error, at_ms)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                 ON CONFLICT (run_id, vault_id) DO NOTHING`,
                [
                  run.id,
                  o.vaultId,
                  result.epoch.toString(),
                  outcome,
                  o.decision.reason,
                  o.digest ?? null,
                  o.error ?? null,
                  at,
                ],
              );
            }
          };
          await write('harvested', result.harvested);
          await write('skipped', result.skipped);
          await write('failed', result.failed);
          await connection.query('COMMIT');
        } catch (error) {
          await connection.query('ROLLBACK').catch(() => undefined);
          throw error;
        } finally {
          connection.release();
        }
        return true as const;
      }),

    abandon: (run, failure) =>
      guard('abandon', async () => {
        await pool.query(
          `UPDATE daemon_runs
              SET ended_at_ms = $2, outcome = 'failed', failure_kind = $3, failure_detail = $4
            WHERE id = $1`,
          [run.id, Date.now(), failure.kind, failure.detail],
        );
        return true as const;
      }),

    anchorAudit: (run, head) =>
      guard('anchorAudit', async () => {
        await pool.query(
          `INSERT INTO daemon_audit_anchors (run_id, signer, head_hash, entries, intact, recorded_at_ms)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [run.id, head.signer, head.headHash, head.entries, head.intact, Date.now()],
        );
        return true as const;
      }),
    stuckRuns: (olderThanMs) =>
      guard('stuckRuns', async () => {
        const { rows } = await pool.query<{ id: string; started_at_ms: string }>(
          `SELECT id, started_at_ms FROM daemon_runs
            WHERE outcome = 'running' AND started_at_ms < $1
            ORDER BY started_at_ms DESC LIMIT 50`,
          [Date.now() - olderThanMs],
        );
        return rows.map((r) => ({ id: Number(r.id), startedAtMs: Number(r.started_at_ms) }));
      }),

    recentRuns: (limit) =>
      guard('recentRuns', async () => {
        const { rows } = await pool.query<{
          id: string; started_at_ms: string; ended_at_ms: string | null; mode: string;
          epoch: string | null; vaults_seen: number; harvested: number; skipped: number;
          failed: number; outcome: string; failure_detail: string | null;
          discovery_truncated: boolean; tick_truncated: boolean;
          head_hash: string | null; entries: number | null; intact: boolean | null;
        }>(
          `SELECT r.*, a.head_hash, a.entries, a.intact
             FROM daemon_runs r LEFT JOIN daemon_audit_anchors a ON a.run_id = r.id
            ORDER BY r.started_at_ms DESC LIMIT $1`,
          [Math.min(limit, 200)],
        );
        return rows.map((r) => ({
          id: Number(r.id),
          startedAtMs: Number(r.started_at_ms),
          endedAtMs: r.ended_at_ms === null ? null : Number(r.ended_at_ms),
          mode: r.mode,
          epoch: r.epoch === null ? null : BigInt(r.epoch),
          vaultsSeen: r.vaults_seen,
          harvested: r.harvested,
          skipped: r.skipped,
          failed: r.failed,
          outcome: r.outcome,
          failureDetail: r.failure_detail,
          truncated: r.discovery_truncated || r.tick_truncated,
          auditHead:
            r.head_hash === null || r.entries === null || r.intact === null
              ? null
              : { headHash: r.head_hash, entries: r.entries, intact: r.intact },
        }));
      }),

    lastHarvestOf: (vaultId) =>
      guard('lastHarvestOf', async () => {
        const { rows } = await pool.query<{ at_ms: string; digest: string }>(
          `SELECT at_ms, digest FROM daemon_harvests
            WHERE vault_id = $1 AND outcome = 'harvested'
            ORDER BY at_ms DESC LIMIT 1`,
          [vaultId],
        );
        const row = rows[0];
        return row === undefined ? null : { atMs: Number(row.at_ms), digest: row.digest };
      }),

    close: async () => {
      lockConnection.release();
      await pool.end().catch(() => undefined);
    },
  };

  return ok(journal);
}
