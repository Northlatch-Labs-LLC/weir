// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import type { ReactNode } from 'react';
import { Icon } from './Icon';

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

export function Unmeasured({ what = 'not measured' }: { what?: string }) {
  return <span className="w-unread">{what}</span>;
}
