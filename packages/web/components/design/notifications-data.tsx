// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import { fold } from '@projectx-social/sdk';
import { readNotifications } from '@/lib/notifications';
import { formatUnits } from '@/lib/units';
import { Icon } from '@/components/design/icons';
import { DesignNotifications, type DesignNotification } from '@/components/design/Notifications';

/**
 * Notifications, from the chain and the store.
 *
 * A failed read renders as "not measured" rather than as an empty page. An empty page says nothing
 * has happened to you, which is a different claim and one we cannot make.
 */

const CREST = 'var(--crest,#8be3c6)';
const SAND = 'var(--sand,#d9c9a3)';
const TEAL = 'var(--teal,#7fd8dd)';
const ALERT = 'var(--alert,#f2a29b)';

function ago(atMs: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - atMs) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function shortAddress(address: string): string {
  return address.length <= 12 ? address : `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export async function NotificationsData({
  viewer,
  myHandle,
  bare = false,
}: {
  /** A proved address, or null. A failed session read passes null too — that is the locked direction. */
  viewer: string | null;
  myHandle: string | null;
  /** Render inside the dashboard frame, which supplies the chrome and the heading. */
  bare?: boolean;
}) {
  if (viewer === null) {
    return <DesignNotifications signedIn={false} myHandle={null} notifications={[]} bare={bare} />;
  }

  const reading = await readNotifications(viewer);
  const feed = fold(
    reading,
    (value) => value,
    () => null,
  );

  const items: DesignNotification[] = [];

  if (feed !== null) {
    for (const payment of feed.payments) {
      /*
        An amount appears only when its coin's decimals were read. Without them the figure is
        meaningless — a nine-decimal coin printed at six decimals is a thousand times wrong — so the
        row says what happened and omits the number rather than inventing a scale.
      */
      const amount =
        payment.decimals === null
          ? ''
          : ` · ${formatUnits(BigInt(payment.creatorNet), payment.decimals)}${
              payment.symbol === '' ? '' : ` ${payment.symbol}`
            }`;
      items.push({
        icon: <Icon name="coin" size={15} color={CREST} />,
        markColor: CREST,
        text: `${payment.what} from ${shortAddress(payment.payer)}`,
        meta: `checkpoint ${payment.checkpoint.toString()}${amount}`,
      });
    }

    for (const event of feed.activity) {
      if (event.kind === 'comment') {
        items.push({
          icon: <Icon name="doc" size={15} color={TEAL} />,
          markColor: TEAL,
          text: `${shortAddress(event.author)} commented`,
          meta: `${ago(event.at)} · ${event.text.slice(0, 60)}`,
        });
      } else if (event.kind === 'follow') {
        items.push({
          icon: <Icon name="users" size={15} color={TEAL} />,
          markColor: TEAL,
          text: `${shortAddress(event.follower)} followed @${event.handle}`,
          meta: ago(event.at),
        });
      } else {
        items.push({
          icon: <Icon name="key" size={15} color={SAND} />,
          markColor: SAND,
          // An encrypted thread has no preview, and saying so beats showing ciphertext.
          text: `Message from ${shortAddress(event.from)}`,
          meta: event.encrypted
            ? `${ago(event.at)} · encrypted`
            : `${ago(event.at)} · ${event.preview}`,
        });
      }
    }
  }

  /*
    Two different empties, told apart. A failed read is not "nothing happened" — presenting it that
    way is the quiet lie this codebase exists not to tell.
  */
  if (feed === null) {
    items.push({
      icon: <Icon name="warn" size={15} color={ALERT} />,
      markColor: ALERT,
      text: 'Not measured',
      meta: reading.ok ? '' : `${reading.failure.kind} — your activity could not be read`,
    });
  } else if (feed.truncated) {
    items.push({
      icon: <Icon name="warn" size={15} color={SAND} />,
      markColor: SAND,
      text: 'Older activity not walked',
      meta: 'The event ceiling stopped the walk — these are recent, not complete.',
    });
  }

  return <DesignNotifications signedIn myHandle={myHandle} notifications={items} />;
}
