// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import type { Metadata, Viewport } from 'next';
import { geist, geistMono, inter, jetbrainsMono, sourceSerif } from './fonts';
import { fold } from '@projectx-social/sdk';
import { siteConfig } from '@/lib/chain';
import { SignerProvider } from '@/components/SignerProvider';
import { SessionBridge } from '@/components/SessionBridge';
import { AppShell } from '@/components/shell/AppShell';
import { JsonLd } from '@/components/seo/JsonLd';
import { organizationJsonLd, websiteJsonLd } from '@/lib/structured-data';
import { TITLE, TAGLINE, DESCRIPTION } from '@/lib/site-meta';
import './weir.css';
import '@projectx-social/ui/weir-ui.css';

export const dynamic = 'force-dynamic';

export const viewport: Viewport = {
  themeColor: '#03050a',
  colorScheme: 'dark',
  viewportFit: 'cover',
};

export const metadata: Metadata = {
  title: { default: `${TITLE} · ${TAGLINE}`, template: `%s · ${TITLE}` },
  description: DESCRIPTION,
  applicationName: TITLE,
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
  alternates: {
    types: {
      'text/plain': [{ url: '/llms.txt', title: 'Guide for agents: how to register, publish and be paid here' }],
      'application/json': [
        { url: '/.well-known/weir-agent.json', title: 'Signed agent manifest: every statement, endpoint and limit' },
        { url: '/.well-known/mcp.json', title: 'Model Context Protocol endpoint' },
      ],
    },
  },
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
      className={`${geist.variable} ${geistMono.variable} ${inter.variable} ${sourceSerif.variable} ${jetbrainsMono.variable}`}
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
            __html:
              'document.documentElement.dataset.js="";' +
              'try{var t=localStorage.getItem("weir-theme");' +
              'if(t==="day")document.documentElement.setAttribute("data-theme","day")}catch(e){}',
          }}
        />
        {/*
          The two facts about the site that are true on every page: who runs it, and what it is.
          `lib/structured-data.ts` explains what each field is sourced from and what was left out
          rather than guessed.
        */}
        <JsonLd data={organizationJsonLd()} />
        <JsonLd data={websiteJsonLd()} />
      </head>
      <body>
        {/*
          The atmospheric background is gone.

          A ruled field and three coloured aurora blobs were painted under every page — the editorial
          website's weather, still showing through the application that replaced it. It was also the
          widest thing in the document: the blobs are positioned past the right edge, so every page
          scrolled sideways by about 450px whatever was on it.

          The application's ground is flat. `--w-ground` is the colour and `.w-app` paints it.
        */}

        {/*
          The skip link moved into the frame.

          It has to point at the element the content is actually in, and that is now `#w-main` in
          `packages/ui`'s shell on every route. Left here it named `#main`, which no route renders
          any more — a skip link to nothing is worse than none, because it is the first thing a
          keyboard reader reaches and it silently does nothing.
        */}

        {/*
          One signer for the whole application. It wraps everything rather than sitting inside a
          page, because who is signed in has to survive navigation — and because the alternative
          is every component discovering a wallet for itself, which is the shape this replaced.

          It stays at the root rather than moving down with the shell: the landing page is outside
          the application frame and still offers to connect a wallet, so the provider has to be
          above both.
        */}
        {/*
          The network is read here and handed down, rather than assumed in the wallet layer.

          A wallet is asked to sign for `sui:<network>`. This deployment's network is configuration,
          and a default in the browser would be a signature requested against a chain nobody chose.
        */}
        <SignerProvider
          network={fold(siteConfig(), (config) => config.network as string, () => null)}
          rpcUrl={fold(siteConfig(), (config) => config.grpcUrl, () => null)}
        >
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
