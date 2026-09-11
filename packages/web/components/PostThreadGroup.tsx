'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { Fragment, useId, useState } from 'react';

const SHOWN_COLLAPSED = 2;

const TERMS_SHOWN = 4;

export interface PostThreadGroupProps {
  label: string;
  sharedTerms: readonly string[];
  fromMs: number;
  toMs: number;
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
          <p className="weir-thread-why">
            Grouped on: {terms.map((t, i) => (
              <Fragment key={t}>{i > 0 && ', '}<b>{t}</b></Fragment>
            ))}
          </p>
        )}
      </div>

      <div className="weir-thread-posts" id={bodyId}>
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
