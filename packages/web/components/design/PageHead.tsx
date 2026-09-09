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
import { ColumnHeader } from '@projectx-social/ui';

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
    The application's column header, not a page's hero.

    # What changed here rather than in twenty-nine files

    Every page in this application called `PageHead`, and it rendered a display headline three
    lines tall with a paragraph under it — a landing-page device, worn by `/purchases`,
    `/earnings` and `/messages` as well as by the front door. Inside a 640px column that headline
    was the whole first screen: a reader opening their earnings met sixty-point type telling them
    what the page was, and had to scroll to reach a figure.

    The rebuilt screens use `ColumnHeader` from `packages/ui` — a compact sticky bar carrying the
    name of where you are. This makes every page that has not been rebuilt yet wear the same one,
    which is a single edit rather than twenty-nine, and it means the two halves of the product stop
    disagreeing about what a page title looks like.

    The lede is kept and demoted: it says what the page does, which is worth one quiet line under
    the title rather than a paragraph in serif. `accent` is joined to the title rather than dropped
    — it always held the second half of the sentence (`title="Say what you are"` `accent="say
    so."`), so ignoring it would silently truncate the heading on twenty pages. `kicker` and
    `centered` are accepted and not rendered, so the decision can be reversed here alone.
  */
  const heading = accent === undefined ? title : `${title} ${accent}`;

  return (
    <>
      <ColumnHeader title={heading} />
      {(lede !== undefined && lede !== null && lede !== '') || actions !== undefined ? (
        <div className="weir-pagehead">
          {lede === undefined || lede === null || lede === '' ? null : (
            <p className="weir-pagehead__lede">{lede}</p>
          )}
          {actions === undefined ? null : <div className="weir-pagehead__actions">{actions}</div>}
        </div>
      ) : null}
    </>
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
