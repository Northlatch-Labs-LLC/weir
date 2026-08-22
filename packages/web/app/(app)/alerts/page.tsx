// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import type { Metadata } from 'next';
import { titleFor } from '@/lib/site-map';
import { fold } from '@projectx-social/sdk';
import { accountHandle } from '@/lib/accounts';
import { provenReader } from '@/lib/read-session';
import { NotificationsData } from '@/components/design/notifications-data';
import { PageHead } from '@/components/design/PageHead';
import { AccountTabs } from '@/components/shell/AccountTabs';

/**
 * `/alerts` — session-gated, in the locked direction.
 *
 * # Why this route moved into the application group
 *
 * Inside `(app)` the frame supplies the chrome, so `NotificationsData` is rendered `bare` and the
 * heading comes from `PageHead` like every other page in the group. A guest still gets the guest
 * frame and the locked state, which is the same answer as before.
 */
export const metadata: Metadata = { title: titleFor('/alerts') };

export const dynamic = 'force-dynamic';

export default async function NotificationsPage() {
  const viewer = fold(
    await provenReader(),
    (value) => value,
    () => null,
  );
  const handle =
    viewer === null
      ? null
      : fold(
          await accountHandle(viewer),
          (value) => value,
          () => null,
        );

  return (
    <>
      <PageHead
        kicker="Your account"
        title="What happened"
        accent="while you were away."
        lede="Payments, unlocks and new supporters — read from what settled to your address on chain, newest first."
      />
      <AccountTabs />
      <NotificationsData viewer={viewer} myHandle={handle} bare />
    </>
  );
}
