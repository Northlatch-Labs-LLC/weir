'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude

/**
 * The scroll entrance — the brand's second motion register.
 *
 * # The hidden state belongs to script, not to the stylesheet
 *
 * The obvious implementation puts `opacity: 0` on `[data-reveal]` and lets an observer take it off.
 * That fails in exactly one way, and it fails silently: if JavaScript never runs — it errored, it
 * was blocked, a crawler chose not to — the element keeps the hidden state forever and the page is a
 * column of blank space. The content is in the HTML; nobody can see it.
 *
 * So the hidden state is scoped to `[data-js] [data-reveal]` in `weir.css`, and `data-js` is set on
 * `<html>` by an inline script in the root layout before first paint. No script, no attribute, no
 * hiding: the page renders as an ordinary document. With script, the attribute is already there when
 * the first frame paints, so there is no flash of visible-then-hidden either.
 *
 * # Fires once
 *
 * `unobserve` on entry. A reveal that replays every time an element scrolls back into view is not an
 * entrance, it is a flicker — and it makes reading a long page actively unpleasant.
 */

import { useEffect, useRef, type CSSProperties, type ReactNode } from 'react';

/** The tags this may become. Kept closed so the markup stays valid where it is used. */
type RevealTag = 'div' | 'section' | 'li' | 'article' | 'header';

export function Reveal({
  children,
  delayMs = 0,
  as: Tag = 'div',
  className = '',
}: {
  children: ReactNode;
  /** Stagger against siblings. The brand pack's rhythm is 90ms between them. */
  delayMs?: number;
  as?: RevealTag;
  className?: string;
}) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (element === null) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          /*
            Worth stating because getting it wrong is silent: the stylesheet hides
            `[data-reveal]:not([data-revealed])`, so writing the flag anywhere else leaves the hidden
            state matching forever. Nothing errors, the observer runs perfectly, and every section on
            the page stays invisible — which is exactly what happened here. Two attributes, one owner
            each; never one attribute carrying both the marker and the state.
          */
          entry.target.setAttribute('data-revealed', '');
          observer.unobserve(entry.target);
        }
      },
      {
        /*
          The root is the viewport, extended upwards without limit and pulled in 40px at the bottom.

          The bottom inset is the ordinary part: the entrance starts once the element is properly up
          rather than the instant its first pixel crosses the fold.

          The unbounded top is the part that matters, and it fixes a bug that broke the page in
          normal use. An observer only delivers an entry when an element's intersection *changes*,
          and something that goes from below the fold to above it in one jump was never intersecting
          either side of the move — so no callback ever arrives and it stays at `opacity: 0`
          permanently. That is not an edge case: it is a hash link into the middle of the page, a
          restored scroll position on back-navigation, the End key, or one flick of a trackpad.
          Measured before this fix, a single jump to the bottom left 16 of 22 sections invisible.

          Extending the root upward makes "already scrolled past" the same thing as "intersecting",
          so every element the reader has reached is guaranteed exactly one callback. Which is also
          the honest behaviour: an entrance animation for something the reader has already gone by
          is not an entrance.
        */
        rootMargin: '9999px 0px -40px 0px',
        threshold: 0.15,
      },
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const style = { '--reveal-delay': `${delayMs}ms` } as CSSProperties;

  return (
    <Tag ref={ref as never} className={className} data-reveal="" style={style}>
      {children}
    </Tag>
  );
}
