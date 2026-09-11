'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { useEffect, useRef, useState } from 'react';

export function ExpandableText({
  children,
  className,
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
