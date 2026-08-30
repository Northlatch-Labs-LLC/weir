'use client';
// Built-by: @projectx.sui /|\ · Co-authored-by: Claude

/**
 *   2. The "reader: live / unreachable" toggle is gone. It is a review affordance for previewing
 *      the honest states, and shipping it would let anyone flip our figures to "unreachable" — a
 *      control that makes the site lie on demand. In production that state comes from whether the
 *      read actually succeeded.
 *
 *   3. `style-hover` became real CSS classes (`.dh-*` in `weir.css`), because React cannot inline a
 *      pseudo-class. The declarations are copied across unchanged.
 *
 * Everything numeric is supplied by the caller. Nothing in this file knows a fee, a balance or a
 * count.
 */

import { Fragment, useRef, type ReactNode } from 'react';
import { useReveals, useWeirLine } from '@/components/design/use-weir-line';

/** A figure in the "On chain, right now" band, carrying its own honest-state styling. */
export interface DesignFigure {
  label: string;
  value: string;
  asOf?: string;
  /** The state is expressed as type, not as a badge: measured is mono and full ink, "early" is sand
   *  in the body face, unmeasured is alert and italic. Supplied so this component never decides
   *  whether something was read. */
  color: string;
  font: string;
  weight: string;
  size: string;
  style: string;
}

export interface DesignHeroRailItem { figure: string; label: string; icon: ReactNode; href: string }
export interface DesignPath { kicker: string; icon: ReactNode; title: string; body: string; cta: string; href: string }
export interface DesignMechanism { idx: string; icon: ReactNode; title: string; body: string; bg: string; topRule: string }
export interface DesignStep { n: string; icon: ReactNode; title: string; body: string }

export function DesignLanding({
  signedIn,
  myHandle,
  feeLabel,
  heroRail,
  figures,
  mechanism,
  paths,
  steps,
}: {
  signedIn: boolean;
  myHandle: string | null;
  /** The live platform fee, already formatted — "2.9%", or "a platform fee" when unread. */
  feeLabel: string;
  heroRail: readonly DesignHeroRailItem[];
  figures: readonly DesignFigure[];
  mechanism: readonly DesignMechanism[];
  paths: readonly DesignPath[];
  steps: readonly DesignStep[];
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useWeirLine(canvasRef);
  useReveals();

  return (
    <>
          <div className="weir-page">
            <section style={{ maxWidth: '72rem', marginInline: 'auto', padding: '6rem 1.5rem 0', position: 'relative', textAlign: 'center' }}>
              <p style={{ margin: '0 auto 1rem', display: 'inline-flex', alignItems: 'center', gap: '0.625rem', padding: '0.35rem 0.85rem 0.35rem 0.65rem', border: '1px solid var(--line,#1c3d47)', borderRadius: '99px', background: 'rgba(var(--pd,11,37,48),0.6)', fontFamily: '\'Geist Mono\',monospace', fontSize: '0.8125rem', fontWeight: '500', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--sand,#d9c9a3)', animation: 'rise .7s cubic-bezier(.16,1,.3,1) both 60ms' }}>
                <span aria-hidden="true" style={{ width: '0.5rem', height: '0.5rem', borderRadius: '50%', background: 'var(--crest,#8be3c6)', animation: 'pulseRing 2.6s ease-out infinite' }}></span>
                {/*
                  "alpha", not "beta". Every demo profile on this deployment says "Alpha with real
                  funds", and this badge must not claim a later stage than the product's own pages.
                */}
                SocialFi · live on Sui mainnet · alpha
              </p>
              <h1 style={{ margin: '0', fontFamily: '\'Geist\',system-ui,sans-serif', fontWeight: '700', lineHeight: '1.04', letterSpacing: '-0.04em', fontSize: 'clamp(2.5rem,1.2rem + 4.5vw,4.25rem)', maxWidth: '24ch', marginInline: 'auto', textWrap: 'balance', animation: 'rise .7s cubic-bezier(.16,1,.3,1) both 160ms' }}>Support that <span style={{ background: 'linear-gradient(100deg,var(--crest,#8be3c6),var(--teal,#7fd8dd) 46%,var(--sand,#d9c9a3))', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', filter: 'drop-shadow(0 0 26px rgba(var(--crest-rgb,139,227,198),0.35))' }}>stays yours.</span></h1>
              <p style={{ margin: '1.5rem auto 0', maxWidth: '62ch', textWrap: 'pretty', color: 'var(--ink-2,#b9cdc9)', textShadow: '0 0 18px rgba(var(--crest-rgb,139,227,198),0.18)', fontSize: '1.125rem', lineHeight: '1.65', animation: 'rise .7s cubic-bezier(.16,1,.3,1) both 260ms' }}>Pool SUI behind a creator. They receive only the staking yield it earns — the deposit remains yours, withdrawable in full, any time. Not because we promise it: because no function in the deployed contract moves it — and the key that could replace that contract is held by a 2-of-3 multisig, not by us alone.</p>
              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', justifyContent: 'center', marginTop: '2rem', animation: 'rise .7s cubic-bezier(.16,1,.3,1) both 360ms' }}>
                {/* Open site: the creator path first, discovery second. The waiting list is reachable from
                    the header only while the door is shut, because then it is the only way in. */}
                <a className="dh-0bc2a7d5" href="/join" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', padding: '0.7rem 1.35rem', borderRadius: '10px', fontWeight: '600', fontSize: '0.9375rem', lineHeight: '1', background: 'var(--crest,#8be3c6)', color: 'var(--bg,#04161d)', textDecoration: 'none', boxShadow: '0 0 22px -6px rgba(var(--crest-rgb,139,227,198),0.5)', transition: 'transform 0.12s ease,background-color 0.12s ease,box-shadow 0.18s ease' }}>Start a creator page</a>
                <a className="dh-237dddac" href="/explore" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', padding: '0.7rem 1.35rem', borderRadius: '10px', fontWeight: '600', fontSize: '0.9375rem', lineHeight: '1', border: '1px solid rgba(var(--crest-rgb,139,227,198),0.45)', background: 'rgba(var(--crest-rgb,139,227,198),0.06)', color: 'var(--ink,#dce9e6)', textDecoration: 'none', transition: 'transform 0.12s ease,border-color 0.12s ease,color 0.12s ease' }}>Explore creators</a>
              </div>
              <ul style={{ margin: '2.5rem 0 0', padding: '0', listStyle: 'none', display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '0.75rem 2rem', animation: 'rise .7s cubic-bezier(.16,1,.3,1) both 460ms' }}>
                {(heroRail ?? []).map((r, i) => (<Fragment key={i}>
                  <li><a className="dh-80d654f9" href={r.href} style={{ display: 'inline-flex', alignItems: 'baseline', gap: '0.5rem', textDecoration: 'none' }}>
                    <span style={{ fontFamily: '\'Geist Mono\',monospace', fontVariantNumeric: 'tabular-nums', fontSize: '1.0625rem', fontWeight: '500', background: 'linear-gradient(100deg,var(--crest,#8be3c6),var(--teal,#7fd8dd))', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>{r.figure}</span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.9375rem', color: 'var(--dim,#a3bcb8)' }}>{r.label}{r.icon}</span>
                  </a></li>
                </Fragment>))}
              </ul>
              <div style={{ height: '3rem' }}></div>
            </section>

            <div style={{ position: 'relative', height: '11rem', overflow: 'hidden' }}>
              <canvas ref={canvasRef} aria-hidden="true" style={{ display: 'block', width: '100%', height: '100%' }}></canvas>
            </div>

            <section data-reveal aria-label="What a weir is" style={{ maxWidth: '72rem', marginInline: 'auto', padding: '0 1.5rem' }}>
              <dl style={{ margin: '0 auto', padding: '2rem 0', borderTop: '1px solid var(--line,#1c3d47)', maxWidth: '46rem', textAlign: 'center' }}>
                <dt style={{ fontFamily: '\'Geist Mono\',monospace', fontSize: '1.625rem', fontWeight: '500', letterSpacing: '-0.02em', color: 'var(--ink,#dce9e6)' }}>weir <span style={{ fontFamily: '\'Geist Mono\',monospace', fontSize: '0.8125rem', color: 'var(--sand,#d9c9a3)', marginLeft: '0.75rem', letterSpacing: '0.05em' }}>( weer ) · n.</span></dt>
                <dd style={{ margin: '0.75rem auto 0', maxWidth: '52ch', color: 'var(--dim,#a3bcb8)', fontSize: '1.0625rem' }}>a low barrier across a river that holds a pool and lets the flow pass over. The river is not stopped. Nothing is taken from it.</dd>
              </dl>
            </section>

            <section data-reveal aria-labelledby="how-title" style={{ maxWidth: '72rem', marginInline: 'auto', padding: '4rem 1.5rem' }}>
              <p style={{ margin: '0 0 0.875rem', textAlign: 'center', fontFamily: '\'Geist Mono\',monospace', fontSize: '0.8125rem', fontWeight: '500', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--sand,#d9c9a3)' }}>The mechanism</p>
              <h2 id="how-title" style={{ margin: '0 auto 2rem', maxWidth: '36ch', textAlign: 'center', fontFamily: '\'Geist\',system-ui,sans-serif', fontWeight: '700', lineHeight: '1.1', letterSpacing: '-0.032em', fontSize: 'clamp(1.75rem,1.2rem + 1.8vw,2.5rem)', textWrap: 'balance' }}>Three ways money moves here — <span style={{ background: 'linear-gradient(100deg,var(--crest,#8be3c6),var(--teal,#7fd8dd) 46%,var(--sand,#d9c9a3))', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', filter: 'drop-shadow(0 0 26px rgba(var(--crest-rgb,139,227,198),0.35))' }}>and one way it doesn't</span></h2>
              <div style={{ display: 'grid', gap: '1.5rem', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,15rem),1fr))' }}>
                {(mechanism ?? []).map((m, i) => (<Fragment key={i}>
                  <article style={{ background: `${m.bg}`, border: '1px solid var(--line,#1c3d47)', borderTop: `${m.topRule}`, borderRadius: '10px', padding: '1.5rem' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.625rem', fontFamily: '\'Geist Mono\',monospace', fontSize: '0.8125rem', color: 'var(--crest,#8be3c6)', marginBottom: '0.875rem' }}>{m.icon}{m.idx}</span>
                    <h3 style={{ margin: '0 0 0.5rem', fontFamily: '\'Geist\',sans-serif', fontWeight: '600', fontSize: '1.1875rem' }}>{m.title}</h3>
                    <p style={{ margin: '0', color: 'var(--dim,#a3bcb8)', fontSize: '0.9375rem', maxWidth: '62ch', textWrap: 'pretty' }}>{m.body}</p>
                  </article>
                </Fragment>))}
              </div>
            </section>

            <section data-reveal aria-labelledby="paths-title" style={{ maxWidth: '72rem', marginInline: 'auto', padding: '0 1.5rem 4rem' }}>
              <p style={{ margin: '0 0 0.875rem', textAlign: 'center', fontFamily: '\'Geist Mono\',monospace', fontSize: '0.8125rem', fontWeight: '500', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--sand,#d9c9a3)' }}>The three lines</p>
              <h2 id="paths-title" style={{ margin: '0 auto 2rem', maxWidth: '36ch', textAlign: 'center', fontFamily: '\'Geist\',system-ui,sans-serif', fontWeight: '700', lineHeight: '1.1', letterSpacing: '-0.032em', fontSize: 'clamp(1.75rem,1.2rem + 1.8vw,2.5rem)', textWrap: 'balance' }}>Three ways money <span style={{ background: 'linear-gradient(100deg,var(--crest,#8be3c6),var(--teal,#7fd8dd) 46%,var(--sand,#d9c9a3))', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', filter: 'drop-shadow(0 0 26px rgba(var(--crest-rgb,139,227,198),0.35))' }}>reaches a creator</span></h2>
              <div style={{ display: 'grid', gap: '1.5rem', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,20rem),1fr))' }}>
                {(paths ?? []).map((p, i) => (<Fragment key={i}>
                  <a className="dh-517ebcfe" href={p.href} style={{ display: 'block', position: 'relative', overflow: 'hidden', background: 'linear-gradient(180deg,rgba(var(--pa,20,52,62),0.78),rgba(var(--pb,9,32,42),0.88))', border: '1px solid rgba(var(--crest-rgb,139,227,198),0.14)', borderRadius: '10px', boxShadow: 'inset 0 1px 0 rgba(var(--hi-rgb,220,233,230),0.07),0 14px 34px -26px rgba(var(--shade-rgb,0,0,0),0.85)', padding: '1.75rem', textDecoration: 'none', transition: 'border-color 0.18s ease,transform 0.18s ease' }}>
                    <span aria-hidden="true" style={{ position: 'absolute', inset: '0 0 auto 0', height: '2px', background: 'linear-gradient(100deg,var(--crest,#8be3c6),var(--teal,#7fd8dd) 46%,var(--sand,#d9c9a3))' }}></span>
                    <p style={{ margin: '0', display: 'flex', alignItems: 'center', gap: '0.5rem', fontFamily: '\'Geist Mono\',monospace', fontSize: '0.8125rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--crest,#8be3c6)' }}>{p.icon}{p.kicker}</p>
                    <h3 style={{ margin: '0.875rem 0 0', fontFamily: '\'Geist\',sans-serif', fontWeight: '700', fontSize: '1.5rem', letterSpacing: '-0.03em', color: 'var(--ink,#dce9e6)' }}>{p.title}</h3>
                    <p style={{ margin: '0.75rem 0 0', color: 'var(--dim,#a3bcb8)', fontSize: '0.9375rem', maxWidth: '62ch', textWrap: 'pretty' }}>{p.body}</p>
                    <p style={{ margin: '1.25rem 0 0', fontFamily: '\'Geist Mono\',monospace', fontSize: '0.8125rem', color: 'var(--crest,#8be3c6)' }}>{p.cta} →</p>
                  </a>
                </Fragment>))}
              </div>
            </section>

            <section data-reveal aria-labelledby="figures-title" style={{ maxWidth: '72rem', marginInline: 'auto', padding: '0 1.5rem 4rem' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: '1rem', marginBottom: '0.75rem' }}>
                <p style={{ margin: '0', fontFamily: '\'Geist Mono\',monospace', fontSize: '0.8125rem', fontWeight: '500', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--sand,#d9c9a3)' }}>On chain, right now</p>
          
              </div>
              <h2 id="figures-title" style={{ position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }}>Live figures</h2>
              <div style={{ display: 'grid', gap: '1.5rem', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,15rem),1fr))' }}>
                {(figures ?? []).map((f, i) => (<Fragment key={i}>
                  <div style={{ background: 'linear-gradient(180deg,rgba(var(--pa,20,52,62),0.78),rgba(var(--pb,9,32,42),0.88))', border: '1px solid rgba(var(--crest-rgb,139,227,198),0.14)', borderRadius: '10px', boxShadow: 'inset 0 1px 0 rgba(var(--hi-rgb,220,233,230),0.07),0 14px 34px -26px rgba(var(--shade-rgb,0,0,0),0.85)', padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                    <span style={{ fontFamily: '\'Geist Mono\',monospace', fontSize: '0.8125rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--dim,#a3bcb8)' }}>{f.label}</span>
                    <span style={{ fontFamily: `${f.font}`, fontSize: `${f.size}`, fontWeight: `${f.weight}`, fontStyle: `${f.style}`, color: `${f.color}`, fontVariantNumeric: 'tabular-nums' }}>{f.value}</span>
                    <span style={{ fontFamily: '\'Geist Mono\',monospace', fontSize: '0.8125rem', color: 'var(--dim,#a3bcb8)' }}>{f.asOf}</span>
                  </div>
                </Fragment>))}
              </div>
              <p style={{ margin: '1rem 0 0', maxWidth: '62ch', textWrap: 'pretty', color: 'var(--dim,#a3bcb8)', fontSize: '0.9375rem' }}>A figure shown as <span style={{ color: 'var(--sand,#d9c9a3)' }}>Early</span> is real but young — we show numbers once they mean something. <span style={{ color: 'var(--alert,#f2a29b)' }}>not measured</span> means our reader couldn't reach the chain: a fault in our reader, never a zero.</p>
            </section>

            <div style={{ maxWidth: '72rem', marginInline: 'auto', padding: '0 1.5rem' }}><div style={{ height: '1px', background: 'linear-gradient(to right,var(--crest,#8be3c6) 0 24px,var(--line,#1c3d47) 24px)', marginBlock: '3rem' }}></div></div>

            <section data-reveal aria-labelledby="creators-title" style={{ maxWidth: '72rem', marginInline: 'auto', padding: '0 1.5rem 4rem' }}>
              <p style={{ margin: '0 0 0.875rem', textAlign: 'center', fontFamily: '\'Geist Mono\',monospace', fontSize: '0.8125rem', fontWeight: '500', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--sand,#d9c9a3)' }}>For creators</p>
              <h2 id="creators-title" style={{ margin: '0 auto 2rem', maxWidth: '36ch', textAlign: 'center', fontFamily: '\'Geist\',system-ui,sans-serif', fontWeight: '700', lineHeight: '1.1', letterSpacing: '-0.032em', fontSize: 'clamp(1.75rem,1.2rem + 1.8vw,2.5rem)', textWrap: 'balance' }}>The audience that will never pay you monthly <span style={{ background: 'linear-gradient(100deg,var(--crest,#8be3c6),var(--teal,#7fd8dd) 46%,var(--sand,#d9c9a3))', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', filter: 'drop-shadow(0 0 26px rgba(var(--crest-rgb,139,227,198),0.35))' }}>can still pay you</span></h2>
              <div style={{ display: 'grid', gap: '3rem', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,20rem),1fr))', alignItems: 'start' }}>
                <div>
                  <p style={{ margin: '0 0 1rem', maxWidth: '62ch', textWrap: 'pretty', color: 'var(--dim,#a3bcb8)' }}>A subscription asks a fan to give up money. A pool asks them to give up the yield on money they keep. Most people who will never do the first will do the second — and you can hold both on one page.</p>
                  <p style={{ margin: '0', maxWidth: '62ch', textWrap: 'pretty', color: 'var(--dim,#a3bcb8)' }}>We take <span style={{ fontFamily: '\'Geist Mono\',monospace', color: 'var(--ink,#dce9e6)' }}>{feeLabel}</span> of subscriptions and unlocks, at settlement, in the same transaction. We take nothing from a pooled deposit, because a pooled deposit never moves to us.</p>
                  <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginTop: '2rem' }}>
                    <a className="dh-0bc2a7d5" href="/join" style={{ display: 'inline-flex', alignItems: 'center', padding: '0.7rem 1.35rem', borderRadius: '10px', fontWeight: '600', fontSize: '0.9375rem', lineHeight: '1', background: 'var(--crest,#8be3c6)', color: 'var(--bg,#04161d)', textDecoration: 'none', boxShadow: '0 0 22px -6px rgba(var(--crest-rgb,139,227,198),0.5)', transition: 'transform 0.12s ease,background-color 0.12s ease,box-shadow 0.18s ease' }}>Start a creator page</a>
                    <a className="dh-237dddac" href="/" style={{ display: 'inline-flex', alignItems: 'center', padding: '0.7rem 1.35rem', borderRadius: '10px', fontWeight: '600', fontSize: '0.9375rem', lineHeight: '1', border: '1px solid rgba(var(--crest-rgb,139,227,198),0.45)', background: 'rgba(var(--crest-rgb,139,227,198),0.06)', color: 'var(--ink,#dce9e6)', textDecoration: 'none', transition: 'transform 0.12s ease,border-color 0.12s ease,color 0.12s ease,background-color 0.12s ease' }}>See the feed</a>
                  </div>
                </div>
                <ol style={{ counterReset: 'step', display: 'grid', gap: '1.5rem', padding: '0', margin: '0', listStyle: 'none' }}>
                  {(steps ?? []).map((s, i) => (<Fragment key={i}>
                    <li style={{ position: 'relative', paddingLeft: '3.25rem', maxWidth: '62ch' }}>
                      <span aria-hidden="true" style={{ position: 'absolute', left: '0', top: '0', width: '2.25rem', height: '2.25rem', borderRadius: '50%', border: '1px solid var(--line,#1c3d47)', color: 'var(--crest,#8be3c6)', fontFamily: '\'Geist Mono\',monospace', fontSize: '0.8125rem', display: 'grid', placeItems: 'center' }}>{s.n}</span>
                      <h3 style={{ margin: '0 0 0.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem', fontFamily: '\'Geist\',sans-serif', fontWeight: '600', fontSize: '1.1875rem' }}><span style={{ color: 'var(--crest,#8be3c6)', display: 'inline-flex' }}>{s.icon}</span>{s.title}</h3>
                      <p style={{ margin: '0', color: 'var(--dim,#a3bcb8)', fontSize: '0.9375rem' }}>{s.body}</p>
                    </li>
                  </Fragment>))}
                </ol>
              </div>
            </section>

            <section data-reveal aria-labelledby="moat-title" style={{ maxWidth: '72rem', marginInline: 'auto', padding: '0 1.5rem 4rem' }}>
              <div style={{ position: 'relative', overflow: 'hidden', borderRadius: '10px', border: '1px solid rgba(var(--crest-rgb,139,227,198),0.22)', background: 'linear-gradient(180deg,rgba(var(--pc,26,66,78),0.88),rgba(var(--pd,11,37,48),0.92))', boxShadow: 'inset 0 1px 0 rgba(var(--hi-rgb,220,233,230),0.08),0 30px 70px -46px rgba(var(--crest-rgb,139,227,198),0.55)', padding: '3rem 2rem', textAlign: 'center' }}>
                <span aria-hidden="true" style={{ position: 'absolute', inset: '0 0 auto 0', height: '2px', background: 'linear-gradient(100deg,transparent,var(--crest,#8be3c6) 30%,var(--sand,#d9c9a3) 70%,transparent)' }}></span>
                <span aria-hidden="true" style={{ position: 'absolute', left: '50%', bottom: '-9rem', width: '30rem', height: '16rem', transform: 'translateX(-50%)', borderRadius: '50%', filter: 'blur(70px)', opacity: '0.2', background: 'radial-gradient(circle,var(--crest,#8be3c6),transparent 68%)', pointerEvents: 'none' }}></span>
                <p style={{ margin: '0 0 0.75rem', position: 'relative', fontFamily: '\'Geist Mono\',monospace', fontSize: '0.8125rem', fontWeight: '500', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--sand,#d9c9a3)' }}>The part nobody can copy</p>
                <h2 id="moat-title" style={{ margin: '0 auto', position: 'relative', maxWidth: '34ch', fontFamily: '\'Geist\',system-ui,sans-serif', fontWeight: '700', lineHeight: '1.1', letterSpacing: '-0.032em', fontSize: 'clamp(1.75rem,1.2rem + 1.8vw,2.5rem)', textWrap: 'balance' }}>Patreon takes 10% and holds the money. <span style={{ background: 'linear-gradient(100deg,var(--crest,#8be3c6),var(--teal,#7fd8dd) 46%,var(--sand,#d9c9a3))', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', filter: 'drop-shadow(0 0 26px rgba(var(--crest-rgb,139,227,198),0.35))' }}>We take {feeLabel} and never touch it.</span></h2>
                <p style={{ margin: '1.25rem auto 0', position: 'relative', maxWidth: '62ch', color: 'var(--dim,#a3bcb8)', textWrap: 'pretty' }}>Your subscribers' access is an object in their wallet. Your pool is a vault your address owns. Your paywall is a Seal key over a Walrus blob. None of it is a row in our database — which is why none of it depends on us still being here.</p>
                <div style={{ position: 'relative', display: 'flex', gap: '1rem', flexWrap: 'wrap', justifyContent: 'center', marginTop: '2rem' }}>
                  <a className="dh-0bc2a7d5" href="/security" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', padding: '0.7rem 1.35rem', borderRadius: '10px', fontWeight: '600', fontSize: '0.9375rem', lineHeight: '1', background: 'var(--crest,#8be3c6)', color: 'var(--bg,#04161d)', textDecoration: 'none', boxShadow: '0 0 22px -6px rgba(var(--crest-rgb,139,227,198),0.5)', transition: 'transform 0.12s ease,background-color 0.12s ease,box-shadow 0.18s ease' }}>See how it is enforced</a>
                </div>
              </div>
            </section>

            <section data-reveal aria-label="Other surfaces on the same protocol" style={{ maxWidth: '72rem', marginInline: 'auto', padding: '0 1.5rem 2rem' }}>
              <p style={{ margin: '0 0 0.875rem', textAlign: 'center', fontFamily: '\'Geist Mono\',monospace', fontSize: '0.8125rem', fontWeight: '500', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--sand,#d9c9a3)' }}>More from the protocol</p>
              {/*
                Centred under its centred label.
              */}
              <p style={{ margin: '0 auto', maxWidth: '62ch', textAlign: 'center', textWrap: 'pretty', color: 'var(--dim,#a3bcb8)' }}>Weir runs on the same deployed package as its sibling surfaces — <a href="https://protocolx.io">the no-loss vault</a>, <a href="https://raffle.protocolx.io">verifiable draws</a> and <a href="/names">.sui names</a> — <a href="https://projectxprotocol.dev">one protocol, documented here</a>.</p>
            </section>
          </div>
    </>
  );
}
