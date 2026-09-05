// Built-by: @projectx.sui · Co-authored-by: Claude
/**
 * The head of an application page.
 *
 * # Why this exists
 *
 * Two reasons, and the first is a regression.
 *
 * # Left-aligned, not centred
 */

import type { ReactNode } from 'react';

export function PageHead({
  kicker,
  title,
  accent,
  lede,
  actions,
  centered = false,
}: {
  /** The section this page belongs to, in mono caps. "Creator studio", "Your account". */
  kicker: string;
  /** The heading. Plain text — the emphasis is `accent`, so the gradient cannot swallow it all. */
  title: string;
  accent?: string;
  /** One or two sentences on what this page is for. Not marketing; what it does. */
  lede: ReactNode;
  /** Controls belonging to the page as a whole, set against the heading. */
  actions?: ReactNode;
  centered?: boolean;
}) {
  return (
    <header className={centered ? 'weir-pagehead weir-pagehead--centered' : 'weir-pagehead'}>
      <div className="weir-pagehead__row">
        <div className="weir-pagehead__text">
          <p className="weir-pagehead__kicker">{kicker}</p>
          <h1 className="weir-pagehead__title">
            {title}
            {accent !== undefined && (
              <>
                {' '}
                <span className="weir-grad">{accent}</span>
              </>
            )}
          </h1>
          <p className="weir-pagehead__lede">{lede}</p>
        </div>
        {actions !== undefined && <div className="weir-pagehead__actions">{actions}</div>}
      </div>
      <div className="weir-rule" aria-hidden />
    </header>
  );
}

/**
 * A titled block within a page.
 */
export function PageSection({
  title,
  hint,
  actions,
  reveal = false,
  children,
}: {
  title: string;
  /** One line under the heading. Absent is fine; a heading alone is a valid section. */
  hint?: string;
  actions?: ReactNode;
  reveal?: boolean;
  children: ReactNode;
}) {
  return (
    <section className="weir-section" aria-label={title} {...(reveal ? { 'data-reveal': '' } : {})}>
      <div className="weir-section__head">
        <div>
          <h2 className="weir-section__title">
            <span className="weir-grad">{title}</span>
          </h2>
          {hint !== undefined && <p className="weir-section__hint">{hint}</p>}
        </div>
        {actions !== undefined && <div className="weir-section__actions">{actions}</div>}
      </div>
      {children}
    </section>
  );
}
