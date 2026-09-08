import type { ReactNode } from 'react';
import Pattern from './Pattern';

// Shared states: loading (flat blocks, no shimmer), empty (pattern + fact + action),
// error (cause + money state + next move). No bare spinners, no encouragement.

export function Loading({ lines = 3 }: { lines?: number }) {
  return (
    <div className="flex flex-col gap-4" aria-label="Loading" role="status">
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="rounded-md bg-white/6"
          style={{ height: i === 0 ? 96 : 72, width: i === lines - 1 ? '62%' : '100%' }}
        />
      ))}
      <span className="sr-only">Loading</span>
    </div>
  );
}

export function EmptyState({
  seed,
  fact,
  action,
}: {
  seed: string;
  fact: string;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-ink-4 bg-ink-1 p-8 text-center">
      <Pattern seed={seed} className="mx-auto h-16 w-24 text-ink-7" />
      <p className="mx-auto mt-5 max-w-[48ch] text-body text-ink-9">{fact}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function ErrorState({
  cause,
  moneyState,
  next,
  retry,
}: {
  cause: string;
  moneyState: string;
  next: string;
  retry?: () => void;
}) {
  return (
    <div className="rounded-lg border border-rose/40 bg-ink-1 p-6" role="alert">
      <div className="flex items-center gap-2 text-body-sm font-medium text-rose">
        <span aria-hidden>!</span>
        {cause}
      </div>
      <p className="mt-3 text-body-sm text-ink-8">{moneyState}</p>
      <p className="mt-2 text-body-sm text-ink-8">{next}</p>
      {retry ? (
        <button
          type="button"
          onClick={retry}
          className="mt-4 inline-flex min-h-[44px] items-center rounded-md border border-ink-5 bg-ink-2 px-4 py-2 text-body-sm text-ink-10 whitespace-nowrap cursor-pointer"
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}