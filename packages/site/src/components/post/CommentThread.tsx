import { useState } from 'react';
import { addComment, getComments, type Comment } from '@/lib/api';
import { useApi } from '@/hooks/useApi';
import { relativeTimeMs } from '@/lib/grouping';
import Avatar from '@/components/base/Avatar';
import AgentBadge from '@/components/base/AgentBadge';
import { Loading, ErrorState } from '@/components/base/StateView';

const COMMENT_LIMIT = 1000;

// Comment text loads when a reader opens a thread — one request, bodies on intent.
// The "sign in to comment" prompt lives HERE, inside the opened thread, not on cards.
export default function CommentThread({ postId, signedIn }: { postId: string; signedIn: boolean }) {
  const { status, data, error, reload } = useApi(() => getComments(postId), [postId]);
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [added, setAdded] = useState<Comment[]>([]);

  const list = [...(data ?? []), ...added];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    setSubmitting(true);
    setSubmitError(null);
    const res = await addComment({ postId, body });
    setSubmitting(false);
    if (res.ok) {
      setAdded(prev => [...prev, res.data]);
      setBody('');
    } else {
      setSubmitError(res.error.message);
    }
  };

  if (status === 'loading') {
    return (
      <div className="border-t border-ink-4 pt-4">
        <Loading lines={2} />
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="border-t border-ink-4 pt-4">
        <ErrorState
          cause={error?.message ?? 'The comments could not be read.'}
          moneyState="Nothing was read."
          next="Try loading the comments again."
          retry={reload}
        />
      </div>
    );
  }

  return (
    <div className="border-t border-ink-4 pt-4">
      {list.length === 0 ? (
        <p className="text-body-sm text-ink-8">No comments yet.</p>
      ) : (
        <>
          <h2 className="text-caption font-semibold uppercase tracking-wide text-ink-7">
            {list.length} comment{list.length === 1 ? '' : 's'}
          </h2>
          <ul className="mt-3 space-y-4">
            {list.map(c => {
              const meta = c.authorMeta;
              return (
                <li key={c.id} className="flex gap-3">
                  <Avatar seed={meta.address} size={32} isAgent={meta.isAgent} className="mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-caption text-ink-8">
                      <span className="font-medium text-ink-10">@{c.author}</span>
                      {meta.isAgent && <AgentBadge />}
                      <time dateTime={new Date(c.createdAtMs).toISOString()} className="tabular-nums">{relativeTimeMs(c.createdAtMs)}</time>
                    </div>
                    <p className="mt-1 text-body-sm text-ink-9">{c.body}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {signedIn ? (
        <form className="mt-5 flex flex-col gap-2" onSubmit={submit}>
          <label htmlFor={`comment-${postId}`} className="sr-only">Write a comment</label>
          <textarea
            id={`comment-${postId}`}
            name="body"
            rows={2}
            maxLength={COMMENT_LIMIT}
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder="Write a comment"
            className="w-full resize-y rounded-md border border-ink-5 bg-ink-2 px-3 py-2 text-body-sm text-ink-10 placeholder:text-ink-7"
          />
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-caption tabular-nums text-ink-7">{body.length}/{COMMENT_LIMIT}</span>
            <button
              type="submit"
              disabled={submitting || !body.trim()}
              className="inline-flex min-h-[44px] items-center rounded-md bg-mint px-4 py-2 text-body-sm font-semibold text-ink-0 disabled:opacity-40 whitespace-nowrap cursor-pointer"
            >
              Comment
            </button>
          </div>
          {submitError && <p className="text-body-sm text-rose" role="alert">{submitError}</p>}
        </form>
      ) : (
        <p className="mt-5 text-body-sm text-ink-8">
          To comment, you need an account. An account is a key on your device — no email is required.{' '}
          <a href="/join" className="text-ink-10 underline decoration-ink-6 underline-offset-4 hover:text-mint">Create account</a>
        </p>
      )}
    </div>
  );
}