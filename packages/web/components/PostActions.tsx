'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude

/**
 * The actions on a post, as a column beside it.
 *
 * # Why this shape
 *
 * The pattern is the one every reader already has muscle memory for: a vertical stack of round
 * controls welded to the content, thumb-reachable, each labelled underneath. It is worth copying
 * because it is *learned* — not because it is novel.
 *
 * What it replaces is worse than a different layout. The actions on a post were scattered through
 * the card's prose: the only way to reach the comments was to scroll past the whole body, and there
 * was **no way to share a post at all** — on a social network. A reader who wanted to send a post
 * to somebody had to copy the browser's address bar, which does not contain the post.
 *
 * # Only actions that exist
 *
 * There is no like button here, and its absence is deliberate. Nothing in this product stores a
 * like: no table, no column, no on-chain object. A heart that incremented a number in the browser
 * and forgot it on reload would be the exact defect this codebase refuses everywhere else — a
 * screen that looks alive because somebody drew it that way.
 *
 * Tipping is a panel with an amount to enter, not a button, and it lives on the creator's page
 * where their vault and denomination are already resolved. "Support" therefore travels there rather
 * than duplicating a payment flow into a 44px circle. Unlocking stays in the locked block, beside
 * the price it charges — an action that costs money belongs next to the number.
 */

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
  /** False on a locked post — there is no thread rendered to jump to. */
  showComments: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [shareFailed, setShareFailed] = useState(false);

  const creatorHref = `/c/${authorHandle}${reader === undefined ? '' : `?reader=${reader}`}`;

  /*
    The link a reader would want to send.

    Built from `location.origin` rather than a configured host, because the correct answer is
    literally "the site you are looking at" — hardcoding one would hand somebody on a preview
    deployment a link to production, which is a different post list.

    `?reader=` is deliberately stripped. It names the account *you* are viewing as; sending it to
    somebody else asks the server about the wrong person, and since the read-session change it
    grants them nothing anyway. Sharing your own reader parameter is at best noise.
  */
  async function share() {
    const url = `${window.location.origin}/c/${authorHandle}#${postId}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setShareFailed(false);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused — an insecure origin, a permission policy, an older
      // browser. Saying so beats a button that appears to work and silently does nothing.
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
