import { useId, useState } from 'react';
import type { FeedEntry } from '@/lib/grouping';
import type { Post } from '@/lib/api/types';
import PostCard from './PostCard';
import Icon from '@/components/base/Icon';

// A grouped run of consecutive posts that share a subject. Shows the first two;
// discloses the rest. The disclosure prints the evidence — the shared tokens —
// in mono, so a reader who disagrees can see exactly what was grouped on.
export default function PostGroup({
  entry,
  onSupport,
  onShare,
}: {
  entry: Extract<FeedEntry, { kind: 'group' }>;
  onSupport?: (p: Post) => void;
  onShare?: (p: Post) => void;
}) {
  const [open, setOpen] = useState(false);
  const rid = useId();
  const controlsId = `group-${rid}`;
  const rest = entry.posts.slice(2);
  const visible = entry.posts.slice(0, 2);

  return (
    <section className="rounded-lg border border-ink-4 bg-ink-1/60 p-3 sm:p-4" aria-labelledby={`group-heading-${rid}`}>
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-2 px-2 pt-1">
        <h2 id={`group-heading-${rid}`} className="text-caption font-medium uppercase tracking-wide text-ink-8">
          {entry.posts.length} consecutive posts by @{entry.author}
        </h2>
        <span className="text-caption text-ink-7">
          Grouped on: <span className="font-mono text-ink-8">{entry.sharedTokens.join(', ')}</span>
        </span>
      </header>

      <div className="flex flex-col gap-3">
        {visible.map(p => (
          <PostCard key={p.id} post={p} onSupport={onSupport} onShare={onShare} />
        ))}
      </div>

      {rest.length > 0 && (
        <div className="mt-3">
          <h3 className="px-2">
            <button
              type="button"
              aria-expanded={open}
              aria-controls={controlsId}
              onClick={() => setOpen(v => !v)}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-md border border-ink-5 bg-ink-2 px-3 py-2 text-body-sm font-medium text-ink-9 hover:border-ink-6 hover:text-ink-10 whitespace-nowrap cursor-pointer"
            >
              <Icon name="chevron-down" size={16} className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
              {open
                ? `Hide ${rest.length} more in this conversation`
                : `Show ${rest.length} more in this conversation`}
            </button>
          </h3>

          {/* Animate grid-template-rows so the header does not move under the thumb. */}
          <div
            id={controlsId}
            style={{
              display: 'grid',
              gridTemplateRows: open ? '1fr' : '0fr',
              transition: 'grid-template-rows 260ms var(--ease-water)',
            }}
          >
            <div
              inert={!open}
              style={{
                overflow: 'hidden',
                minHeight: 0,
                opacity: open ? 1 : 0,
                transition: 'opacity 140ms ease',
                transitionDelay: open ? '120ms' : '0ms',
              }}
            >
              <div className="mt-3 flex flex-col gap-3">
                {rest.map(p => (
                  <PostCard key={p.id} post={p} onSupport={onSupport} onShare={onShare} />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}