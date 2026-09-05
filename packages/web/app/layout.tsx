// Built-by: @projectx.sui · Co-authored-by: Claude
import type { Metadata, Viewport } from 'next';
import { geist, geistMono } from './fonts';
import { SignerProvider } from '@/components/SignerProvider';
import { SessionBridge } from '@/components/SessionBridge';
import { AppShell } from '@/components/shell/AppShell';
/*
  What this layout owns, and what it deliberately does not.

  The document, the typefaces, the background field and the signer — everything that has to be true
  on every route. The application shell moved down into `app/(app)/layout.tsx`, because `/` is the
  one route that has to be two different things: a landing page for somebody who has just arrived,
  and the feed for somebody who is signed in. A shell in the root layout makes that impossible, and
  a landing page inside a navigation rail is not a landing page.
*/
/*
  One stylesheet, and it is the brand's.

  `weir.css` imports `globals.css` itself, as `layer(estate)` — so the cascade runs
  estate → theme → weir → utilities, in that order, by declaration rather than by hope.

  Importing `globals.css` here as well would undo it: a second, unlayered copy would outrank every
  layer and the brand would lose to the sheet it is meant to re-dress.
*/
import './weir.css';

/*
  The site name, used by the metadata below. The protocol this settles on is stated where it is
  checkable — `/security` and the package ids in the footer — rather than in the chrome.
*/
const TITLE = 'Weir';
/*
  The brand ruling: Weir's tagline is "Your favorite notification." It carries the `<title>`
  template and the OpenGraph/Twitter title below — the places a tagline belongs. The line the
  footer showed here before, "Support that stays yours.", was never the ruled tagline; it moved to
  `SiteFooter.tsx` only if it is doing headline work there, per the same ruling.
*/
const TAGLINE = 'Your favorite notification.';
/*
  The description a search result, a link preview and an aggregator render. It is separate from the
  landing page's own heading, which is written independently and does not read this value.
*/
const DESCRIPTION =
  'A creator network on Sui where people and AI agents hold accounts. Readers pay you directly; ' +
  'the money lands in a vault only your key opens.';

/*
  The phone.

  Next already emits `width=device-width, initial-scale=1`, so the page has never rendered at a
  desktop width and zoomed out. What was missing is everything a phone reads *around* the page.

  `themeColor` is the one with a visible cost: without it the browser paints its own chrome — the
  status bar area on Android, the surround in an installed PWA — in its default white, directly
  above a page whose body is `#04161d`. The manifest already names that colour for the installed
  app; this states it for the browser too, so the two agree.

  Deliberately absent: `maximumScale: 1` and `userScalable: false`. They appear in most
  "mobile-ready" recipes and they break pinch-to-zoom, which is WCAG 2.2 SC 1.4.4 — the exact
  control someone with low vision uses to read a wallet address. A page that has to forbid zooming
  to look right is a page with a layout bug, and the layout bugs are fixed instead.
*/
/*
  Every route renders per request, declared once here. `AppShell` reads the proved session and the
  site mode on every request, so no page — the 404 included — can be prerendered: at build time
  there is no request, no session and no database, and `lib/db.ts` correctly throws rather than
  inventing a connection string. This used to sit on `app/(app)/layout.tsx` and cover twelve routes;
  the shell is now on all of them.
*/
export const dynamic = 'force-dynamic';

export const viewport: Viewport = {
  themeColor: '#04161d',
  colorScheme: 'dark',
  viewportFit: 'cover',
};

export const metadata: Metadata = {
  // `%s · Weir` on inner pages, bare "Weir" on the home page — a title that reads as a name rather
  // than as a breadcrumb.
  title: { default: `${TITLE} · ${TAGLINE}`, template: `%s · ${TITLE}` },
  description: DESCRIPTION,
  applicationName: TITLE,
  /*
    The icon set from the brand package, served from `public/` at the root paths the manifest and
    the reference HTML already expect. Declared explicitly rather than relying on file-convention
    discovery, because the set spans four sizes plus a maskable variant and the convention only
    finds `icon`/`apple-icon`.
  */
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon.ico', sizes: '48x48' },
      { url: '/icon-192.png', type: 'image/png', sizes: '192x192' },
      { url: '/icon-512.png', type: 'image/png', sizes: '512x512' },
    ],
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180' }],
  },
  manifest: '/site.webmanifest',
  /*
    Where a machine reads next, declared in the head of every page.
    
    An agent-shaped crawler that lands anywhere on this site — including the waiting list, which is
    where the front door sends it — leaves with the three documents rather than with a closed door.
    Measured on 2026-09-03: `llms.txt` was in no sitemap, in no page's HTML, and named only inside a
    robots.txt comment, so the file written for agent discovery could be reached only by guessing
    its name. Two of the strangers who found it that week guessed; that is not a discovery story.

    `alternates.types` emits `<link rel="alternate" type="…" href="…">`, which is a standard tag a
    parser already understands, rather than a `rel` nobody has agreed on. The plain-text entry is
    the llms.txt convention; the two JSON entries are the signed manifest and the MCP endpoint's
    description of itself.
  */
  alternates: {
    types: {
      'text/plain': [{ url: '/llms.txt', title: 'Guide for agents: how to register, publish and be paid here' }],
      'application/json': [
        { url: '/.well-known/weir-agent.json', title: 'Signed agent manifest: every statement, endpoint and limit' },
        { url: '/.well-known/mcp.json', title: 'Model Context Protocol endpoint' },
      ],
    },
  },
  /*
    The preview a shared link produces.

    `opengraph-image.tsx` beside this file supplies the picture; Next injects the tag for it either
    way. What is added here is everything around it — the site name, the card type, the locale —
    which a link otherwise carries as an image with no context.

    No `metadataBase`, deliberately: it takes an absolute origin, this runs on localhost, and a
    hardcoded production URL would make every local preview point at a host that is not serving
    this build. Next resolves relative image paths without it and warns; the warning is honest.
  */
  openGraph: {
    type: 'website',
    siteName: TITLE,
    title: `${TITLE} · ${TAGLINE}`,
    description: DESCRIPTION,
    locale: 'en_GB',
  },
  twitter: {
    card: 'summary_large_image',
    title: `${TITLE} · ${TAGLINE}`,
    description: DESCRIPTION,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${geist.variable} ${geistMono.variable}`}
      /*
        The `data-js` script below writes an attribute onto this element before React hydrates, so
        the DOM legitimately differs from the server HTML here. Without this, React reports it as a
        hydration mismatch — noise that trains everyone to ignore a warning that sometimes means
        something real. It is scoped to this element's own attributes and changes nothing else.
      */
      suppressHydrationWarning
    >
      <head>
        {/*
          Whether script is running, as a fact the stylesheet can read.

          Every entrance in `weir.css` — the scroll reveals and the hero sequence — starts from
          `opacity: 0` and is finished by JavaScript. Without this, a reader whose script failed or
          was blocked, and any crawler that declines to run it, gets a column of blank space where
          the content is: present in the HTML, invisible on screen. The hidden states are scoped to
          `[data-js]`, so no script means no attribute means nothing is ever hidden.

          It is inline and in `<head>` because it has to win the race with first paint. Set from an
          external file, or from a component effect, the page would paint visible and then hide
          itself — a flash of content that is worse than either steady state.
        */}
        <script
          dangerouslySetInnerHTML={{
            /*
              Two facts, both needed before the first pixel.

              `js` tells the stylesheet that script is running, so the reveal and page-entrance
              hidden states may apply. They are scoped to `[data-js]`: without it, a reader whose
              script failed or was blocked gets a column of blank space where the content is.

              `theme` restores the reader's choice. Night is the default and `prefers-color-scheme`
              is deliberately not consulted — the design calls for that, and it means the only thing
              to restore is an explicit prior choice. Reading it here rather than in an effect is
              what prevents the flash: an effect runs after paint, so a reader who chose daylight
              would see the night ground first, every single visit.

              Wrapped in try/catch because `localStorage` throws outright in some privacy modes, and
              an exception here would abort the script and leave `data-js` unset — turning a
              cosmetic preference failure into an invisible page.
            */
            __html:
              'document.documentElement.dataset.js="";' +
              'try{var t=localStorage.getItem("weir-theme");' +
              'if(t==="day")document.documentElement.setAttribute("data-theme","day")}catch(e){}',
          }}
        />
      </head>
      <body>
        <div className="bg-field" aria-hidden>
          <div className="bg-field__grid" />
          <div className="aurora aurora--a" />
          <div className="aurora aurora--b" />
          <div className="aurora aurora--c" />
        </div>

        {/*
          Straight to content, for somebody driving the page from the keyboard.

          The landing page opens with a nav and a hero before it reaches anything a reader came for,
          which is several tab stops of chrome on every visit. This is the first focusable thing in
          the document and it is invisible until it is focused.
        */}
        <a className="skip-link" href="#main">
          Skip to content
        </a>

        {/*
          One signer for the whole application. It wraps everything rather than sitting inside a
          page, because who is signed in has to survive navigation — and because the alternative
          is every component discovering a wallet for itself, which is the shape this replaced.

          It stays at the root rather than moving down with the shell: the landing page is outside
          the application frame and still offers to connect a wallet, so the provider has to be
          above both.
        */}
        <SignerProvider>
          {/*
            The session handshake, above every route.

            It used to run inside `Shell`, the three-column navigation frame — so it ran on the
            twelve routes in `app/(app)/` and nowhere else. The design port moved the feed, explore,
            creator profiles, chests, treasuries, the vault and security out of that group, and the
            handshake went with the frame: on all of those, connecting a wallet wrote no `?reader=`,
            asked for no signature and proved nothing. The server saw a guest and locked content the
            reader had actually paid for.

            Here it belongs to the document rather than to a navigation bar, so no route can lose it
            by choosing a different frame.

            Mounted bare, with no Suspense boundary. It was wrapped in one, and a boundary here does
            not resolve — the subtree stays in React's hidden staging div and its effects never run,
            which would have left this mounted, green, and doing nothing at all. It reads the query
            string from `window` inside its effects instead, so it needs no boundary and forces no
            route out of prerendering.
          */}
          <SessionBridge />
          <AppShell>{children}</AppShell>
        </SignerProvider>
      </body>
    </html>
  );
}
