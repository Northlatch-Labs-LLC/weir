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
        <script
          dangerouslySetInnerHTML={{
            __html:
              'document.documentElement.dataset.js="";' +
              'try{var t=localStorage.getItem("weir-theme");' +
              'if(t==="day")document.documentElement.setAttribute("data-theme","day")}catch(e){}',
          }}
        />
        <JsonLd data={organizationJsonLd()} />
        <JsonLd data={websiteJsonLd()} />
      </head>
      <body>

        <SignerProvider
          network={fold(siteConfig(), (config) => config.network as string, () => null)}
          rpcUrl={fold(siteConfig(), (config) => config.grpcUrl, () => null)}
        >
          <SessionBridge />
          <AppShell>{children}</AppShell>
                  </SignerProvider>
      </body>
    </html>
  );
}
