'use client';
// Built-by: @projectx.sui /|\ · Co-authored-by: Claude

/**
 * Comments on one post.
 *
 * The signature is produced with `sui:signPersonalMessage` — no gas, no transaction. The statement
 * is built here for the wallet to display, and rebuilt independently on the server from the
 * request; if they disagree, verification fails. That is deliberate: the client's copy is for the
 * user to read before signing, never the thing that is trusted.
 */

import { useEffect, useState } from 'react';
import { useSigner } from '@/components/SignerProvider';
import { SignInPrompt } from '@/components/SignInPrompt';

interface Comment {
  id: string;
  author: string;
  text: string;
  createdAtMs: number;
}

/** Must match `statementFor` in lib/identity.ts exactly, or the signature will not verify. */
function statement(postId: string, text: string, address: string, timestampMs: number): string {
  return (
    `Weir\naddress: ${address}\nissued: ${timestampMs}\norigin: ${window.location.origin}` +
    `\naction: comment\npost: ${postId}\ntext: ${text}`
  );
}

export function Comments({ postId, reader }: { postId: string; reader?: string }) {
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { signer } = useSigner();

  useEffect(() => {
    const query = reader === undefined ? '' : `&reader=${reader}`;
    void fetch(`/api/comments?postId=${postId}${query}`)
      .then((r) => (r.ok ? r.json() : { comments: [] }))
      .then((b: { comments?: Comment[] }) => setComments(b.comments ?? []))
      .catch(() => setComments([]));
  }, [postId, reader]);


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
      <h4 className="k" style={{ marginBottom: 10 }}>
        {comments === null ? 'COMMENTS' : `${comments.length} COMMENT${comments.length === 1 ? '' : 'S'}`}
      </h4>

      {comments?.map((c) => (
        <div key={c.id} className="comment">
          <span className="mono comment-author">
            {c.author.slice(0, 6)}…{c.author.slice(-4)}
          </span>
          <span>{c.text}</span>
        </div>
      ))}

      {signer === null ? (
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
            {busy ? 'Signing…' : 'Post'}
          </button>
        </div>
      )}
      {error !== null && <p className="unmeasured">{error}</p>}
    </section>
  );
}
