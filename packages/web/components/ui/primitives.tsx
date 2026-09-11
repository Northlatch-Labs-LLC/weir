// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import type { ReactNode } from 'react';

type Gap = 4 | 6 | 8 | 10 | 12 | 16 | 20 | 24 | 32;
type Align = 'start' | 'center' | 'end' | 'baseline' | 'stretch';
type Justify = 'start' | 'center' | 'end' | 'between';

const ALIGN: Record<Align, string> = {
  start: 'flex-start', center: 'center', end: 'flex-end',
  baseline: 'baseline', stretch: 'stretch',
};
const JUSTIFY: Record<Justify, string> = {
  start: 'flex-start', center: 'center', end: 'flex-end', between: 'space-between',
};

interface FlexProps {
  children: ReactNode;
  gap?: Gap;
  align?: Align;
  justify?: Justify;
  wrap?: boolean;
  className?: string;
}

export function Row({
  children, gap = 8, align = 'center', justify = 'start', wrap = true, className,
}: FlexProps) {
  return (
    <div
      className={className}
      style={{
        display: 'flex',
        alignItems: ALIGN[align],
        justifyContent: JUSTIFY[justify],
        gap: `var(--space-${gap})`,
        ...(wrap ? { flexWrap: 'wrap' } : {}),
      }}
    >
      {children}
    </div>
  );
}

export function Stack({
  children, gap = 12, align = 'stretch', justify = 'start', className,
}: FlexProps) {
  return (
    <div
      className={className}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: ALIGN[align],
        justifyContent: JUSTIFY[justify],
        gap: `var(--space-${gap})`,
      }}
    >
      {children}
    </div>
  );
}

export function Grid({ children, min = 200, gap = 16, className }: {
  children: ReactNode; min?: number; gap?: Gap; className?: string;
}) {
  return (
    <div
      className={className}
      style={{
        display: 'grid',
        gap: `var(--space-${gap})`,
        gridTemplateColumns: `repeat(auto-fit, minmax(${min}px, 1fr))`,
      }}
    >
      {children}
    </div>
  );
}

export function Card({ title, children, className }: {
  title?: string; children: ReactNode; className?: string;
}) {
  return (
    <div className={className === undefined ? 'card' : `card ${className}`}>
      {title !== undefined && <span className="k">{title}</span>}
      {children}
    </div>
  );
}

export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={className === undefined ? 'panel' : `panel ${className}`}>{children}</div>;
}

export function Stat({ label, value, tone, note }: {
  label: string;
  value: ReactNode;
  tone?: 'good' | 'warn' | 'danger';
  note?: ReactNode;
}) {
  const colour =
    tone === 'good' ? 'var(--text-prize)'
    : tone === 'warn' ? 'var(--text-warning)'
    : tone === 'danger' ? 'var(--text-danger)'
    : undefined;
  return (
    <div className="stat">
      <span className="k">{label}</span>
      <span className="v" style={colour === undefined ? undefined : { color: colour }}>
        {value}
      </span>
      {note !== undefined && (
        <p className="section-note" style={{ marginBottom: 0 }}>{note}</p>
      )}
    </div>
  );
}

export function Unmeasured({ detail, children }: { detail: string; children?: ReactNode }) {
  return (
    <div className="note crit" role="alert">
      <span className="lbl">Not measured</span>
      <p>{detail}</p>
      {children}
    </div>
  );
}

export function Loading({ what = 'Reading the chain…' }: { what?: string }) {
  return (
    <div className="panel" role="status">
      <p style={{ margin: 0, color: 'var(--text-tertiary)' }}>{what}</p>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="panel empty" role="status">
      {children}
    </div>
  );
}
