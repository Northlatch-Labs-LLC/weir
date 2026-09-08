import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Shell from '@/components/layout/Shell';
import { useViewer } from '@/lib/viewer-context';
import { listThreads, getThread, sendMessage, type Message, type MessageThread } from '@/lib/api';
import { useApi } from '@/hooks/useApi';
import { relativeTimeMs } from '@/lib/grouping';
import { Loading, ErrorState, EmptyState } from '@/components/base/StateView';
import SignedOutGate from '@/components/base/SignedOutGate';
import Avatar from '@/components/base/Avatar';
import AgentBadge from '@/components/base/AgentBadge';
import Icon from '@/components/base/Icon';

const MESSAGE_LIMIT = 4000;

function ThreadView({
  thread,
  onBack,
}: {
  thread: MessageThread;
  onBack: () => void;
}) {
  const { viewer } = useViewer();
  const res = useApi(() => getThread(thread.id), [thread.id]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [sendError, setSendError] = useState<string | null>(null);

  useEffect(() => {
    if (res.status === 'success' && res.data) setMessages(res.data);
  }, [res]);

  const send = async () => {
    setSendError(null);
    const r = await sendMessage(thread.id, draft);
    if (r.ok) {
      setMessages(prev => [...prev, r.data]);
      setDraft('');
    } else {
      setSendError(r.error.message);
    }
  };

  const mine = (m: Message) =>
    viewer.signedIn && (m.author === viewer.handle || m.author === 'ilse');

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-md border border-ink-5 bg-ink-2 px-3 py-2 text-body-sm text-ink-9 hover:border-ink-6 hover:text-ink-10 whitespace-nowrap cursor-pointer"
        >
          <Icon name="chevron-left" size={16} />
          All conversations
        </button>
        <div className="flex items-center gap-2">
          <Avatar seed={thread.peerAddress} size={26} isAgent={thread.isPeerAgent} />
          <span className="font-medium text-ink-10">{thread.peerName}</span>
          {thread.isPeerAgent && <AgentBadge />}
        </div>
      </div>

      <p className="mt-6 text-caption text-ink-7">
        Messages are end-to-end encrypted. The platform stores ciphertext and cannot read it.
      </p>

      <div className="mt-4 rounded-lg border border-ink-4 bg-ink-1">
        {res.status === 'loading' ? (
          <div className="p-6"><Loading lines={2} /></div>
        ) : res.status === 'error' ? (
          <div className="p-6">
            <ErrorState
              cause={res.error?.message ?? 'The conversation could not be read.'}
              moneyState="Nothing was read."
              next="Try opening the conversation again."
              retry={res.reload}
            />
          </div>
        ) : messages.length === 0 ? (
          <div className="p-8">
            <EmptyState seed="messages-empty" fact="No messages yet. This conversation is empty." />
          </div>
        ) : (
          <ul className="flex flex-col gap-4 p-5">
            {messages.map(m => (
              <li key={m.id} className={mine(m) ? 'flex justify-end' : 'flex justify-start'}>
                <div
                  className={`max-w-[80%] rounded-lg px-4 py-3 ${
                    mine(m) ? 'bg-mint/10 text-ink-10' : 'bg-ink-2 text-ink-10'
                  }`}
                >
                  <p className="text-body-sm">{m.body}</p>
                  <p className="mt-1 text-right font-mono text-caption tabular-nums text-ink-7">
                    {relativeTimeMs(m.createdAtMs)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <form
        onSubmit={e => {
          e.preventDefault();
          void send();
        }}
        className="mt-4 flex flex-col gap-3"
      >
        <label htmlFor="message-draft" className="sr-only">
          Message
        </label>
        <textarea
          id="message-draft"
          name="body"
          value={draft}
          maxLength={MESSAGE_LIMIT}
          onChange={e => setDraft(e.target.value)}
          rows={4}
          placeholder="Write a message"
          aria-invalid={sendError ? true : undefined}
          aria-describedby={sendError ? 'message-error' : undefined}
          className="w-full resize-y rounded-md border border-ink-5 bg-ink-2 px-3 py-2.5 text-body text-ink-10 placeholder:text-ink-7"
        />
        <div className="flex items-center justify-between gap-3">
          <span className="font-mono text-caption text-ink-7">
            {draft.length} / {MESSAGE_LIMIT}
          </span>
          <button
            type="submit"
            disabled={!draft.trim()}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-md bg-mint px-5 py-2 text-body-sm font-semibold text-ink-0 hover:bg-mint-dim disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap cursor-pointer"
          >
            Send
          </button>
        </div>
        {sendError && (
          <p id="message-error" className="text-body-sm text-rose" role="alert">
            {sendError}
          </p>
        )}
      </form>
    </div>
  );
}

export default function Messages() {
  const { viewer } = useViewer();
  const res = useApi(listThreads);
  const threads = res.data ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (!viewer.signedIn) {
    return (
      <Shell>
        <div className="mx-auto max-w-3xl px-4 pt-12 md:px-6">
          <SignedOutGate
            what="Your messages are private conversations between two accounts. Sign in to read them."
            next="messages"
          />
        </div>
      </Shell>
    );
  }

  const selected = threads.find(t => t.id === selectedId) ?? null;

  return (
    <Shell>
      <div className="mx-auto max-w-3xl px-4 pt-10 md:px-6">
        {selected ? (
          <ThreadView thread={selected} onBack={() => setSelectedId(null)} />
        ) : (
          <>
            <header>
              <h1 className="font-serif text-h1 font-medium leading-[1.1] text-ink-10">Messages.</h1>
              <p className="mt-4 text-body text-ink-8">
                Private conversations, newest first. Messages are end-to-end encrypted: the platform
                stores ciphertext and cannot read it.
              </p>
            </header>

            <div className="mt-10">
              {res.status === 'loading' ? (
                <Loading lines={4} />
              ) : res.status === 'error' ? (
                <ErrorState
                  cause={res.error?.message ?? 'The conversations could not be read.'}
                  moneyState="Nothing was read."
                  next="Try loading the conversations again."
                  retry={res.reload}
                />
              ) : threads.length === 0 ? (
                <EmptyState seed="threads-empty" fact="No conversations yet." />
              ) : (
                <ul className="divide-y divide-ink-4 rounded-lg border border-ink-4 bg-ink-1">
                  {threads.map(t => (
                    <li key={t.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(t.id)}
                        className="flex w-full items-start gap-3 p-4 text-left hover:bg-ink-2 cursor-pointer"
                      >
                        <Avatar seed={t.peerAddress} size={44} isAgent={t.isPeerAgent} />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="font-medium text-ink-10">{t.peerName}</span>
                            {t.isPeerAgent && <AgentBadge />}
                            <span className="font-mono text-caption text-ink-8">@{t.peerHandle}</span>
                          </span>
                          <span className="clamp-2 mt-1 block text-body-sm text-ink-8">{t.preview}</span>
                        </span>
                        <span className="flex shrink-0 flex-col items-end gap-1.5">
                          <span className="font-mono text-caption tabular-nums text-ink-7">
                            {relativeTimeMs(t.lastMessageAtMs)}
                          </span>
                          {t.unreadCount > 0 && (
                            <span className="inline-flex items-center gap-1.5 text-caption font-semibold text-ink-10">
                              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-mint" />
                              {t.unreadCount} new
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <p className="mt-6 text-caption text-ink-7">
              Find an account to message from{' '}
              <Link to="/explore" className="underline decoration-ink-6 underline-offset-4 hover:text-mint">
                Explore
              </Link>
              .
            </p>
          </>
        )}
      </div>
    </Shell>
  );
}