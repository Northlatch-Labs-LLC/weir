// Built-by: @projectx.sui · Co-authored-by: Claude
import { AdminPanel } from '@/components/AdminPanel';
import { WaitlistInsightPanel } from '@/components/WaitlistInsight';
import { SiteModeSwitch } from '@/components/SiteModeSwitch';
import { AccessCodesPanel } from '@/components/AccessCodesPanel';
import { listAccessCodes } from '@/lib/access-codes';
import { readSiteMode } from '@/lib/site-mode';
import { isSiteAdmin } from '@/lib/site-admin';
import { readWaitlistInsight } from '@/lib/waitlist-admin';
import { provenReader } from '@/lib/read-session';
import { fold } from '@projectx-social/sdk';
import { PageHead } from '@/components/design/PageHead';

export const dynamic = 'force-dynamic';

export const metadata = {
  // The root layout's template appends "· Weir".
  title: 'Platform',
};

export default async function AdminPage() {
  /*
    Two different authorities on one page, and the page says which is which.

    `SiteModeSwitch` is shown only to the holder of this package's `Publisher` — the website's own
    administrator. `AdminPanel` below is the protocol's, gated on `PlatformCap`, and it renders
    read-only for everyone who does not hold that. Neither implies the other, deliberately.
  */
  const viewer = fold(
    await provenReader(),
    (value) => value,
    () => null,
  );
  const [siteAdmin, mode] = await Promise.all([isSiteAdmin(viewer), readSiteMode()]);

  /*
    Read only for the administrator, and only after the capability has been resolved.

    Sequenced rather than folded into the `Promise.all` above on purpose: the list must not be
    queried at all for somebody who turns out not to hold the `Publisher`. Fetching it in parallel
    and discarding it would mean every visitor to this URL causes the signup table to be read, which
    is a different posture from the one the panel claims.
  */
  const [insight, codes] = siteAdmin
    ? await Promise.all([
        readWaitlistInsight(),
        listAccessCodes().then(
          (list) => list,
          (error: unknown) => {
            console.error('accessCodesListFailed', error);
            return null;
          },
        ),
      ])
    : [null, null];

  return (
    <>
      {/* Chrome from `AppFrame`; `PageHead` restores the `h1` the retired title bar used to supply. */}
      <PageHead
        kicker="Platform"
        title="The live terms, and who is allowed to"
        accent="change them."
        lede="Read from the shared object on chain. Administering it means holding the PlatformCap — every function that changes anything below takes it by reference, so the contract refuses anyone else regardless of what this page shows."
      />
      {siteAdmin && <SiteModeSwitch initial={mode} />}
      {siteAdmin && <AccessCodesPanel initial={codes} />}
      {siteAdmin && <WaitlistInsightPanel insight={insight} />}

      <AdminPanel />
    </>
  );
}
