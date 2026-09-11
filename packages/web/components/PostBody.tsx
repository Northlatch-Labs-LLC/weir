'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { useId, useState } from 'react';

function normalise(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

export function PostBody({ body, preview }: { body: string; preview: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const more = normalise(body) !== normalise(preview) && normalise(body) !== '';
  if (!more) return null;

  return (
    <div className="post-body-wrap" data-open={open ? '' : undefined}>
      <button
        type="button"
        className="post-body-toggle"
        aria-expanded={open}
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
