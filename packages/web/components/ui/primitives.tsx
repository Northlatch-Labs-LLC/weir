// Built-by: @projectx.sui · Co-authored-by: Claude
/**
 * The component layer.
 *
 * # Why this exists
 *
 * There were 213 inline `style={{…}}` objects across the screens, most of them layout — a flex row
 * with a gap, written out again each time it was needed. That is not a styling problem, it is an
 * absence of components: with forty independent implementations of "a row", a spacing fix in one
 * screen cannot reach the next, and alignment drifts by construction rather than by carelessness.
 *
 * # These wrap the CSS that already exists
 *
 * `.btn`, `.card`, `.panel` and the rest live in `globals.css` and are built from `tokens.css`,
 * which is copied verbatim from projectxprotocol.dev and maps 1:1 to the Figma library. Introducing
 * a second styling system here — CSS-in-JS, utility classes — would create two sources of truth for
 * the same button and guarantee they diverge.
 *
 * So these are thin, typed wrappers. Every visual decision still lives in CSS; what is added is a
 * name, a set of states that cannot be forgotten, and one implementation per idea.
 *
 * # Everything here is safe in a Server Component
 *
 * None of these forwards an event handler onto a host element, so none needs `'use client'`. That
 * is deliberate and it is why `Button` and `Field` live in `controls.tsx` instead: they *do*
 * forward handlers, and React's Flight serializer throws on any prop matching `/^on[A-Z]/` crossing
 * the server boundary.
 *
 * Putting `'use client'` on this file to keep them together would pull `Stat`, `Card` and `Loading`
 * into the client bundle for every page that renders one — including creator profiles, which are
 * server-rendered precisely so a badge does not appear a moment after the page.
 */

import type { ReactNode } from 'react';

/* ------------------------------------------------------------------ layout */

/** Constrained to the token scale, so nothing is ever spaced at an eyeballed 7px. */
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

/**
 * A horizontal group.
 *
 * The `Gap` union is the load-bearing part. Accepting any number would let a row be spaced at
 * whatever looked right in one screen, which is how a set of pages stops looking like one product.
 *
 * **Wraps by default.** `body` sets `overflow-x: hidden` site-wide, so a row that cannot fit is
 * clipped with no way to scroll to what was cut off — at 400% zoom that is content a reader simply
 * cannot reach. Staying on one line is the exception and must be asked for. WCAG 2.2 1.4.10.
 */
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

/** A vertical group. Same constraint, same reason. */
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

/**
 * A grid that wraps rather than squashing.
 *
 * `min` is where a column breaks to the next line. Every stat row and card grid here wants this,
 * and each wrote its own `repeat(auto-fit, minmax(…))` with a different minimum.
 */
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

/* ------------------------------------------------------------------ surfaces */

/** A titled surface. `title` uses the established eyebrow style rather than a heading. */
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

/**
 * A labelled figure.
 *
 * `tone` carries meaning rather than decoration. Note what is absent: there is no `unmeasured`
 * tone, because a figure that could not be read must not render as a styled number at all. That
 * case is `Unmeasured` below, and keeping them different components is what stops the distinction
 * being lost to a prop.
 */
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

/* ------------------------------------------------------------------ states */

/**
 * A value that could not be read.
 *
 * Deliberately not a number, not a dash, and not zero. The rule this application is built on is
 * that a failed read never renders as a value — and the only way to keep that true across dozens of
 * screens is for "not measured" to be something a developer reaches for rather than a formatting
 * decision they make each time.
 */
export function Unmeasured({ detail, children }: { detail: string; children?: ReactNode }) {
  return (
    // `alert` rather than `status`: this replaces a figure somebody was waiting for, and the whole
    // product discipline is that a failed read must not pass unnoticed.
    <div className="note crit" role="alert">
      <span className="lbl">Not measured</span>
      <p>{detail}</p>
      {children}
    </div>
  );
}

/** Work in progress, stated rather than implied by emptiness. */
export function Loading({ what = 'Reading the chain…' }: { what?: string }) {
  return (
    // Announced politely, so a reader elsewhere on the page learns the region is working rather
    // than finding it silently unchanged.
    <div className="panel" role="status">
      <p style={{ margin: 0, color: 'var(--text-tertiary)' }}>{what}</p>
    </div>
  );
}

/**
 * Nothing here, having looked.
 *
 * Distinct from `Unmeasured` on purpose, and the distinction is this product's core discipline: an
 * empty list and an unreachable node look identical unless something insists they do not.
 */
export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="panel empty" role="status">
      {children}
    </div>
  );
}
