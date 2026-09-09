// Built-by: @projectx.sui · Co-authored-by: Claude
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
import { headers } from 'next/headers';
import { PATHNAME_HEADER } from '@/proxy';
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

/*
  Routes that already carry their own frame.

  A rebuilt screen renders `components/app/AppFrame` — rail, column, discovery, bottom bar — and
  wrapping it in this shell as well puts two headers, two navigations and two footers on one page.
  Two navigations is not a cosmetic defect: it is two different answers to "where am I".

  This list GROWS as the rebuild proceeds and the shell shrinks to nothing. When every route is on
  it, this gate and the header in `proxy.ts` are both deleted, which is the intended end.

  Matched as a prefix, so `/c/wren` and `/p/abc` are covered by their roots. `/` is matched exactly
  because a prefix of "/" is every path there is.
*/
const PORTED_PREFIXES = ['/feed', '/c/', '/p/', '/vault', '/explore', '/creators', '/agents', '/alerts', '/messages', '/studio'] as const;

function carriesItsOwnFrame(pathname: string | null): boolean {
  if (pathname === null) return false;
  if (pathname === '/') return true;
  return PORTED_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(prefix));
}

/**
 * The path this render is for, or `null` when there is no request to ask.
 *
 * `headers()` THROWS outside a request — a test renderer, a build-time evaluation — rather than
 * answering empty, so this cannot be a plain read. A throw is not an error here: it means nobody
 * set the header, and the honest answer to "does this route carry its own frame" is then "assume
 * not", which draws the legacy chrome. That is the safe direction. A page with too much chrome is
 * ugly; a page with none has no way out of itself.
 */
async function currentPath(): Promise<string | null> {
  try {
    return (await headers()).get(PATHNAME_HEADER);
  } catch {
    return null;
  }
}

export async function AppShell({ children }: { children: React.ReactNode }) {
  /*
    Which path this is, from the header `proxy.ts` set. A layout is rendered above the page and
    Next hands it no pathname, so this is the only place the answer exists.

    A missing header means the middleware did not run — a build step, a test renderer, an unusual
    deployment — and the honest answer to "does this route have its own frame" is then "assume not",
    which draws the legacy chrome. That is the safe direction: a page with too much chrome is ugly,
    a page with none has no way out of itself.
  */
  const pathname = await currentPath();
  if (carriesItsOwnFrame(pathname)) return <>{children}</>;

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
