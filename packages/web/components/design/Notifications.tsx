'use client';
// Built-by: @projectx.sui /|\ · Co-authored-by: Claude


import { Fragment, type ReactNode } from 'react';

export interface DesignNotification {
  icon: ReactNode;
  markColor: string;
  text: string;
  meta: string;
}

export function DesignNotifications({
  signedIn,
  myHandle,
  notifications,
  bare = false,
}: {
  signedIn: boolean;
  myHandle: string | null;
  notifications: readonly DesignNotification[];
  /**
   * Render the content only, with no header, footer or centred `main` of its own.
   *
   * Alerts is a personal, signed-in surface — it sits beside Purchases and Referrals in the account
   * rail and belongs in the dashboard with them. It was a standalone design route carrying its own
   * chrome, so following "Alerts" from the rail dropped a signed-in reader *out* of the dashboard
   * onto a full-width marketing-shaped page, and the rail they had just used disappeared.
   *
   * `bare` lets `AppFrame` supply the chrome instead. The guest state below is untouched: a guest
   * never reaches the dashboard, so they still get the standalone page.
   */
  bare?: boolean;
}) {
  const isGuest = !signedIn;

  /*
    Inside the dashboard the frame already owns `main` and `#main`. Rendering a second one nests two
    landmarks and puts a duplicate skip-link target in the document — so `bare` renders a plain
    section and lets the frame keep both.
  */
  const Body = bare ? 'section' : 'main';
  const bodyProps = bare
    ? { 'aria-label': 'Alerts' }
    : {
        id: 'main',
        style: {
          animation: 'pageIn 0.5s cubic-bezier(.16,1,.3,1) both',
          maxWidth: '48rem',
          marginInline: 'auto',
          padding: '3rem 1.5rem 6rem',
        } as const,
      };

  return (
    <>
          <Body {...bodyProps}>
            {!bare && (<>
            <p style={{ margin: '0 0 0.875rem', textAlign: 'center', fontFamily: '\'Geist Mono\',monospace', fontSize: '0.8125rem', fontWeight: '500', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--sand,#d9c9a3)' }}>Notifications</p>
            <h1 style={{ margin: '0 auto', textAlign: 'center', fontFamily: '\'Geist\',system-ui,sans-serif', fontWeight: '700', lineHeight: '1.1', letterSpacing: '-0.032em', fontSize: 'clamp(1.75rem,1.2rem + 1.8vw,2.5rem)', maxWidth: '36ch', textWrap: 'balance' }}>What happened <span style={{ background: 'linear-gradient(100deg,var(--crest,#8be3c6),var(--teal,#7fd8dd) 46%,var(--sand,#d9c9a3))', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', filter: 'drop-shadow(0 0 26px rgba(var(--crest-rgb,139,227,198),0.35))' }}>while you were away</span></h1>
            <div style={{ height: '1px', background: 'linear-gradient(to right,var(--crest,#8be3c6) 0 24px,var(--line,#1c3d47) 24px)', marginBlock: '2.5rem' }}></div>
            </>)}
            {isGuest && (<>
              <div style={{ border: '1px solid var(--line,#1c3d47)', borderLeft: '3px solid var(--alert,#f2a29b)', borderRadius: '10px', padding: '1.25rem 1.5rem', maxWidth: '62ch' }}>
                <p style={{ margin: '0', fontFamily: '\'Geist Mono\',monospace', fontSize: '0.8125rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--alert,#f2a29b)' }}>Sign in to see your alerts</p>
                <p style={{ margin: '0.5rem 0 0', color: 'var(--dim,#a3bcb8)', fontSize: '0.9375rem' }}>Alerts are built from payments and unlocks that settled to your address on chain, so we need to know which address is yours. If you were signed in and see this, sign in again.</p>
                <button className="dh-f10f4630" type="button" onClick={() => { window.location.href = '/signin'; }} style={{ marginTop: '1.25rem', padding: '0.7rem 1.35rem', borderRadius: '10px', font: '600 0.9375rem \'Geist\',sans-serif', lineHeight: '1', border: '1px solid rgba(var(--crest-rgb,139,227,198),0.45)', background: 'rgba(var(--crest-rgb,139,227,198),0.06)', color: 'var(--ink,#dce9e6)', cursor: 'pointer', transition: 'transform 0.12s ease,border-color 0.12s ease,color 0.12s ease,background-color 0.12s ease' }}>Sign in</button>
              </div>
            </>)}
            {signedIn && (<>
              <div style={{ display: 'grid', gap: '1rem' }}>
                {(notifications ?? []).map((n, i) => (<Fragment key={i}>
                  <div style={{ background: 'linear-gradient(180deg,rgba(var(--pa,20,52,62),0.78),rgba(var(--pb,9,32,42),0.88))', border: '1px solid rgba(var(--crest-rgb,139,227,198),0.14)', borderRadius: '10px', boxShadow: 'inset 0 1px 0 rgba(var(--hi-rgb,220,233,230),0.07),0 14px 34px -26px rgba(var(--shade-rgb,0,0,0),0.85)', padding: '1.25rem 1.5rem', display: 'flex', gap: '1.25rem', alignItems: 'flex-start' }}>
                    <span aria-hidden="true" style={{ display: 'inline-flex', paddingTop: '0.15rem', color: `${n.markColor}` }}>{n.icon}</span>
                    <div style={{ minWidth: '0' }}>
                      <p style={{ margin: '0', color: 'var(--ink,#dce9e6)', fontSize: '0.9375rem' }}>{n.text}</p>
                      <p style={{ margin: '0.375rem 0 0', fontFamily: '\'Geist Mono\',monospace', fontVariantNumeric: 'tabular-nums', fontSize: '0.8125rem', color: 'var(--dim,#a3bcb8)' }}>{n.meta}</p>
                    </div>
                  </div>
                </Fragment>))}
                <p style={{ margin: '0', fontFamily: '\'Geist Mono\',monospace', fontSize: '0.8125rem', color: 'var(--dim,#a3bcb8)' }}>Older alerts are not shown here.</p>
              </div>
            </>)}
          </Body>
    </>
  );
}
