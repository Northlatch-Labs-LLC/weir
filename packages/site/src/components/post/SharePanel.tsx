import { useState } from 'react';
import Icon from '@/components/base/Icon';
import type { Post } from '@/lib/api/types';
import { makeDigest } from '@/lib/format';

// Share opens the native sheet where available; otherwise this panel. The copy
// button's own label becomes "Copied" for two seconds — no toast, no counter.
export default function SharePanel({ post, onClose }: { post: Post; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}/p/${post.id}`;
  const digest = makeDigest([post.id, post.authorHandle]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      // clipboard unavailable — nothing to do, label still confirms intent
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const shareNative = async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title: post.title, url });
      } catch {
        /* user dismissed */
      }
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="share-title"
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink-0/70 p-4 md:items-center"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-sm rounded-lg border border-ink-4 bg-ink-1 p-6">
        <div className="flex items-start justify-between gap-4">
          <h3 id="share-title" className="font-serif text-h4 font-medium text-ink-10">Share</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-ink-8 hover:text-ink-10 cursor-pointer"
          >
            <Icon name="close" size={18} />
          </button>
        </div>

        <p className="mt-2 clamp-2 font-serif text-body-sm text-ink-8">{post.title}</p>

        <div className="mt-6 flex flex-col gap-2">
          <button
            type="button"
            onClick={copy}
            className="inline-flex min-h-[44px] w-full items-center justify-between rounded-md border border-ink-5 bg-ink-2 px-4 py-2 text-body-sm text-ink-10 hover:border-ink-6 whitespace-nowrap cursor-pointer"
          >
            <span className="flex items-center gap-2">
              <Icon name="share" size={16} />
              {copied ? 'Copied' : 'Copy link'}
            </span>
            {copied && <Icon name="check" size={16} className="text-mint" />}
          </button>

          {post.access.kind === 'paid' && (
            <button
              type="button"
              onClick={copy}
              className="inline-flex min-h-[44px] w-full items-center gap-2 rounded-md border border-ink-5 bg-ink-2 px-4 py-2 text-body-sm text-ink-9 hover:border-ink-6 hover:text-ink-10 whitespace-nowrap cursor-pointer"
            >
              <Icon name="vault" size={16} />
              Copy receipt
            </button>
          )}

          {typeof navigator !== 'undefined' && 'share' in navigator && (
            <button
              type="button"
              onClick={shareNative}
              className="inline-flex min-h-[44px] w-full items-center gap-2 rounded-md border border-ink-5 bg-ink-2 px-4 py-2 text-body-sm text-ink-9 hover:border-ink-6 hover:text-ink-10 whitespace-nowrap cursor-pointer"
            >
              <Icon name="external" size={16} />
              Open share sheet
            </button>
          )}

          <a
            href={`https://suivision.xyz/txblock/${digest}`}
            rel="nofollow"
            target="_blank"
            className="inline-flex min-h-[44px] w-full items-center gap-2 rounded-md border border-ink-5 bg-ink-2 px-4 py-2 text-body-sm text-ink-9 hover:border-ink-6 hover:text-ink-10 whitespace-nowrap cursor-pointer"
          >
            <Icon name="external" size={16} />
            Open on Sui explorer
          </a>
        </div>
      </div>
    </div>
  );
}