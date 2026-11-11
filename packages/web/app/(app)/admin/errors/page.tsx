// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import type { Metadata } from 'next';
import { fold } from '@projectx-social/sdk';
import { PageHead } from '@/components/app/PageHead';
import { provenReader } from '@/lib/read-session';
import { isSiteAdmin } from '@/lib/site-admin';
import { readRecentFailures, type RecentFailure } from '@/lib/error-log';
import { db } from '@/lib/db';
import { siteConfig } from '@/lib/chain';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Health',
  description: 'Whether the site can reach its database and the chain, and every failure it has recorded.',
};

function when(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return 'under a minute ago';
  if (diff < 3_600_000) return Math.floor(diff / 60_000).toString() + ' minutes ago';
  if (diff < 86_400_000) return Math.floor(diff / 3_600_000).toString() + ' hours ago';
  return Math.floor(diff / 86_400_000).toString() + ' days ago';
}

export default async function HealthPage() {
  const viewer = fold(
    await provenReader(),
    (value) => value,
    () => null,
  );
  const admin = await isSiteAdmin(viewer);

  /*
    Three checks and a list. The point is that somebody who cannot read code can answer "is it
    working?" in five seconds, and see the last thing that failed without opening a terminal.
  */
  const dbCheck = await db()
    .query<{ n: string }>('SELECT 1::text AS n')
    .then(
      () => ({ ok: true as const, detail: 'reachable' }),
      (error: unknown) => ({ ok: false as const, detail: error instanceof Error ? error.message : String(error) }),
    );

  const chain = siteConfig();

  let failures: RecentFailure[] = [];
  let total = 0;
  let readError: string | null = null;
  if (admin) {
    try {
      const read = await readRecentFailures(50);
      failures = read.rows;
      total = read.total;
    } catch (error) {
      readError = error instanceof Error ? error.message : String(error);
    }
  }

  return (
    <>
      <PageHead
        kicker="Platform"
        title="Health"
        lede="Whether this deployment can reach what it depends on, and every failure it has recorded."
      />

      <div className="card">
        <span className="k">CHECKS</span>
        <div className="w-list__row">
          <span className="byline-name">Database</span>
          <span className={dbCheck.ok ? 'pill subs' : 'pill'}>{dbCheck.ok ? 'Reachable' : 'Failing'}</span>
          {dbCheck.ok ? null : <span className="w-mono">{dbCheck.detail.slice(0, 120)}</span>}
        </div>
        <div className="w-list__row">
          <span className="byline-name">Chain configuration</span>
          <span className={chain.ok ? 'pill subs' : 'pill'}>{chain.ok ? 'Present' : 'Missing'}</span>
        </div>
      </div>

      {admin ? null : (
        <div className="note">
          <p>Failures are visible to the site administrator only.</p>
        </div>
      )}

      {admin ? (
        <div className="card">
          <span className="k">FAILURES RECORDED</span>
          <p className="unmeasured">
            {total === 0
              ? 'Nothing has been recorded. That means no failure has reached the recorder — not that none happened before it existed.'
              : total.toString() + ' recorded in total. The most recent fifty are below.'}
          </p>
          {readError === null ? null : <p className="note crit">{readError}</p>}
          {failures.map((f) => (
            <div className="w-list__row" key={f.atMs.toString() + f.source}>
              <span className="byline-name">{f.source}</span>
              <span className="w-mono">{when(f.atMs)}</span>
              <span className="w-mono">{f.route ?? '—'}</span>
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}
