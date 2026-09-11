// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
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
  title: 'Platform',
};

export default async function AdminPage() {
  const viewer = fold(
    await provenReader(),
    (value) => value,
    () => null,
  );
  const [siteAdmin, mode] = await Promise.all([isSiteAdmin(viewer), readSiteMode()]);

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
        title="Admin"
        lede="Read from the shared object on chain. Administering it means holding the PlatformCap — every function that changes anything below takes it by reference, so the contract refuses anyone else regardless of what this page shows."
      />
      {siteAdmin && <SiteModeSwitch initial={mode} />}
      {siteAdmin && <AccessCodesPanel initial={codes} />}
      {siteAdmin && <WaitlistInsightPanel insight={insight} />}

      <AdminPanel />
    </>
  );
}
