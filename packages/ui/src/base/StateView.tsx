// Built-by: @projectx.sui · Co-authored-by: Claude
/**
 * The three things a screen can be when it is not showing what it came to show.
 *
 * These are the only loading, empty and error surfaces in the application. A screen that draws its
 * own is a screen that will drift, and the drift always goes the same way: a spinner with no end,
 * an empty list standing in for a failed read, and an error that says "something went wrong" to
 * somebody who has just spent money.
 *
 * The distinction this file exists to keep: **empty and failed are not the same thing.** An empty
 * list means we looked and there is nothing. A failed read means we could not look. Rendering the
 * second as the first tells a creator their work is gone.
 */

import type { ReactNode } from 'react';
import { Icon } from './Icon';

/** Skeletons shaped like what is coming — never a centred spinner on a whole page. */
export function Loading({
  shape = 'lines',
  count = 3,
  label = 'Loading',
}: {
  shape?: 'lines' | 'post' | 'row' | 'figures';
  count?: number;
  label?: string;
}) {
  const items = Array.from({ length: count }, (_, i) => i);

  if (shape === 'post') {
    return (
      <div role="status" aria-live="polite">
        <span className="w-vh">{label}</span>
        {items.map((i) => (
          <div key={i} className="w-post" aria-hidden>
            <div className="w-post__row">
              <div className="w-skeleton" style={{ width: 44, height: 44, borderRadius: 999, flexShrink: 0 }} />
              <div className="w-post__body">
                <div className="w-skeleton" style={{ width: 180, height: 14, marginBottom: 12 }} />
                <div className="w-skeleton" style={{ width: '100%', height: 12, marginBottom: 8 }} />
                <div className="w-skeleton" style={{ width: '88%', height: 12, marginBottom: 8 }} />
                <div className="w-skeleton" style={{ width: '54%', height: 12 }} />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (shape === 'figures') {
    return (
      <div role="status" aria-live="polite" style={{ display: 'grid', gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))`, gap: 12, padding: '20px 22px' }}>
        <span className="w-vh">{label}</span>
        {items.map((i) => (
          <div key={i} className="w-card" aria-hidden>
            <div className="w-skeleton" style={{ width: 96, height: 11, marginBottom: 12 }} />
            <div className="w-skeleton" style={{ width: 132, height: 26 }} />
          </div>
        ))}
      </div>
    );
  }

  if (shape === 'row') {
    return (
      <div role="status" aria-live="polite">
        <span className="w-vh">{label}</span>
        {items.map((i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '15px 22px', borderBottom: '1px solid var(--w-line)' }} aria-hidden>
            <div className="w-skeleton" style={{ width: 44, height: 44, borderRadius: 999, flexShrink: 0 }} />
            <div className="w-skeleton" style={{ flex: 1, height: 13 }} />
            <div className="w-skeleton" style={{ width: 72, height: 16 }} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div role="status" aria-live="polite" style={{ padding: '20px 22px', display: 'grid', gap: 10 }}>
      <span className="w-vh">{label}</span>
      {items.map((i) => (
        <div key={i} className="w-skeleton" style={{ height: 13, width: `${100 - i * 12}%` }} aria-hidden />
      ))}
    </div>
  );
}

/**
 * We looked, and there is nothing.
 *
 * `fact` is a statement, never an apology. `narrowedBy` names the filter when the emptiness is
 * caused by one, so a reader is not told the network is empty when it is their own Following tab
 * that is. Weir is early and its lists are short; every empty state here should read as early
 * rather than broken, and no screen invents a row to look busier than it is.
 */
export function EmptyState({
  fact,
  narrowedBy,
  action,
}: {
  fact: string;
  narrowedBy?: string;
  action?: ReactNode;
}) {
  return (
    <div className="w-state">
      <p className="w-state__fact">{fact}</p>
      {narrowedBy === undefined ? null : <p className="w-state__narrow">{narrowedBy}</p>}
      {action}
    </div>
  );
}

/**
 * We could not look, or something failed.
 *
 * `moneyState` is the field that makes this different from every other error screen, and it is
 * required on any surface where money is possible: somebody staring at a failure needs to know
 * what state their money is in before they need to know anything else. "Nothing was spent." is a
 * complete and often sufficient answer — say it rather than leaving them to guess.
 */
export function ErrorState({
  cause,
  moneyState,
  next,
  retry,
  retryLabel = 'Try again',
}: {
  cause: string;
  moneyState?: string;
  next: string;
  retry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div className="w-state w-state--error" role="alert">
      <span style={{ color: 'var(--w-rose)' }}>
        <Icon name="alerts" size={24} strokeWidth={1.5} />
      </span>
      <p className="w-state__fact">{cause}</p>
      {moneyState === undefined ? null : <p className="w-state__money">{moneyState}</p>}
      <p className="w-state__narrow">{next}</p>
      {retry === undefined ? null : (
        <button type="button" className="w-btn w-btn--quiet" onClick={retry}>
          {retryLabel}
        </button>
      )}
    </div>
  );
}

/**
 * A figure that could not be read.
 *
 * Never mono, never tabular, never shaped like a number — because a reader scanning a column of
 * figures will read anything in that shape as a measurement. This is the one rule in the codebase
 * that has already prevented a zero being shown for money nobody counted.
 */
export function Unmeasured({ what = 'not measured' }: { what?: string }) {
  return <span className="w-unread">{what}</span>;
}
