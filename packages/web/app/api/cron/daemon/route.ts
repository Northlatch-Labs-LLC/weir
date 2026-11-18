// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
// The harvest daemon, ticked by Vercel Cron instead of a process on a box.
//
// History, because the shape of this route gets quoted:
//
//   - The daemon ran as a container on an OVH host beside the web app, `--once` under a restart
//     policy, because a supervisor restarts better than a process loops. When the host went away
//     and a Mac was ruled out as its replacement, the tick had to become something scheduled —
//     and on this stack the scheduler is Vercel Cron hitting this route hourly.
//
//   - Nothing about the daemon's own discipline changed. One invocation is one `--once` pass,
//     built from the same pieces the CLI passes are: config, then signer, then journal, then
//     runOnce, then the audit anchor. The journal's run lock still serializes overlapping
//     invocations (a lock held by another run is answered 200 as skipped — contention between
//     cron fires is the design working, not a failure). The signer still only ever calls a
//     permissionless harvest; see CUSTODY.md — its key is a hot gas key, so its secret living
//     in the same env as the database credential is the custody model, not a compromise of it.
//
//   - The dry-run mode survives as `?dry=1`: same pass, no journal, a signer that refuses to
//     sign. It is how a deployment is brought up before the funded key is pointed at it, the
//     same way the compose file ran `--once --dry-run` first.

import { NextResponse } from 'next/server';
import { createHash, timingSafeEqual } from 'node:crypto';
import { SuiGrpcClient } from '@mysten/sui/grpc';
import {
  anchor as anchorAudit,
  assertJournalConfigured,
  assertSignerConfigured,
  assertSignerFunded,
  createSigner,
  dryRunSigner,
  loadDaemonConfig,
  openJournal,
  readSignerBalance,
  runOnce,
  type HarvestSigner,
  type Journal,
  type RunHandle,
} from '@projectx-social/daemon';
import { simulateLimit } from '@/lib/rate-limit';
import { recordFailure } from '@/lib/error-log';

export const dynamic = 'force-dynamic';
// One pass is discovery plus reads plus at most a handful of signatures. 800s is the Pro
// maximum; a pass that runs into it has bigger problems than the schedule can fix.
export const maxDuration = 800;

function unconfigured(detail: string): NextResponse {
  return NextResponse.json({ configured: false, detail }, { status: 503 });
}

function secretMatches(request: Request): boolean {
  const expected = (process.env['CRON_SECRET'] ?? '').trim();
  const given = request.headers.get('authorization') ?? '';
  const presented = given.startsWith('Bearer ') ? given.slice('Bearer '.length).trim() : '';
  if (expected === '' || presented === '') return false;
  // Through a hash, not raw: timingSafeEqual throws on a length mismatch, and a digest has one length.
  const a = createHash('sha256').update(expected).digest();
  const b = createHash('sha256').update(presented).digest();
  return timingSafeEqual(a, b);
}

export async function GET(request: Request) {
  // The durable simulate ceiling, not the per-process limiter: the guard test holds every
  // route in this class to the durable budget, and this route is no exception to it.
  const limited = await simulateLimit(request);
  if (limited !== null) return limited;

  if (!secretMatches(request)) {
    return NextResponse.json({ error: 'this door is for the scheduler' }, { status: 401 });
  }

  const dry = new URL(request.url).searchParams.get('dry') === '1';

  // The daemon reads its own env names. The database is the same one the web app holds, under
  // the web app's name, so the names are joined here rather than configured twice.
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PROJECTX_DAEMON_DATABASE_URL:
      process.env['PROJECTX_DAEMON_DATABASE_URL'] ?? process.env['PROJECTX_DATABASE_URL'] ?? '',
  };
  const configReading = loadDaemonConfig(env);
  if (!configReading.ok) return unconfigured(configReading.failure.detail);
  const config = configReading.value;

  const started = Date.now();
  const client = new SuiGrpcClient({ network: 'mainnet', baseUrl: config.grpcUrl });

  let signer: HarvestSigner;
  if (dry) {
    signer = dryRunSigner();
  } else {
    const secret = assertSignerConfigured(config);
    if (!secret.ok) return unconfigured(secret.failure.detail);

    const built = await createSigner(client, secret.value, config.gasBudgetMist, config.latestPackageId);
    if (!built.ok) return unconfigured(built.failure.detail);

    const balance = await readSignerBalance(client, built.value.address);
    if (!balance.ok) return unconfigured(balance.failure.detail);
    const funded = assertSignerFunded(balance.value, config.gasBudgetMist);
    if (!funded.ok) return unconfigured(funded.failure.detail);

    signer = built.value;
  }

  let journal: Journal | null = null;
  let run: RunHandle | null = null;
  if (!dry) {
    const url = assertJournalConfigured(config);
    if (!url.ok) return unconfigured(url.failure.detail);

    const opened = await openJournal(url.value);
    if (!opened.ok) {
      if (opened.failure.detail.includes('already holds the run lock')) {
        // Another run holds the lock: the daemon is alive somewhere. Answer success.
        return NextResponse.json({ skipped: true, reason: 'another run holds the lock' });
      }
      return NextResponse.json({ error: 'journal', detail: opened.failure.detail }, { status: 500 });
    }
    journal = opened.value;

    const begin = await journal.begin({ mode: dry ? 'dry-run' : 'live', signer: signer.address });
    if (!begin.ok) {
      // An unrecorded harvest is not permitted, and neither is a run the journal refused.
      await journal.close();
      return NextResponse.json(
        { error: 'journal', detail: `begin refused: ${begin.failure.detail}` },
        { status: 500 },
      );
    }
    run = begin.value;
  }

  try {
    const result = await runOnce(client, config, signer);
    const took = Date.now() - started;

    if (!result.ok) {
      if (journal !== null && run !== null) {
        await journal.abandon(run, { kind: result.failure.kind, detail: result.failure.detail });
        await anchorAudit(journal, run, signer);
      }
      await recordFailure({
        source: 'cron daemon',
        detail: result.failure.detail,
        route: '/api/cron/daemon',
      });
      return NextResponse.json(
        { tickFailed: result.failure.kind, detail: result.failure.detail, tookMs: took },
        { status: 500 },
      );
    }

    if (journal !== null && run !== null) {
      await journal.finish(run, result.value);
      await anchorAudit(journal, run, signer);
    }

    return NextResponse.json({
      mode: dry ? 'dry-run' : 'live',
      signer: signer.address,
      epoch: result.value.epoch.toString(),
      harvested: result.value.harvested.length,
      skipped: result.value.skipped.length,
      failed: result.value.failed.length,
      discoveryTruncated: result.value.discoveryTruncated,
      tickTruncated: result.value.truncated,
      tookMs: took,
    });
  } catch (error) {
    await recordFailure({
      source: 'cron daemon',
      detail: error instanceof Error ? error.message : String(error),
      route: '/api/cron/daemon',
    });
    return NextResponse.json({ error: 'this failed; the cause is recorded' }, { status: 500 });
  } finally {
    if (journal !== null) await journal.close();
  }
}
