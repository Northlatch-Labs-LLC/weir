'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude
/**
 * The body of a post, folded away behind "Read more".
 *
 * # Why a fold and not a clamp
 *
 * Now a card is the title, the picture, and the author's excerpt, and every card is about the same
 * height. The full body opens in place when the reader asks for it, and closes again.
 *
 * # When there is nothing to open
 *
 * A short post whose body *is* its excerpt gets no control. A control that reveals what is already
 * on the screen teaches the reader that this button does nothing.
 *
 * A `<button>` with `aria-expanded` rather than `<details>`: the disclosure widget a screen reader
 * announces promised a section, and the earlier version of this component learned that lesson.
 */
import { useId, useState } from 'react';

function normalise(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function PostBody({ body, preview }: { body: string; preview: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  /*
    The excerpt is the body's opening, or the whole of it. When the body adds nothing beyond the
    excerpt there is nothing to read more of.
  */
  const more = normalise(body) !== normalise(preview) && normalise(body) !== '';
  if (!more) return null;

  return (
    <div className="post-body-wrap" data-open={open ? '' : undefined}>
      <button
        type="button"
        className="post-body-toggle"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((was) => !was)}
      >
        <span aria-hidden="true" className="post-body-toggle__mark">
          {open ? '▴' : '▾'}
        </span>
        {open ? 'Show less' : 'Read more'}
      </button>
      {/* Not rendered while closed: a hidden body still costs layout and still lands in find-in-page. */}
      {open && (
        <div id={id} className="post-body">
          {body}
        </div>
      )}
    </div>
  );
}
