// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'Weir — a creator network whose economics are contracts on Sui';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/**
 * The social preview, drawn rather than screenshotted.
 *
 * # What it claims
 *
 * The no-loss vault, because it is the thing nobody else offers and the only line worth spending a
 * preview on. Everything stated here is true of the contracts: a deposit is delegated, the yield
 * goes to the creator, and the principal stays withdrawable in full.
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
          background: '#05080f',
          backgroundImage:
            'radial-gradient(ellipse 70% 60% at 84% 6%, rgba(61,220,151,0.20), transparent 70%),' +
            'radial-gradient(ellipse 80% 60% at 10% 0%, rgba(77,162,255,0.20), transparent 70%),' +
            'radial-gradient(ellipse 60% 60% at 34% 100%, rgba(139,107,255,0.14), transparent 70%)',
          color: '#eef3fa',
          fontFamily: 'sans-serif',
          padding: 72,
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {/* The stake ladder: four rungs, the staked one lit. The product's own mechanism. */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              width: 30,
              height: 44,
            }}
          >
            <div style={{ display: 'flex', height: 7, borderRadius: 2, background: 'rgba(255,255,255,0.22)' }} />
            <div style={{ display: 'flex', height: 7, borderRadius: 2, background: '#3ddc97' }} />
            <div style={{ display: 'flex', height: 7, borderRadius: 2, background: 'rgba(255,255,255,0.22)' }} />
            <div style={{ display: 'flex', height: 7, borderRadius: 2, background: 'rgba(255,255,255,0.22)' }} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', fontSize: 24, fontWeight: 700, letterSpacing: -1.2 }}>
              <span>weir</span>
            </div>
            <div style={{ fontSize: 11, letterSpacing: 4, color: '#6b7a95', marginTop: 3 }}>
              ON SUI
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', fontSize: 66, fontWeight: 700, letterSpacing: -2.4 }}>
            <span>Support a creator</span>
          </div>
          <div style={{ display: 'flex', fontSize: 66, fontWeight: 700, letterSpacing: -2.4 }}>
            <span>without spending</span>
            <span>&nbsp;</span>
            <span style={{ color: '#3ddc97' }}>anything</span>
          </div>
          <div
            style={{
              display: 'flex',
              fontSize: 25,
              color: '#9fb0c9',
              marginTop: 22,
              maxWidth: 860,
              lineHeight: 1.45,
            }}
          >
            <span>
              Park SUI in their vault. It is delegated, the staking yield goes to them, and your
              principal stays yours — withdrawable in full, any time.
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {['Subscriptions', 'Paid posts', 'No-loss vaults'].map((label) => (
            <div
              key={label}
              style={{
                display: 'flex',
                padding: '10px 18px',
                borderRadius: 999,
                border: '1px solid rgba(255,255,255,0.12)',
                background: 'rgba(10,18,32,0.82)',
                fontSize: 18,
                color: '#c9d6e8',
              }}
            >
              {label}
            </div>
          ))}
          <div style={{ display: 'flex', flexGrow: 1 }} />
          <div style={{ display: 'flex', fontSize: 18, color: '#6b7a95' }}>
            <span>Settled on chain, not in a database</span>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
