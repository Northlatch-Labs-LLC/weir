// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { ImageResponse } from 'next/og';

import { readSiteMode } from '@/lib/site-mode';
import { SHARE_CARD_ALT, shareCardCopy } from '@/lib/share-card';

export const alt = SHARE_CARD_ALT;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/*
  Revalidated rather than rendered per request. The card reads the site's mode, so it cannot be
  frozen at build time — but it also must not become an unauthenticated endpoint that spends a few
  hundred milliseconds of CPU on every hit. Rendered at build, then refreshed at most this often,
  it costs a crawler nothing and gives an attacker nothing to spend.

  The build reads the same site_mode row production serves, so the first render after a deploy is
  already the right one; flipping the mode in the admin reaches the card within this window.
*/
export const revalidate = 300;

export function ShareCard({ copy }: { copy: ReturnType<typeof shareCardCopy> }) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: '#051a21',
        backgroundImage:
          'radial-gradient(ellipse 80% 70% at 50% 115%, rgba(20,84,88,0.55), transparent 70%),' +
          'radial-gradient(ellipse 60% 50% at 88% 0%, rgba(28,60,66,0.6), transparent 70%)',
        color: '#e8f1f2',
        fontFamily: 'sans-serif',
        padding: 72,
        justifyContent: 'space-between',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', fontSize: 26, fontWeight: 700, letterSpacing: -1, color: '#8be3c4' }}>
            <span>weir</span>
          </div>
          <div style={{ fontSize: 11, letterSpacing: 4, color: '#7d979e', marginTop: 3 }}>
            ON SUI
          </div>
        </div>
        <div style={{ display: 'flex', flexGrow: 1 }} />
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 22px',
            borderRadius: 999,
            border: '1px solid rgba(139,227,196,0.35)',
            fontSize: 16,
            letterSpacing: 3,
            color: '#8be3c4',
          }}
        >
          <div style={{ display: 'flex', width: 8, height: 8, borderRadius: 999, background: '#8be3c4' }} />
          <span>{copy.pill}</span>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {/* Two lines, never one. The card is 1200 wide with 72 of padding either side, and a
            headline set on a single line at this size ran off the right edge — "yours" was cut in
            half on the first render of the open card, which is why this was looked at and not
            only asserted on. "Your money stays yours." is the longer of the two lines and leaves
            about 150px to spare. */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            fontSize: 72,
            fontWeight: 700,
            letterSpacing: -2.6,
            lineHeight: 1.06,
          }}
        >
          <span>{copy.headline[0]}</span>
          <span style={{ color: '#8be3c4' }}>{copy.headline[1]}</span>
        </div>
        <div
          style={{
            display: 'flex',
            fontSize: 25,
            color: '#9db4bb',
            marginTop: 22,
            maxWidth: 900,
            lineHeight: 1.45,
          }}
        >
          <span>{copy.body}</span>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', height: 2, background: 'rgba(139,227,196,0.6)', borderRadius: 2 }} />
        <div style={{ display: 'flex', alignItems: 'center', marginTop: 18 }}>
          <div style={{ display: 'flex', fontSize: 18, color: '#e8d5a4' }}>
            <span>{copy.foot}</span>
          </div>
          <div style={{ display: 'flex', flexGrow: 1 }} />
          <div style={{ display: 'flex', fontSize: 18, color: '#7d979e' }}>
            <span>weir.social</span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default async function OpengraphImage() {
  return new ImageResponse(<ShareCard copy={shareCardCopy(await readSiteMode())} />, size);
}
