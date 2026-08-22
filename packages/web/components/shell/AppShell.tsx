// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
/**
 * The shell every route wears.
 *
 * # One shell, in the root layout
 *
 * # Member and guest
 *
 * Same chrome, one difference: a member gets the dashboard — the menu rail on the left, the page
 * in the middle, a discovery rail on the right, the two rails pinned under the header and
 * scrolling on their own. It lists what their account holds and, for a
 * creator, the studio — destinations reachable from nowhere else. A guest gets the same header, the
 * same trail and a single column, on every route, including the ones that are legitimately theirs
 * (`/join`, `/signin`, a creator's page, a vault's page).
 *
 * The rail opens on a *proved* session. `?reader=` in a URL is a claim anybody can type; a
 * dashboard that appears because somebody edited the address bar is chrome that lies about who you
 * are. A failed session read renders the guest shell, which leaks nothing — every page still
 * resolves its own entitlement regardless of what the frame drew.
 */
import { Suspense } from 'react';
import { fold } from '@projectx-social/sdk';
import { AppNav } from '@/components/design/AppNav';
import { Reveals } from '@/components/design/Reveals';
import { Breadcrumbs } from '@/components/shell/Breadcrumbs';
import { MobileBar } from '@/components/shell/MobileBar';
import { RightRail } from '@/components/shell/RightRail';
import { SiteFooter } from '@/components/shell/SiteFooter';
import { SiteHeader } from '@/components/shell/SiteHeader';
import { accountHandle } from '@/lib/accounts';
import { provenReader } from '@/lib/read-session';
import { readSiteMode } from '@/lib/site-mode';
import { Loading } from '@/components/ui/primitives';

export async function AppShell({ children }: { children: React.ReactNode }) {
  const viewer = fold(
    await provenReader(),
    (value) => value,
    () => null,
  );
  const myHandle =
    viewer === null
      ? null
      : fold(
          await accountHandle(viewer),
          (value) => value,
          () => null,
        );
  const signedIn = viewer !== null;
  /*
    Whether the front door is shut, so the header can say so. Enforcement is `proxy.ts`; this is
    only what the chrome shows.
  */
  const { waitlistMode } = await readSiteMode();

  return (
    <>
      <SiteHeader signedIn={signedIn} myHandle={myHandle} gated={waitlistMode} />
      {/* The scroll entrance the design runs. Without it a `data-reveal` section stays at opacity 0. */}
      <Reveals />
      <div className="weir-shell" data-member={signedIn ? '' : undefined}>
        {/*
          No Suspense boundary around the rail, deliberately. `AppNav` reads `useSearchParams`; every
          route is dynamic (the session is read on each request) so there is no prerender to protect,
          and a boundary here has been measured to never resolve — the rail streamed into React's
          hidden staging div and stayed there. See the git history of `AppFrame` for the measurement.
        */}
        {signedIn && <AppNav />}
        <div className="weir-shell__col">
          <Breadcrumbs />
          {/* `#main` is the target of the skip link in the root layout. */}
          <main id="main" className="weir-shell__main">
            {children}
          </main>
        </div>
        {/*
          The third rail, members only. Streamed behind a boundary so the page's own content paints
          with the first byte; this column reads the store and can arrive a moment later.
        */}
        {signedIn && (
          <aside className="weir-shell__rail" aria-label="Discover">
            <Suspense fallback={<Loading what="Reading creators…" />}>
              <RightRail />
            </Suspense>
          </aside>
        )}
      </div>
      <SiteFooter gated={waitlistMode} />
      <MobileBar signedIn={signedIn} myHandle={myHandle} gated={waitlistMode} />
    </>
  );
}
