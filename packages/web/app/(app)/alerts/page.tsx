// Built-by: @projectx.sui · Co-authored-by: Claude
import type { Metadata } from 'next';
import { titleFor } from '@/lib/site-map';
import { fold } from '@projectx-social/sdk';
import { accountHandle } from '@/lib/accounts';
import { provenReader } from '@/lib/read-session';
import { readNotifications } from '@/lib/notifications';
import { formatUnits } from '@/lib/units';
import { AlertsScreen, type AlertView } from '@/components/app/AlertsScreen';
import { Discovery } from '@/components/shell/Discovery';

/**
 * `/alerts` — what happened while you were away.
 *
 * # Every read this route makes lives here
 *
 * The session, the handle and the notification feed. `AlertsScreen` is handed rows that are already
 * words, so nothing about scale, ordering or entitlement can be decided by a component that is only
 * supposed to draw.
 *
 * # The three outcomes are kept apart
 *
 * No session is the locked direction and renders as a prompt to sign in. A feed that could not be
 * read renders as a refusal. A feed that was read and is empty renders as empty. Only the third of
 * those means nothing has happened to you.
 */
export const metadata: Metadata = { title: titleFor('/alerts') };

export const dynamic = 'force-dynamic';

function shortAddress(address: string): string {
  return address.length <= 12 ? address : `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/** Compact relative time, for events the store actually timestamped. */
function ago(nowMs: number, atMs: number): string {
  const seconds = Math.max(0, Math.round((nowMs - atMs) / 1000));
  if (seconds < 60) return 'now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

/** Each payment kind gets the icon that names what it was, and all of them are money. */
function paymentIcon(what: string): AlertView['icon'] {
  if (what === 'unlock') return 'lock';
  if (what === 'tip') return 'support';
  if (what === 'subscription' || what === 'renewal') return 'bolt';
  return 'support';
}

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ reader?: string }>;
}) {
  const { reader } = await searchParams;

  const viewer = fold(
    await provenReader(),
    (value) => value,
    () => null,
  );

  if (viewer === null) {
    return (
      <AlertsScreen
        discovery={<Discovery />}
        viewerAddress={null}
        viewerHandle={null}
        {...(reader === undefined ? {} : { reader })}
        alerts={[]}
        truncated={false}
      />
    );
  }

  const handle = fold(
    await accountHandle(viewer),
    (value) => value,
    () => null,
  );

  const reading = await readNotifications(viewer);
  if (!reading.ok) {
    return (
      <AlertsScreen
        discovery={<Discovery />}
        viewerAddress={viewer}
        viewerHandle={handle}
        {...(reader === undefined ? {} : { reader })}
        alerts={[]}
        truncated={false}
        failure={`${reading.failure.kind}: ${reading.failure.detail}`}
      />
    );
  }

  const feed = reading.value;
  const now = Date.now();
  const alerts: AlertView[] = [];

  for (const [index, payment] of feed.payments.entries()) {
    /*
      An amount appears only when its coin's decimals were read. Without them the figure is
      meaningless — a nine-decimal coin printed at six decimals is a thousand times wrong — so the
      row says what happened and omits the number rather than inventing a scale.
    */
    const amount =
      payment.decimals === null
        ? null
        : `${formatUnits(BigInt(payment.creatorNet), payment.decimals)}${
            payment.symbol === '' ? '' : ` ${payment.symbol}`
          }`;

    alerts.push({
      id: `payment-${payment.digest}-${index}`,
      tone: 'money',
      icon: paymentIcon(payment.what),
      text: `${payment.what} from ${shortAddress(payment.payer)}`,
      detail:
        amount === null
          ? `checkpoint ${payment.checkpoint.toString()}`
          : `${amount} settled · checkpoint ${payment.checkpoint.toString()}`,
      // Payments carry no clock. See `PaymentNotification` in lib/notifications.ts.
    });
  }

  for (const [index, event] of feed.activity.entries()) {
    if (event.kind === 'comment') {
      alerts.push({
        id: `comment-${event.postId}-${index}`,
        tone: 'plain',
        icon: 'comment',
        text: `${shortAddress(event.author)} commented`,
        detail: event.text.slice(0, 80),
        when: ago(now, event.at),
      });
    } else if (event.kind === 'follow') {
      alerts.push({
        id: `follow-${event.follower}-${index}`,
        tone: 'plain',
        icon: 'creators',
        text: `${shortAddress(event.follower)} followed @${event.handle}`,
        when: ago(now, event.at),
      });
    } else {
      alerts.push({
        id: `message-${event.from}-${index}`,
        tone: 'plain',
        icon: 'messages',
        // An encrypted thread has no preview, and saying so beats showing ciphertext.
        text: `Message from ${shortAddress(event.from)}`,
        detail: event.encrypted ? 'encrypted' : event.preview,
        when: ago(now, event.at),
      });
    }
  }

  return (
    <AlertsScreen
      discovery={<Discovery />}
      viewerAddress={viewer}
      viewerHandle={handle}
      {...(reader === undefined ? {} : { reader })}
      alerts={alerts}
      truncated={feed.truncated}
    />
  );
}
