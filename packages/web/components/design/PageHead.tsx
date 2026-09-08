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
  /**
   * The section this page belongs to, in mono caps. "Creator studio", "Your account".
   *
   * Optional, because most pages in the ported design do not have one: on a page whose title is
   * already the section — "Feed", "Explore" — a kicker above it repeats the word, and a repeated
   * word reads as a label rather than as a place.
   */
  kicker?: string;
  /** The heading. Plain text — the emphasis is `accent`, so the gradient cannot swallow it all. */
  title: string;
  accent?: string;
  /** One or two sentences on what this page is for. Not marketing; what it does. */
  lede: ReactNode;
  /** Controls belonging to the page as a whole, set against the heading. */
  actions?: ReactNode;
  centered?: boolean;
}) {
  /*
    One heading, left, in the serif — the ported design's page head.

    # What changed here rather than in twenty-nine files

    Every page in this application called `PageHead` with a `kicker`, a split `title`/`accent`, and
    often `centered`. That produced a mono-caps eyebrow above a two-tone gradient headline, centred
    on the page: a landing-page device, worn by `/purchases` and `/messages` as well as by the
    front door. The ported design gives every page the same plain treatment, so the change belongs
    to the component and not to its callers.

    `accent` is joined to the title rather than dropped. It always held the second half of the
    sentence — `title="Say what you are"` `accent="say so."` — so ignoring it would have silently
    truncated the heading on twenty pages.

    `kicker` and `centered` are still accepted and no longer rendered. Left in the signature
    deliberately: removing them is a twenty-nine-file edit that says nothing, and keeping them
    means the decision can be reversed here alone.
  */
  const heading = accent === undefined ? title : `${title} ${accent}`;

  return (
    <header className="weir-pagehead">
      <div className="weir-pagehead__row">
        <div className="weir-pagehead__text">
          <h1 className="weir-pagehead__title">{heading}</h1>
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
