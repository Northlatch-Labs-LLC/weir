// Built-by: @projectx.sui · Co-authored-by: Claude
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
 * through, because it renders the same frame with a discovery rail this layout cannot fill; every
 * other route is wrapped here. Same rail, same mark, same footer, same wallet control, everywhere.
 *
 * # Who the frame thinks you are
 *
 * The rail opens on a *proved* session. `?reader=` in a URL is a claim anybody can type, and chrome
 * that says "your account" because somebody edited the address bar is chrome that lies. A failed
 * session read draws the signed-out frame, which leaks nothing — every page resolves its own
 * entitlement regardless of what the frame drew.
 */
import { headers } from 'next/headers';
import { PATHNAME_HEADER } from '@/proxy';
import { fold } from '@projectx-social/sdk';
import { Reveals } from '@/components/design/Reveals';
import { AppFrame } from '@/components/app/AppFrame';
import { accountHandle } from '@/lib/accounts';
import { provenReader } from '@/lib/read-session';

/*
  Routes whose page renders `AppFrame` itself.

  Exact, not prefixed, and that distinction is the bug this list previously had: `/agents` was
  matched as a prefix, so `/agents/build` and `/agents/declare` counted as framed, were handed
  through, and rendered with no navigation at all. Sub-routes are framed here unless they are
  listed here themselves.
*/
const FRAMED_EXACT: readonly string[] = [
  '/',
  '/feed',
  '/explore',
  '/creators',
  '/agents',
  '/alerts',
  '/messages',
  '/studio',
  '/vault',
];

/* Handle and post pages: every path beneath these roots is a framed screen. */
const FRAMED_ROOTS: readonly string[] = ['/c/', '/p/'];

export function carriesItsOwnFrame(pathname: string | null): boolean {
  if (pathname === null) return false;
  if (FRAMED_EXACT.includes(pathname)) return true;
  return FRAMED_ROOTS.some((root) => pathname.startsWith(root));
}

/**
 * The path this render is for, or `null` when there is no request to ask.
 *
 * `headers()` THROWS outside a request — a test renderer, a build-time evaluation — rather than
 * answering empty. A throw means nobody set the header, and the honest answer to "does this route
 * build its own frame" is then "assume not", which wraps it. That is the safe direction now: an
 * extra frame is visible and fixable, a missing one leaves a page with no way out of itself.
 */
async function currentPath(): Promise<string | null> {
  try {
    return (await headers()).get(PATHNAME_HEADER);
  } catch {
    return null;
  }
}

export async function AppShell({ children }: { children: React.ReactNode }) {
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

  return (
    <>
      {/* The scroll entrance the older pages run. Without it a `data-reveal` section stays at
          opacity 0 — invisible, not merely unanimated. It stays until those sections are gone. */}
      <Reveals />
      <AppFrame
        viewer={
          viewer === null
            ? { signedIn: false }
            : { signedIn: true, address: viewer, handle: myHandle, displayName: myHandle }
        }
      >
        {/* A gutter for pages written before the column existed. See `.w-legacy`. */}
        <div className="w-legacy">{children}</div>
      </AppFrame>
    </>
  );
}
