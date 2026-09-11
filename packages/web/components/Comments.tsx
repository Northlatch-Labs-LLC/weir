'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { useEffect, useState } from 'react';
import { useSigner } from '@/components/SignerProvider';
import { SignInPrompt } from '@/components/SignInPrompt';

interface Comment {
  id: string;
  author: string;
  text: string;
  createdAtMs: number;
}

function statement(postId: string, text: string, address: string, timestampMs: number): string {
  return (
    `Weir\naddress: ${address}\nissued: ${timestampMs}\norigin: ${window.location.origin}` +
    `\naction: comment\npost: ${postId}\ntext: ${text}`
  );
}

export function Comments({
  postId,
  reader,
  count,
}: {
  postId: string;
  reader?: string;
  count: number;
}) {
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { signer } = useSigner();

  useEffect(() => {
    if (!open || comments !== null) return;
    const query = reader === undefined ? '' : `&reader=${reader}`;
    void fetch(`/api/comments?postId=${postId}${query}`)
      .then((r) => (r.ok ? r.json() : { comments: [] }))
      .then((b: { comments?: Comment[] }) => setComments(b.comments ?? []))
      .catch(() => setComments([]));
  }, [open, comments, postId, reader]);

  async function submit() {
    if (signer === null || text.trim() === '') return;
    setBusy(true);
    setError(null);
    try {
      const trimmed = text.trim();
      const timestampMs = Date.now();
      const signature = await signer.signPersonalMessage(new TextEncoder().encode(
          statement(postId, trimmed, signer.address, timestampMs),
        ));

      const response = await fetch('/api/comments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          postId,
          author: signer.address,
          text: trimmed,
          signature,
          timestampMs,
        }),
      });
      const body = (await response.json()) as { comment?: Comment; error?: string };
      if (body.comment === undefined) {
        setError(body.error ?? 'could not post the comment');
      } else {
        setComments((current) => [...(current ?? []), body.comment!]);
        setText('');
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="comments">
      {/*
        Closed, this section is ONE control, not a heading and a button saying the same number.

        It carried both: an "N COMMENTS" heading above a "Read N comments" button, 80px on a card
        whose whole body was 329px — the tallest thing on the card, spent twice on one fact. The
        control states the count itself, so the heading is redundant until the thread is open and
        the count is no longer the only thing on screen.

        It is always rendered, even at zero, because the post's Comment action links to this
        section by anchor. A section that disappeared at zero would make that a link to nowhere.
      */}
      {open ? (
        <h4 className="k" style={{ marginBottom: 10 }}>
          {`${count} COMMENT${count === 1 ? '' : 'S'}`}
        </h4>
      ) : (
        <button
          type="button"
          className="btn weir-comments-open"
          aria-expanded={false}
          onClick={() => setOpen(true)}
        >
          {count === 0 ? 'Comment' : `Read ${count} comment${count === 1 ? '' : 's'}`}
        </button>
      )}

      {open && comments === null && <p className="unmeasured">Loading…</p>}

      {comments?.map((c) => (
        <div key={c.id} className="comment">
          <span className="mono comment-author">
            {c.author.slice(0, 6)}…{c.author.slice(-4)}
          </span>
          <span>{c.text}</span>
        </div>
      ))}

      {/*
        The prompt appears inside an OPEN thread, not under every post.

        It used to render on all of them: a creator page holding ten posts printed "Sign in to
        comment" ten times, to a reader who had not asked to comment on any of them. It answers a
        question nobody had asked yet, and repeating it ten times made it furniture. Opening a
        thread is the moment the question exists.
      */}
      {!open ? null : signer === null ? (
        <SignInPrompt action="comment" />
      ) : (
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <input
            aria-label="Write a comment"
            className="comment-input"
            value={text}
            placeholder="Say something…"
            onChange={(e) => setText(e.target.value)}
          />
          <button className="btn" type="button" disabled={busy} onClick={() => void submit()}>
            {busy ? 'Signing…' : 'Post comment'}
          </button>
        </div>
      )}
      {error !== null && <p className="unmeasured">{error}</p>}
    </section>
  );
}
