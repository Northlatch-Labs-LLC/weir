// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'Weir is in closed alpha — creators are onboarding by invitation.';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/**
 * The social preview, drawn rather than screenshotted.
 *
 * # What it claims
 *
 * Only what the live site itself says; nothing here may assert anything the pages do not. The card
 * uses the site's own palette — deep teal water, mint headline accent, gold for the invitation — so
 * a shared link looks like the page it opens.
 *
 * # Built from divs, deliberately
 *
 * This renders through Satori at the edge, which supports flexbox and very little else and has no
 * access to the stylesheet — so none of the tokens in `globals.css` are reachable and the colours
 * are literals here. Any div holding more than one child carries `display: flex` explicitly:
 * without it Satori returns HTTP 200 with a zero-byte body and reports no error anywhere, which is
 * the kind of failure that ships.
 */
export default function OpengraphImage() {
  return new ImageResponse(
    (
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
            <span>CLOSED ALPHA — BY INVITATION</span>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', fontSize: 72, fontWeight: 700, letterSpacing: -2.6 }}>
            <span>Weir is in</span>
            <span>&nbsp;</span>
            <span style={{ color: '#8be3c4' }}>closed alpha.</span>
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
            <span>
              Creators are onboarding now, by invitation. Leave your email and we will send one
              message when the doors open — and note the handle you would like.
            </span>
          </div>
        </div>

        {/* The waterline — the site's own motif, one calm line above the depth. */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', height: 2, background: 'rgba(139,227,196,0.6)', borderRadius: 2 }} />
          <div style={{ display: 'flex', alignItems: 'center', marginTop: 18 }}>
            <div style={{ display: 'flex', fontSize: 18, color: '#e8d5a4' }}>
              <span>Have an invitation? Enter your code and go straight in.</span>
            </div>
            <div style={{ display: 'flex', flexGrow: 1 }} />
            <div style={{ display: 'flex', fontSize: 18, color: '#7d979e' }}>
              <span>weir.social</span>
            </div>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
