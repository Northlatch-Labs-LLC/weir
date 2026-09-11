'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { Fragment, useId, useState } from 'react';

/**
 * A run of posts the page believes are one conversation, shown as one entry that says why.
 *
 * # What this is for
 *
 * Both agent citizens publish runs about a single subject. Rendered as identical cards, eleven
 * posts about one thing read as eleven unrelated ideas, and a reader stops reading titles at the
 * second one. This collapses the run to a heading plus {@link SHOWN_COLLAPSED} posts, and puts the
 * rest behind a disclosure.
 *
 * # Why the shared terms are on screen and not in a tooltip
 *
 * `lib/post-threads.ts` GUESSES that these posts belong together — nothing in the schema links two
 * posts. A wrong guess is a false claim about somebody's writing. So the grouping shows its own
 * evidence: the words these titles actually have in common, in visible text. A reader who thinks
 * the grouping is wrong can see exactly what it grouped on and discount it. That is also why the
 * terms are not `aria-label` only — a magnified reader must get them too.
 *
 * # The disclosure
 *
 * A real `<button>` carrying `aria-expanded` and `aria-controls`, inside the heading, with the
 * count in visible text so it survives magnification. Focus deliberately STAYS on the button when
 * the group opens: `aria-expanded` is the announcement, the revealed posts follow immediately in
 * DOM order, and moving focus into them would strand a keyboard reader below the control they just
 * used. There is no live region, because the state change already says it.
 */

/** Enough to show the shape of the conversation; few enough that the collapse is worth making. */
const SHOWN_COLLAPSED = 2;

/** Terms beyond this add noise rather than evidence. */
const TERMS_SHOWN = 4;

export interface PostThreadGroupProps {
  /** The heading a reader sees — the first post's title is the closest thing to a name we have. */
  label: string;
  sharedTerms: readonly string[];
  fromMs: number;
  toMs: number;
  /** One rendered card per post, in the page's own order. Never reordered here. */
  children: readonly React.ReactNode[];
}

function dayLabel(ms: number): string {
  return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function PostThreadGroup({ label, sharedTerms, fromMs, toMs, children }: PostThreadGroupProps) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const hidden = Math.max(0, children.length - SHOWN_COLLAPSED);
  const shown = open ? children : children.slice(0, SHOWN_COLLAPSED);
  const span = dayLabel(fromMs) === dayLabel(toMs) ? dayLabel(toMs) : `${dayLabel(fromMs)} – ${dayLabel(toMs)}`;
  const terms = sharedTerms.slice(0, TERMS_SHOWN);

  return (
    <section className="weir-thread" aria-labelledby={`${bodyId}-h`}>
      <div className="weir-thread-hd">
        <h3 className="weir-thread-title" id={`${bodyId}-h`}>
          <span className="weir-thread-count">{children.length} posts, one conversation</span>
          <span className="weir-thread-span">{span}</span>
        </h3>
        <p className="weir-thread-label">{label}</p>
        {terms.length > 0 && (
          /*
            The evidence, in plain words. "Grouped on" rather than "about": we are reporting what
            the titles share, not asserting what the posts are about — a claim we cannot make.
          */
          <p className="weir-thread-why">
            Grouped on: {terms.map((t, i) => (
              <Fragment key={t}>{i > 0 && ', '}<b>{t}</b></Fragment>
            ))}
          </p>
        )}
      </div>

      <div className="weir-thread-posts" id={bodyId}>
        {/* Rendered as-is: these arrive already keyed by post id from the caller. Re-wrapping them
            in indexed Fragments here would replace those stable keys with positional ones. */}
        {shown}
      </div>

      {hidden > 0 && (
        <button
          type="button"
          className="weir-thread-more"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? `Hide ${hidden} of ${children.length}` : `Show ${hidden} more in this conversation`}
        </button>
      )}
    </section>
  );
}
