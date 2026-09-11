'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { PageHead } from '@/components/design/PageHead';
import { Fragment, type ReactNode } from 'react';
import { useReveals } from '@/components/design/use-weir-line';
import { BUILT_ON } from '@/lib/built-on';

export interface DesignGuarantee {
  icon: ReactNode;
  title: string;
  body: string;
  mechanism: string;
}
export interface DesignOnlyChain {
  figure: string;
  title: string;
  body: string;
}
export interface DesignCmpRow {
  icon: ReactNode;
  q: string;
  weir: string;
  patreon: string;
  of: string;
}
export interface DesignCmpCard {
  name: string;
  figure: string;
  note: string;
  bg: string;
  border: string;
  shadow: string;
  rule: string;
  nameColor: string;
  figureColor: string;
  figureBg: string;
  clip: string;
  figureGlow: string;
}
export interface DesignContract {
  name: string;
  tag: string;
  tagColor: string;
  tagBorder: string;
  icon: ReactNode;
  rail: string;
  id: string | null;
  idColor: string;
  idStyle: string;
  what: string;
  copyLabel: string;
  linkLabel: string;
  linkColor: string;
  href: string | undefined;
  onCopy: (() => void) | undefined;
}

export function DesignSecurity({
  signedIn,
  myHandle,
  guarantees,
  onlyChain,
  cmpRows,
  cmpSummary,
  cmpSources,
  contracts,
}: {
  signedIn: boolean;
  myHandle: string | null;
  guarantees: readonly DesignGuarantee[];
  onlyChain: readonly DesignOnlyChain[];
  cmpRows: readonly DesignCmpRow[];
  cmpSummary: readonly DesignCmpCard[];
  cmpSources: readonly string[];
  contracts: readonly DesignContract[];
}) {
  useReveals();

  return (
    <>
          <div className="weir-page" style={{ maxWidth: '72rem', marginInline: 'auto', padding: '3rem 1.5rem 4rem' }}>
            <PageHead
              centered
              kicker="Security"
              title="A policy can be revised."
              accent="A contract cannot."
              lede="Each guarantee below is a property of the contracts, with the mechanism that enforces it beside it. Not a padlock icon."
            />

            <div style={{ display: 'grid', gap: '1.5rem', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,19rem),1fr))' }}>
              {(guarantees ?? []).map((g, i) => (<Fragment key={i}>
                <article className="dh-b3237c6c" data-reveal style={{ position: 'relative', overflow: 'hidden', background: 'linear-gradient(180deg,rgba(var(--pa,20,52,62),0.78),rgba(var(--pb,9,32,42),0.88))', border: '1px solid rgba(var(--crest-rgb,139,227,198),0.14)', borderRadius: '10px', boxShadow: 'inset 0 1px 0 rgba(var(--hi-rgb,220,233,230),0.07),0 14px 34px -26px rgba(var(--shade-rgb,0,0,0),0.85)', padding: '1.5rem', transition: 'border-color 0.18s ease,transform 0.18s ease,box-shadow 0.18s ease' }}>
                  <span aria-hidden="true" style={{ position: 'absolute', inset: '0 0 auto 0', height: '2px', background: 'linear-gradient(100deg,var(--crest,#8be3c6),var(--teal,#7fd8dd) 46%,transparent)' }}></span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '2.4rem', height: '2.4rem', borderRadius: '10px', color: 'var(--crest,#8be3c6)', background: 'rgba(var(--crest-rgb,139,227,198),0.08)', border: '1px solid rgba(var(--crest-rgb,139,227,198),0.22)', boxShadow: '0 0 18px -8px rgba(var(--crest-rgb,139,227,198),0.7)' }}>{g.icon}</span>
                  <h3 style={{ margin: '1rem 0 0', fontFamily: '\'Geist\',sans-serif', fontWeight: '700', fontSize: '1.1875rem', letterSpacing: '-0.02em' }}>{g.title}</h3>
                  <p style={{ margin: '0.625rem 0 0', color: 'var(--dim,#a3bcb8)', fontSize: '0.9375rem', maxWidth: '62ch', textWrap: 'pretty' }}>{g.body}</p>
                  <p style={{ margin: '1.25rem 0 0', paddingTop: '1rem', borderTop: '1px solid rgba(var(--line-rgb,28,61,71),0.9)', fontFamily: 'var(--weir-mono)', fontSize: '0.8125rem', color: 'var(--crest,#8be3c6)', textWrap: 'pretty' }}>{g.mechanism}</p>
                </article>
              </Fragment>))}
            </div>

            <section data-reveal aria-labelledby="only-title" style={{ marginTop: '4rem', textAlign: 'center' }}>
              <p style={{ margin: '0 0 0.875rem', textAlign: 'center', fontFamily: 'var(--weir-mono)', fontSize: '0.8125rem', fontWeight: '500', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--sand,#d9c9a3)' }}>Why this cannot be copied</p>
              <h2 id="only-title" style={{ margin: '0 auto 2rem', maxWidth: '36ch', fontFamily: '\'Geist\',system-ui,sans-serif', fontWeight: '700', lineHeight: '1.16', letterSpacing: '-0.022em', fontSize: 'clamp(1.4375rem,1.1rem + 1vw,1.8125rem)', textWrap: 'balance' }}>Three things <span className="weir-owned">only a chain can do</span></h2>
              <div style={{ display: 'grid', gap: '1.5rem', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,18rem),1fr))', textAlign: 'left' }}>
                {(onlyChain ?? []).map((o, i) => (<Fragment key={i}>
                  <div style={{ background: 'linear-gradient(180deg,rgba(var(--pc,26,66,78),0.88),rgba(var(--pd,11,37,48),0.92))', border: '1px solid rgba(var(--crest-rgb,139,227,198),0.22)', borderTop: '2px solid var(--crest,#8be3c6)', borderRadius: '10px', boxShadow: 'inset 0 1px 0 rgba(var(--hi-rgb,220,233,230),0.08),0 30px 70px -46px rgba(var(--crest-rgb,139,227,198),0.55)', padding: '1.75rem' }}>
                    <p className="w-gradfig" style={{ margin: '0', fontFamily: 'var(--weir-mono)', fontVariantNumeric: 'tabular-nums', fontSize: '2rem', fontWeight: '500', background: 'linear-gradient(100deg,var(--crest,#8be3c6),var(--teal,#7fd8dd))', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', filter: 'drop-shadow(0 0 22px rgba(var(--crest-rgb,139,227,198),0.4))' }}>{o.figure}</p>
                    <h3 style={{ margin: '0.75rem 0 0', fontFamily: '\'Geist\',sans-serif', fontWeight: '700', fontSize: '1.1875rem', letterSpacing: '-0.02em' }}>{o.title}</h3>
                    <p style={{ margin: '0.625rem 0 0', color: 'var(--dim,#a3bcb8)', fontSize: '0.9375rem', textWrap: 'pretty' }}>{o.body}</p>
                  </div>
                </Fragment>))}
              </div>
            </section>

            <section data-reveal aria-labelledby="cmp-title" style={{ marginTop: '4rem' }}>
              <div style={{ textAlign: 'center' }}>
                <p style={{ margin: '0 0 0.75rem', fontFamily: 'var(--weir-mono)', fontSize: '0.8125rem', fontWeight: '500', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--sand,#d9c9a3)' }}>Side by side</p>
                <h2 id="cmp-title" style={{ margin: '0 auto 0.75rem', maxWidth: '36ch', fontFamily: '\'Geist\',system-ui,sans-serif', fontWeight: '700', lineHeight: '1.16', letterSpacing: '-0.022em', fontSize: 'clamp(1.4375rem,1.1rem + 1vw,1.8125rem)', textWrap: 'balance' }}>The same questions, <span className="weir-owned">asked of everyone</span></h2>
                <p style={{ margin: '1.125rem auto 0', maxWidth: '58ch', textAlign: 'center', fontSize: '1.0625rem', lineHeight: '1.65', color: 'var(--dim,#a3bcb8)', textWrap: 'pretty', marginBottom: '2.5rem' }}>Figures for the other platforms are their own published rates, dated at the foot of this section. Where a number is a range we print the range, not the flattering end of it.</p>
              </div>

              <div style={{ display: 'grid', gap: '1.25rem', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,16rem),1fr))', marginBottom: '2.5rem' }}>
                {(cmpSummary ?? []).map((p, i) => (<Fragment key={i}>
                  <article style={{ position: 'relative', overflow: 'hidden', borderRadius: '10px', padding: '1.75rem', background: `${p.bg}`, border: `1px solid ${p.border}`, boxShadow: `${p.shadow}` }}>
                    <span aria-hidden="true" style={{ position: 'absolute', inset: '0 0 auto 0', height: '2px', background: `${p.rule}` }}></span>
                    <p style={{ margin: '0', display: 'flex', alignItems: 'center', gap: '0.5rem', fontFamily: 'var(--weir-mono)', fontSize: '0.8125rem', letterSpacing: '0.1em', textTransform: 'uppercase', color: `${p.nameColor}` }}>{p.name}</p>
                    <p className="w-gradfig" style={{ margin: '0.875rem 0 0', fontFamily: 'var(--weir-mono)', fontVariantNumeric: 'tabular-nums', fontSize: '2.25rem', fontWeight: '500', lineHeight: '1', color: `${p.figureColor}`, background: `${p.figureBg}`, WebkitBackgroundClip: `${p.clip}`, backgroundClip: `${p.clip}`, filter: `${p.figureGlow}` }}>{p.figure}</p>
                    <p style={{ margin: '0.625rem 0 0', fontSize: '0.9375rem', color: 'var(--dim,#a3bcb8)', textWrap: 'pretty' }}>{p.note}</p>
                  </article>
                </Fragment>))}
              </div>

              <div style={{ display: 'grid', gap: '1rem' }}>
                {(cmpRows ?? []).map((row, i) => (<Fragment key={i}>
                  <article style={{ border: '1px solid rgba(var(--crest-rgb,139,227,198),0.12)', borderRadius: '10px', background: 'linear-gradient(180deg,rgba(var(--pa,20,52,62),0.7),rgba(var(--pb,9,32,42),0.85))', boxShadow: 'inset 0 1px 0 rgba(var(--hi-rgb,220,233,230),0.05)', padding: '1.5rem' }}>
                    <h3 style={{ margin: '0 0 1.25rem', display: 'flex', alignItems: 'flex-start', gap: '0.625rem', fontFamily: '\'Geist\',sans-serif', fontWeight: '700', fontSize: '1.0625rem', letterSpacing: '-0.02em', color: 'var(--ink,#dce9e6)', textWrap: 'pretty' }}><span aria-hidden="true" style={{ color: 'var(--crest,#8be3c6)', display: 'inline-flex', paddingTop: '0.1rem' }}>{row.icon}</span>{row.q}</h3>
                    <div style={{ display: 'grid', gap: '0.75rem', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,14rem),1fr))' }}>
                      <div style={{ borderRadius: '10px', padding: '1rem 1.125rem', background: 'rgba(var(--crest-rgb,139,227,198),0.08)', border: '1px solid rgba(var(--crest-rgb,139,227,198),0.32)', boxShadow: '0 0 22px -14px rgba(var(--crest-rgb,139,227,198),0.8)' }}>
                        <p style={{ margin: '0 0 0.5rem', fontFamily: 'var(--weir-mono)', fontSize: '0.75rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--crest,#8be3c6)' }}>Weir</p>
                        <p style={{ margin: '0', fontSize: '0.9375rem', lineHeight: '1.55', color: 'var(--ink,#dce9e6)', textWrap: 'pretty' }}>{row.weir}</p>
                      </div>
                      <div style={{ borderRadius: '10px', padding: '1rem 1.125rem', background: 'rgba(var(--pe,4,22,29),0.5)', border: '1px solid rgba(var(--line-rgb,28,61,71),0.9)' }}>
                        <p style={{ margin: '0 0 0.5rem', fontFamily: 'var(--weir-mono)', fontSize: '0.75rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--dim,#a3bcb8)' }}>Patreon</p>
                        <p style={{ margin: '0', fontSize: '0.9375rem', lineHeight: '1.55', color: 'var(--dim,#a3bcb8)', textWrap: 'pretty' }}>{row.patreon}</p>
                      </div>
                      <div style={{ borderRadius: '10px', padding: '1rem 1.125rem', background: 'rgba(var(--pe,4,22,29),0.5)', border: '1px solid rgba(var(--line-rgb,28,61,71),0.9)' }}>
                        <p style={{ margin: '0 0 0.5rem', fontFamily: 'var(--weir-mono)', fontSize: '0.75rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--dim,#a3bcb8)' }}>OnlyFans</p>
                        <p style={{ margin: '0', fontSize: '0.9375rem', lineHeight: '1.55', color: 'var(--dim,#a3bcb8)', textWrap: 'pretty' }}>{row.of}</p>
                      </div>
                    </div>
                  </article>
                </Fragment>))}
              </div>

              <div style={{ marginTop: '1.5rem', border: '1px solid rgba(var(--line-rgb,28,61,71),0.9)', borderLeft: '3px solid var(--sand,#d9c9a3)', borderRadius: '10px', padding: '1.25rem 1.5rem' }}>
                <p style={{ margin: '0', fontFamily: 'var(--weir-mono)', fontSize: '0.75rem', letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--sand,#d9c9a3)' }}>Sources</p>
                <ul style={{ margin: '0.75rem 0 0', padding: '0', listStyle: 'none', display: 'grid', gap: '0.5rem' }}>
                  {(cmpSources ?? []).map((src, i) => (<Fragment key={i}>
                    <li style={{ fontFamily: 'var(--weir-mono)', fontSize: '0.8125rem', lineHeight: '1.6', color: 'var(--dim,#a3bcb8)', textWrap: 'pretty' }}>{src}</li>
                  </Fragment>))}
                </ul>
              </div>
            </section>

            <section data-reveal aria-labelledby="pub-title" style={{ marginTop: '4rem' }}>
              <div style={{ textAlign: 'center' }}>
                <p style={{ margin: '0 0 0.75rem', fontFamily: 'var(--weir-mono)', fontSize: '0.8125rem', fontWeight: '500', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--sand,#d9c9a3)' }}>Published on chain</p>
                <h2 id="pub-title" style={{ margin: '0 auto 0.75rem', maxWidth: '36ch', fontFamily: '\'Geist\',system-ui,sans-serif', fontWeight: '700', lineHeight: '1.16', letterSpacing: '-0.022em', fontSize: 'clamp(1.4375rem,1.1rem + 1vw,1.8125rem)', textWrap: 'balance' }}>Read the <span className="weir-owned">contracts yourself</span></h2>
                <p style={{ margin: '1.125rem auto 0', maxWidth: '58ch', textAlign: 'center', fontSize: '1.0625rem', lineHeight: '1.65', color: 'var(--dim,#a3bcb8)', textWrap: 'pretty', marginBottom: '2.5rem' }}>Every claim on this page is enforced by code at one of these addresses. Copy an id, open it in an explorer, and check us. A slot reading <span style={{ color: 'var(--alert,#f2a29b)', fontStyle: 'italic' }}>not published</span> is one we have not deployed yet, never a placeholder dressed as a live address.</p>
              </div>

              <div style={{ display: 'grid', gap: '1.25rem' }}>
                {(contracts ?? []).map((c, i) => (<Fragment key={i}>
                  <article className="dh-ccd4b338" style={{ position: 'relative', overflow: 'hidden', display: 'grid', gap: '1.25rem', gridTemplateColumns: 'minmax(0,1fr) auto', alignItems: 'center', background: 'linear-gradient(180deg,rgba(var(--pa,20,52,62),0.78),rgba(var(--pb,9,32,42),0.88))', border: '1px solid rgba(var(--crest-rgb,139,227,198),0.14)', borderRadius: '10px', boxShadow: 'inset 0 1px 0 rgba(var(--hi-rgb,220,233,230),0.07),0 14px 34px -26px rgba(var(--shade-rgb,0,0,0),0.85)', padding: '1.5rem', transition: 'border-color 0.18s ease,box-shadow 0.18s ease' }}>
                    <span aria-hidden="true" style={{ position: 'absolute', inset: '0 auto 0 0', width: '2px', background: `${c.rail}` }}></span>
                    <div style={{ minWidth: '0', paddingLeft: '0.5rem' }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.75rem' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '2rem', height: '2rem', borderRadius: '8px', color: 'var(--crest,#8be3c6)', background: 'rgba(var(--crest-rgb,139,227,198),0.08)', border: '1px solid rgba(var(--crest-rgb,139,227,198),0.22)', boxShadow: '0 0 16px -8px rgba(var(--crest-rgb,139,227,198),0.7)' }}>{c.icon}</span>
                        <h3 style={{ margin: '0', fontFamily: '\'Geist\',sans-serif', fontWeight: '700', fontSize: '1.0625rem', letterSpacing: '-0.02em' }}>{c.name}</h3>
                        <span style={{ fontFamily: 'var(--weir-mono)', fontSize: '0.75rem', letterSpacing: '0.08em', textTransform: 'uppercase', padding: '0.15rem 0.55rem', borderRadius: '99px', border: `1px solid ${c.tagBorder}`, color: `${c.tagColor}` }}>{c.tag}</span>
                      </div>
                      <p style={{ margin: '0.75rem 0 0', fontFamily: 'var(--weir-mono)', fontSize: '0.8125rem', wordBreak: 'break-all', color: `${c.idColor}`, fontStyle: `${c.idStyle}` }}>{c.id}</p>
                      <p style={{ margin: '0.5rem 0 0', color: 'var(--dim,#a3bcb8)', fontSize: '0.9375rem', maxWidth: '62ch', textWrap: 'pretty' }}>{c.what}</p>
                    </div>
                    <div style={{ display: 'grid', gap: '0.5rem', justifyItems: 'stretch' }}>
                      <button className="dh-f10f4630" type="button" onClick={c.onCopy} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.45rem', padding: '0.55rem 1rem', borderRadius: '10px', font: '600 0.875rem \'Geist\',sans-serif', lineHeight: '1', cursor: 'pointer', background: 'rgba(var(--crest-rgb,139,227,198),0.06)', border: '1px solid rgba(var(--crest-rgb,139,227,198),0.45)', color: 'var(--ink,#dce9e6)', transition: 'transform 0.12s ease,border-color 0.12s ease,color 0.12s ease' }}>{c.copyLabel}</button>
                      <a className="dh-640f211f" href={c.href} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.45rem', padding: '0.55rem 1rem', borderRadius: '10px', fontFamily: 'var(--weir-mono)', fontSize: '0.8125rem', textDecoration: 'none', border: '1px solid rgba(var(--line-rgb,28,61,71),0.9)', color: `${c.linkColor}`, transition: 'border-color 0.12s ease,color 0.12s ease' }}>{c.linkLabel}</a>
                    </div>
                  </article>
                </Fragment>))}
              </div>

              <p style={{ margin: '1.25rem 0 0', fontFamily: 'var(--weir-mono)', fontSize: '0.8125rem', color: 'var(--dim,#a3bcb8)', textWrap: 'pretty', maxWidth: '72ch' }}>Network: Sui mainnet. Module source is published with the package: an explorer will show you the bytecode and, where verification is available, the Move source that produced it. If a figure on this site disagrees with one of these objects, the object is right.</p>
            </section>

            {/*
              What this runs on, at the size it deserves.

              These five were a column in the footer of every page — five logos beside the legal
              links, which is where a partner's mark goes to be ignored. This is the page that
              exists to answer "what is this built on", so they live here, each with the one line
              saying what it actually does for a reader.
            */}
            <section data-reveal aria-labelledby="built-title" style={{ marginTop: '4rem' }}>
              <h2 id="built-title" style={{ fontFamily: 'var(--weir-serif)', fontWeight: 500, fontSize: '1.625rem', margin: 0 }}>
                What it runs on
              </h2>
              <ul style={{ margin: '1.25rem 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: '0.75rem', maxWidth: '52rem' }}>
                {BUILT_ON.map((b) => (
                  <li key={b.name} style={{ display: 'flex', alignItems: 'center', gap: '0.875rem', padding: '0.875rem 1rem', border: '1px solid var(--line)', borderRadius: '12px', background: 'var(--bg-2)' }}>
                    <span aria-hidden style={{ flex: '0 0 auto', width: '2rem', height: '2rem', borderRadius: '8px', border: '1px solid var(--line)', background: 'var(--panel)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--weir-mono)', fontSize: '0.75rem', color: 'var(--crest)' }}>
                      {'logo' in b ? (
                        <img src={b.logo} alt="" width={20} height={20} style={{ width: '1.25rem', height: '1.25rem', objectFit: 'contain', display: 'block' }} />
                      ) : (
                        b.mark
                      )}
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <a href={b.href} rel="noreferrer" target="_blank" style={{ fontSize: '1rem', fontWeight: 500, color: 'var(--ink)' }}>
                        {b.name}
                      </a>
                      <span style={{ display: 'block', fontSize: '0.9375rem', color: 'var(--dim)' }}>{b.note}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            <div data-reveal style={{ marginTop: '3rem', border: '1px solid rgba(var(--alert-rgb,242,162,155),0.3)', borderLeft: '3px solid var(--alert,#f2a29b)', borderRadius: '10px', padding: '1.5rem', maxWidth: '72ch' }}>
              {/*
                This was headed "What we do not claim" in alert red, and read as a confession: a
                chain does not make software correct, code can be wrong, a validator can misbehave.
                All true, none of it actionable, and no company writes it about itself.

                One of those four facts is something the reader must actually do something about —
                back up the key — so that is what the box says, as instruction rather than apology.
              */}
              <p style={{ margin: '0', fontFamily: 'var(--weir-mono)', fontSize: '0.8125rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--alert,#f2a29b)' }}>Back up your key</p>
              <p style={{ margin: '0.625rem 0 0', color: 'var(--dim,#a3bcb8)', fontSize: '0.9375rem', textWrap: 'pretty' }}>Your key is the account. Keep a copy somewhere safe and offline. If it is lost there is no reset, here or anywhere else, because nobody else ever had it.</p>
            </div>
          </div>
    </>
  );
}
