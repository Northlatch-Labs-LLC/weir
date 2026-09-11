'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { useState } from 'react';
import Link from 'next/link';

const ICONS = {
  creator: 'M3 21v-2a4 4 0 0 1 4-4h5a4 4 0 0 1 4 4v2M9.5 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8',
  support: 'M12 21s-7-4.35-9-8.5A5 5 0 0 1 12 6a5 5 0 0 1 9 6.5C19 16.65 12 21 12 21Z',
  comment:
    'M21 11.5a8.4 8.4 0 0 1-9 8.4 8.5 8.5 0 0 1-3.9-.9L3 21l1.9-5A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5Z',
  share: 'M4 12v7a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7M16 6l-4-4-4 4M12 2v14',
  copied: 'M20 6 9 17l-5-5',
} as const;

function Glyph({ d }: { d: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={d} />
    </svg>
  );
}

export function PostActions({
  postId,
  authorHandle,
  reader,
  showComments,
}: {
  postId: string;
  authorHandle: string;
  reader?: string;
  showComments: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [shareFailed, setShareFailed] = useState(false);

  const creatorHref = `/c/${authorHandle}${reader === undefined ? '' : `?reader=${reader}`}`;

  async function share() {
    const url = `${window.location.origin}/c/${authorHandle}#${postId}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setShareFailed(false);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setShareFailed(true);
      window.setTimeout(() => setShareFailed(false), 3000);
    }
  }

  return (
    <div className="post-actions" role="group" aria-label="Actions for this post">
      <Link className="post-action" href={creatorHref} aria-label={`Open @${authorHandle}'s page`}>
        <span className="post-action__disc">
          <Glyph d={ICONS.creator} />
        </span>
        <span className="post-action__label">Creator</span>
      </Link>

      {/*
        Support carries to the creator's page because that is where the vault, the denomination and
        the tiers are. A tip needs an amount and a coin type; a circle can ask for neither.
      */}
      <Link
        className="post-action post-action--accent"
        href={creatorHref}
        aria-label={`Support @${authorHandle}`}
      >
        <span className="post-action__disc">
          <Glyph d={ICONS.support} />
        </span>
        <span className="post-action__label">Support</span>
      </Link>

      {/*
        An in-page anchor rather than a route: the thread is already rendered below this card for
        anybody entitled to it, so this is a jump and not a fetch. Absent on a locked post, where
        there is no thread to jump to.
      */}
      {showComments && (
        <a className="post-action" href={`#comments-${postId}`} aria-label="Go to the comments">
          <span className="post-action__disc">
            <Glyph d={ICONS.comment} />
          </span>
          <span className="post-action__label">Comments</span>
        </a>
      )}

      <button className="post-action" type="button" onClick={() => void share()}>
        <span className="post-action__disc">
          <Glyph d={copied ? ICONS.copied : ICONS.share} />
        </span>
        {/* The label carries the result, so the outcome is announced where the action was taken
            rather than in a toast somewhere else on the screen. */}
        <span className="post-action__label" aria-live="polite">
          {shareFailed ? 'Copy failed' : copied ? 'Copied' : 'Share'}
        </span>
      </button>
    </div>
  );
}
