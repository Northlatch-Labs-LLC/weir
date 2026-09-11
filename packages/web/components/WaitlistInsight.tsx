// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
/**
 * Who has joined the list, for the person who runs the site.
 *
 * # A server component, on purpose
 *
 * There is no interaction here and nothing to fetch from the browser. Rendering on the server means
 * the query runs only inside the branch that has already checked `Publisher` — so for anybody who
 * is not the site administrator, the data is never read, never serialised and never sent. A client
 * component would have to be handed the rows as props, which puts them in the page's payload for
 * whoever can see the page.
 *
 * # What it does not show
 *
 * An email address. Not once, not masked, not on hover. `lib/waitlist-insight.ts` carries the
 * reasoning and the type has nowhere to put one.
 *
 * # No new styles
 *
 * `card`, `stats`, `stat`, `k`, `v`, `note`, `lbl`, `mono`, `pill` and the bare `table` rules are
 * the panel vocabulary `AdminPanel` and `SiteModeSwitch` already use on this page. The arrivals
 * strip is laid out with inline flex on existing tokens, which is the same thing `AdminPanel` does
 * for its status colours — nothing is added to a stylesheet.
 */

import {
  identify,
  type Arrival,
  type DayCount,
  type Referrer,
  type Tally,
  type WaitlistInsight,
} from '@/lib/waitlist-insight';

function stamp(ms: number): string {
  return `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

/**
 * A name, or an honest blank.
 *
 * Somebody who gave no handle and joined before codes existed has nothing we may call them, and the
 * row still counts. An em dash says that; an invented id would suggest we know more than we do.
 */
function Who({ who }: { who: { handle: string | null; code: string | null } }) {
  const named = identify(who);
  if (named === null) {
    return <span style={{ color: 'var(--text-tertiary)' }}>— no handle, no code</span>;
  }
  return <span className={named.kind === 'code' ? 'mono' : undefined}>{named.label}</span>;
}

function Breakdown({ title, rows }: { title: string; rows: readonly Tally[] }) {
  return (
    <div className="card">
      <span className="k">{title}</span>
      <div className="stats" style={{ marginTop: 'var(--space-12)' }}>
        {rows.map((row) => (
          <div className="stat" key={row.key}>
            <span className="k">{row.key}</span>
            <span className="v">{row.count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Thirty days of arrivals.
 *
 * Heights are relative to the busiest day in the window, so the shape is readable whether the peak
 * is four signups or four hundred. A day with none is drawn as a floor rather than nothing at all:
 * an absent column and a zero column must not look the same, which is the whole reason `fillDays`
 * emits every day in the range.
 */
function Arrivals({ daily }: { daily: readonly DayCount[] }) {
  const peak = daily.reduce((most, day) => Math.max(most, day.count), 0);
  const first = daily[0];
  const last = daily[daily.length - 1];

  return (
    <div className="card">
      <span className="k">ARRIVALS · LAST {daily.length} DAYS</span>
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: '3px',
          height: '72px',
          marginTop: 'var(--space-16)',
        }}
      >
        {daily.map((day) => (
          <div
            key={day.day}
            title={`${day.day} · ${day.count}`}
            style={{
              flex: '1 1 0',
              minWidth: 0,
              height: peak === 0 ? '2px' : `${Math.max(2, Math.round((day.count / peak) * 72))}px`,
              borderRadius: '2px',
              background: day.count === 0 ? 'var(--border-subtle)' : 'var(--text-prize)',
            }}
          />
        ))}
      </div>
      <p className="k" style={{ marginTop: 'var(--space-12)', marginBottom: 0 }}>
        {first?.day} → {last?.day} · busiest day {peak}
      </p>
    </div>
  );
}

function Referrers({ rows }: { rows: readonly Referrer[] }) {
  return (
    <div className="card" style={{ marginTop: 'var(--space-20)' }}>
      <span className="k">WHO BROUGHT WHOM</span>
      {rows.length === 0 ? (
        <p className="empty" style={{ marginTop: 'var(--space-12)' }}>
          Nobody has arrived through a shared link yet.
        </p>
      ) : (
        <table style={{ marginTop: 'var(--space-12)' }}>
          <thead>
            <tr>
              <th>Who</th>
              <th>Their code</th>
              <th>Brought</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.handle ?? ''}:${row.code ?? ''}`}>
                <td>
                  <Who who={row} />
                </td>
                <td className="mono">{row.code ?? '—'}</td>
                <td>{row.referred}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Recent({ rows }: { rows: readonly Arrival[] }) {
  return (
    <div className="card" style={{ marginTop: 'var(--space-20)' }}>
      <span className="k">MOST RECENT</span>
      {rows.length === 0 ? (
        <p className="empty" style={{ marginTop: 'var(--space-12)' }}>
          Nobody has joined the list yet.
        </p>
      ) : (
        <div style={{ overflowX: 'auto', marginTop: 'var(--space-12)' }}>
          <table>
            <thead>
              <tr>
                <th>Who</th>
                <th>Says they are</th>
                <th>Came from</th>
                <th>Joined</th>
                <th>Via a link</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.joinedAtMs}:${row.code ?? row.handle ?? ''}`}>
                  <td>
                    <Who who={row} />
                  </td>
                  <td>{row.role}</td>
                  <td>{row.source}</td>
                  <td className="mono">{stamp(row.joinedAtMs)}</td>
                  <td>{row.referred ? 'yes' : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function WaitlistInsightPanel({ insight }: { insight: WaitlistInsight | null }) {
  if (insight === null) {
    return (
      <div className="card" data-reveal style={{ marginTop: 'var(--space-20)' }}>
        <h2 style={{ marginTop: 0 }}>The waiting list</h2>
        <div className="note crit" role="alert">
          <span className="lbl">Not measured</span>
          <p style={{ marginBottom: 0 }}>
            The list could not be read. This is not the same as an empty list — the reason is in the
            server log as <span className="mono">waitlistInsightFailed</span>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="card" data-reveal style={{ marginTop: 'var(--space-20)' }}>
      <h2 style={{ marginTop: 0 }}>The waiting list</h2>

      <p style={{ color: 'var(--text-secondary)' }}>
        Everybody who asked to be told when something ships. Counts, handles and referral codes —
        <strong> no email address is shown on this page</strong>, deliberately: the table is a list
        of addresses belonging to people interested in a platform about money, and this page is one
        screen-share away from being a copy of it.
      </p>

      <div className="stats" style={{ marginTop: 'var(--space-16)' }}>
        <div className="stat">
          <span className="k">On the list</span>
          <span className="v">{insight.total}</span>
        </div>
        <div className="stat">
          <span className="k">Asked for a handle</span>
          <span className="v">{insight.withHandle}</span>
        </div>
        <div className="stat">
          <span className="k">Came via a link</span>
          <span className="v">{insight.viaReferral}</span>
        </div>
      </div>

      <div style={{ marginTop: 'var(--space-20)' }}>
        <Arrivals daily={insight.daily} />
      </div>

      <div className="tiers" style={{ marginTop: 'var(--space-20)' }}>
        <Breakdown title="WHICH ARE THEY" rows={insight.byRole} />
        <Breakdown title="WHICH FORM" rows={insight.bySource} />
      </div>

      <Referrers rows={insight.topReferrers} />
      <Recent rows={insight.recent} />

      <div className="note" style={{ marginTop: 'var(--space-20)' }}>
        <span className="lbl">What a code is, and what it is not</span>
        <p>
          Every signup is minted a random 8-character code — Crockford alphabet, so no{' '}
          <span className="mono">O</span>, <span className="mono">I</span>,{' '}
          <span className="mono">L</span> or <span className="mono">U</span> — and it travels in the{' '}
          <span className="mono">/waitlist?ref=CODE</span> link that person shares. It is not derived
          from their address and their address cannot be recovered from it.
        </p>
        <p style={{ marginBottom: 0 }}>
          It records that somebody arrived through a link and it grants nothing: no earlier access,
          no position, no payment. The referral that pays is{' '}
          <span className="mono">referral_share_bps</span> in the contract, it settles on chain, and
          it is a different thing entirely.
        </p>
      </div>
    </div>
  );
}
