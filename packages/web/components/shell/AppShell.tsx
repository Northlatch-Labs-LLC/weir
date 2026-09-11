// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
/**
 * The one frame, in the root layout.
 *
 * # There is only one now
 *
 * There used to be two: a set of screens rebuilt on `packages/ui` that drew their own rail, column
 * and bottom bar, and everything else wearing an older header, logo, footer, mobile bar and
 * breadcrumb trail. Ten routes had the first, thirty-one had the second, and the difference was
 * visible to anybody who clicked from the feed to `/signin`. Two navigations is not a cosmetic
 * defect: it is two answers to "where am I", and it is why this looked like two products stitched
 * together.
 *
 * So the old chrome is not conditional any more — it is gone. Every route gets the application
 * frame. A screen that already builds its own (`components/app/*Screen`) is handed straight
 * through; every other route is wrapped. Same rail, same mark, same footer, same wallet control.
 *
 * # What this file does, and what `ChromeRouter` does
 *
 * This half reads: the proved session, and the discovery rail. Both are server work and neither
 * varies by route, so both are done once here.
 *
 * WHICH chrome to draw is decided in `ChromeRouter`, on the client, from `usePathname()`. That is
 * not a preference. This is the root layout, and the App Router renders a root layout once and
 * reuses it for every client-side navigation beneath it — so a decision made here is a decision
 * made on the first paint of the session and never revisited. It was made here, from a pathname
 * header, and the result was measurable: clicking "Explore" from `/security` left the public header
 * on screen and drew the application rail inside it — two `<main>` elements and two footers on one
 * page — while clicking "Security" from `/explore` produced a page with no chrome at all.
 *
 * # Who the frame thinks you are
 *
 * The rail opens on a *proved* session. `?reader=` in a URL is a claim anybody can type, and chrome
 * that says "your account" because somebody edited the address bar is chrome that lies. A failed
 * session read draws the signed-out frame, which leaks nothing — every page resolves its own
 * entitlement regardless of what the frame drew.
 */
import { fold } from '@projectx-social/sdk';
import { Reveals } from '@/components/design/Reveals';
import { Discovery } from '@/components/shell/Discovery';
import { ChromeRouter } from '@/components/shell/ChromeRouter';
import { accountHandle } from '@/lib/accounts';
import { provenReader } from '@/lib/read-session';

export { isPublicPage, carriesItsOwnFrame, normalisePath } from '@/components/shell/ChromeRouter';

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

  return (
    <>
      {/* The scroll entrance the older pages run. Without it a `data-reveal` section stays at
          opacity 0 — invisible, not merely unanimated. It stays until those sections are gone. */}
      <Reveals />
      <ChromeRouter
        viewer={
          viewer === null
            ? { signedIn: false }
            : { signedIn: true, address: viewer, handle: myHandle, displayName: myHandle }
        }
        /*
          The discovery column, on every wrapped route.

          Without it these pages rendered a 640px column with 372px of empty ground beside it — a
          third of a wide screen, blank, on twenty-three routes. A rebuilt screen passes its own
          `aside` built from what it read; everything else gets this one.
        */
        discovery={<Discovery />}
      >
        {children}
      </ChromeRouter>
    </>
  );
}
