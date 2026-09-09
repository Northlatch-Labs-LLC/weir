'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude
/**
 * A body that stops at a few lines, and says so.
 *
 * # Why the feed needs one
 *
 * A post on Weir is long-form — a recipe, a contract read line by line, a note an agent wrote about
 * what it found. Printed in full in the feed, one post fills the screen and the next is a scroll
 * away, so a reader sees three posts where they should see ten. Every comparable product clamps.
 *
 * # Why the control appears only when it is needed
 *
 * A "Read more" under two lines of text is a control that does nothing and a lie about there being
 * something behind it. So the element is measured after layout — `scrollHeight` against
 * `clientHeight` — and the button is rendered only when the clamp is actually hiding something.
 * Nothing is measured on the server, so the first paint is the clamped text with no button, and the
 * button appears with the effect. That order is deliberate: a button that flashes away is worse
 * than one that arrives.
 *
 * # It is not a substitute for the post
 *
 * Expanding shows the body the feed was given, which for a gated post is the free lede and nothing
 * more — `visiblePost` decided that on the server and this cannot widen it. The whole post, its
 * comments and its unlock live at `/p/<id>`.
 */

import { useEffect, useRef, useState } from 'react';

export function ExpandableText({
  children,
  className,
  /** Lines shown before the clamp. Four is about a paragraph, which is what a feed row is worth. */
  lines = 4,
  moreLabel = 'Read more',
  lessLabel = 'Show less',
}: {
  children: string;
  className?: string | undefined;
  lines?: number;
  moreLabel?: string;
  lessLabel?: string;
}) {
  const ref = useRef<HTMLParagraphElement | null>(null);
  const [open, setOpen] = useState(false);
  const [clamped, setClamped] = useState(false);

  /*
    Re-measured on resize, because the clamp is a line count and the line count changes with the
    column: a body that overflows four lines at 390px fits in three at 1440px, and a "Read more"
    left behind by a resize opens nothing.
  */
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const measure = () => setClamped(el.scrollHeight - el.clientHeight > 1);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [children]);

  return (
    <>
      <p
        ref={ref}
        className={className}
        {...(open ? {} : { 'data-clamp': String(lines) })}
        style={open ? undefined : { WebkitLineClamp: lines }}
      >
        {children}
      </p>
      {clamped || open ? (
        <button
          type="button"
          className="w-more"
          aria-expanded={open}
          onClick={() => setOpen((was) => !was)}
        >
          {open ? lessLabel : moreLabel}
        </button>
      ) : null}
    </>
  );
}
