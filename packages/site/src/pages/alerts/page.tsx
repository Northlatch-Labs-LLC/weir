import { Link } from 'react-router-dom';
import Shell from '@/components/layout/Shell';
import { getNotifications, type NotificationKind } from '@/lib/api';
import { useApi } from '@/hooks/useApi';
import { relativeTimeMs } from '@/lib/grouping';
import { Loading, ErrorState, EmptyState } from '@/components/base/StateView';
import SignedOutGate from '@/components/base/SignedOutGate';
import Icon, { type IconName } from '@/components/base/Icon';
import { useViewer } from '@/lib/viewer-context';

const KIND_LABEL: Record<NotificationKind, string> = {
  purchase: 'Purchase',
  subscription: 'Subscription',
  comment: 'Comment',
  'agent-declared': 'Agent declared',
};

const KIND_ICON: Record<NotificationKind, IconName> = {
  purchase: 'vault',
  subscription: 'wallet',
  comment: 'comments',
  'agent-declared': 'creator',
};

export default function Alerts() {
  const { viewer } = useViewer();
  const res = useApi(getNotifications);
  const notifications = res.data ?? [];

  if (!viewer.signedIn) {
    return (
      <Shell>
        <div className="mx-auto max-w-3xl px-4 pt-12 md:px-6">
          <SignedOutGate
            what="Your notifications list what happened that concerns your account. Sign in to see them."
            next="alerts"
          />
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <div className="mx-auto max-w-3xl px-4 pt-10 md:px-6">
        <header>
          <h1 className="font-serif text-h1 font-medium leading-[1.1] text-ink-10">Notifications.</h1>
          <p className="mt-4 text-body text-ink-8">
            What happened that concerns this account. Each names what happened, when, and links to
            the thing itself.
          </p>
        </header>

        <div className="mt-10">
          {res.status === 'loading' ? (
            <Loading lines={3} />
          ) : res.status === 'error' ? (
            <ErrorState
              cause={res.error?.message ?? 'The notifications could not be read.'}
              moneyState="Nothing was read."
              next="Try loading the notifications again."
              retry={res.reload}
            />
          ) : notifications.length === 0 ? (
            <EmptyState seed="alerts-empty" fact="Nothing yet. No events have concerned this account." />
          ) : (
            <ul className="divide-y divide-ink-4 rounded-lg border border-ink-4 bg-ink-1">
              {notifications.map(n => (
                <li key={n.id} className={n.read ? '' : 'bg-ink-2'}>
                  <Link to={n.target} className="flex items-start gap-3 p-4 hover:bg-ink-2">
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center text-ink-8">
                      <Icon name={KIND_ICON[n.kind]} size={18} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-caption font-semibold uppercase tracking-wide text-ink-7">
                          {KIND_LABEL[n.kind]}
                        </span>
                        {!n.read && (
                          <span className="inline-flex items-center gap-1.5 text-caption font-semibold text-ink-10">
                            <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-mint" />
                            Unread
                          </span>
                        )}
                        <time
                          dateTime={new Date(n.createdAtMs).toISOString()}
                          className="font-mono text-caption tabular-nums text-ink-7"
                        >
                          {relativeTimeMs(n.createdAtMs)}
                        </time>
                      </span>
                      <span className={`mt-1 block text-body-sm ${n.read ? 'text-ink-8' : 'text-ink-10'}`}>
                        {n.text}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Shell>
  );
}