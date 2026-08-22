'use client';
// Built-by: @projectx.sui /|\ · Co-authored-by: Claude


import { PageHead } from '@/components/design/PageHead';
import { Fragment, useState, type ReactNode } from 'react';
import { useReveals } from '@/components/design/use-weir-line';

export interface DesignTreasuryRow {
  handle: string;
  displayName: string;
  initials: string;
  href: string;
  pooled: string;
  pooledFont: string;
  pooledStyle: string;
  pooledColor: string;
  yieldShare: string;
  yieldFont: string;
  yieldColor: string;
  validator: string;
  rungs: readonly { h: string; bg: string }[];
}
export interface DesignLadderRung {
  name: string;
  pct: string;
  state: string;
  bg: string;
  color: string;
}

export function DesignTreasuries({
  signedIn,
  myHandle,
  treasuries,
  treasuryCols,
  ladder,
  epochLabel,
  capturePct,
}: {
  signedIn: boolean;
  myHandle: string | null;
  treasuries: readonly DesignTreasuryRow[];
  treasuryCols: readonly string[];
  ladder: readonly DesignLadderRung[];
  epochLabel: string;
  /** `LADDER_DEPTH / RUNGS`, as a percentage. Derived from the contract, never typed. */
  capturePct: string;
}) {
  const [simAmount, setAmount] = useState('500');
  const [simWho, setWho] = useState('supporter');
  const onSimAmount = (e: React.ChangeEvent<HTMLInputElement>) => setAmount(e.target.value);
  const onSimWho = (e: React.ChangeEvent<HTMLSelectElement>) => setWho(e.target.value);

  /* The remainder of what the ladder captures — derived, so the two figures can never disagree. */
  const givenUpPct = `${(100 - Number(capturePct.replace('%', ''))).toFixed(1)}%`;

  const simOptions = [
    { label: 'A supporter pooling', value: 'supporter' },
    { label: 'A creator receiving', value: 'creator' },
  ];

  const amount = Number(simAmount);
  const valid = Number.isFinite(amount) && amount >= 0;

  /*
    The principal, which is the entire point: it does not move.

    The simulator deliberately shows no yield figure. Staking returns vary by validator and epoch and
    are not ours to promise — quoting one here would be the invented number this whole product argues
    against. What it can state exactly is what comes back, and that is all of it.
  */
  const simPrincipal = valid
    ? `${amount.toLocaleString(undefined, { maximumFractionDigits: 4 })} SUI — all of it, whenever you ask`
    : 'not a number';
  const simNote =
    simWho === 'creator'
      ? `You receive the staking yield on what your supporters pool. The ladder captures ${capturePct} of the theoretical maximum, which is the price of never making anyone wait.`
      : `Your deposit is delegated, never spent. You give up the yield it would have earned you; you keep every unit of the principal, withdrawable in full with no notice.`;

  /*
    The simulator's answer, as labelled rows.

    Every line is either arithmetic on what the reader typed or a statement about the contract. There
    is no yield figure, deliberately: staking returns vary by validator and epoch, they are not ours
    to promise, and a number invented here would be the exact thing the security page tells people to
    distrust.
  */
  const MONO = "'Geist Mono',monospace";
  const BODY = "'Geist',sans-serif";
  const INK = 'var(--ink,#dce9e6)';
  const CREST = 'var(--crest,#8be3c6)';
  const ALERT = 'var(--alert,#f2a29b)';

  const simRows = valid
    ? [
        { label: 'You deposit', value: `${amount.toLocaleString(undefined, { maximumFractionDigits: 4 })} SUI`, font: MONO, style: 'normal', color: INK },
        { label: 'You can withdraw', value: 'all of it, any time', font: BODY, style: 'normal', color: CREST },
        { label: 'They receive', value: 'the staking yield it earns', font: BODY, style: 'normal', color: INK },
        { label: 'Ladder captures', value: `${capturePct} of theoretical maximum`, font: MONO, style: 'normal', color: INK },
        { label: 'Functions that can move your principal', value: '0', font: MONO, style: 'normal', color: CREST },
      ]
    : [{ label: 'Amount', value: 'not a number', font: BODY, style: 'italic', color: ALERT }];

  /* The design marks sections `data-reveal`; without an observer they stay at opacity 0. */
  useReveals();

  return (
    <>
          <div className="weir-page" style={{ maxWidth: '72rem', marginInline: 'auto', padding: '3rem 1.5rem 4rem' }}>
            <PageHead
              centered
              kicker="Treasury"
              title="The pot that yield alone"
              accent="fills."
              lede={`Pooled SUI is delegated to validators. The staking yield it earns flows into the treasury; the principal never does. Nothing in this pot came out of anybody's balance — it is interest, gathered. The ladder below is why a withdrawal never waits on an epoch boundary, and why the capture is ${capturePct} rather than 100%. We publish the cost in the same breath as the convenience.`}
            />

            <p style={{ margin: '0 0 1rem', fontFamily: '\'Geist Mono\',monospace', fontSize: '0.8125rem', fontWeight: '500', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--sand,#d9c9a3)' }}>The pools that fill it</p>
            {(treasuries ?? []).length === 0 ? (
              /* A measured absence, stated as one. A header row over nothing reads as a table that failed to load. */
              <p data-reveal style={{ margin: '0', padding: '1.25rem', border: '1px solid var(--line,#1c3d47)', borderRadius: '10px', background: 'var(--panel,#0b2530)', fontFamily: '\'Geist Mono\',monospace', fontSize: '0.875rem', color: 'var(--dim,#a3bcb8)', textWrap: 'pretty' }}>No pools open yet. The first creator to open one will appear here.</p>
            ) : (
            <div data-reveal style={{ overflowX: 'auto', border: '1px solid var(--line,#1c3d47)', borderRadius: '10px', background: 'var(--panel,#0b2530)' }}>
              <table className="weir-stack" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9375rem' }}>
                <thead>
                  <tr>
                    {(treasuryCols ?? []).map((col, i) => (<Fragment key={i}>
                      <th scope="col" style={{ textAlign: 'left', padding: '0.875rem 1.25rem', fontFamily: '\'Geist Mono\',monospace', fontSize: '0.8125rem', fontWeight: '500', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--dim,#a3bcb8)', borderBottom: '1px solid var(--line,#1c3d47)', whiteSpace: 'nowrap' }}>{col}</th>
                    </Fragment>))}
                  </tr>
                </thead>
                <tbody>
                  {(treasuries ?? []).map((t, i) => (<Fragment key={i}>
                    <tr className="dh-c04cdaa8" style={{ transition: 'background-color 0.12s ease' }}>
                      <td style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--line,#1c3d47)' }}>
                        <a className="dh-e61ac03a" href={t.href} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', textDecoration: 'none' }}>
                          <span aria-hidden="true" style={{ width: '2rem', height: '2rem', borderRadius: '50%', background: 'var(--line-2,var(--line-2,#123039))', border: '1px solid var(--line,#1c3d47)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontFamily: '\'Geist Mono\',monospace', fontSize: '0.6875rem', color: 'var(--crest,#8be3c6)', flexShrink: '0' }}>{t.initials}</span>
                          <span style={{ minWidth: '0' }}>
                            <span style={{ display: 'block', fontWeight: '600', color: 'var(--ink,#dce9e6)' }}>{t.displayName}</span>
                            <span style={{ display: 'block', fontFamily: '\'Geist Mono\',monospace', fontSize: '0.8125rem', color: 'var(--crest,#8be3c6)' }}>@{t.handle}</span>
                          </span>
                        </a>
                      </td>
                      <td data-label={treasuryCols[1]} style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--line,#1c3d47)', fontFamily: `${t.pooledFont}`, fontStyle: `${t.pooledStyle}`, color: `${t.pooledColor}`, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{t.pooled}</td>
                      <td data-label={treasuryCols[2]} style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--line,#1c3d47)', fontFamily: `${t.yieldFont}`, color: `${t.yieldColor}`, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{t.yieldShare}</td>
                      <td data-label={treasuryCols[3]} style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--line,#1c3d47)', fontFamily: '\'Geist Mono\',monospace', fontSize: '0.8125rem', color: 'var(--dim,#a3bcb8)', whiteSpace: 'nowrap' }}>{t.validator}</td>
                      <td data-label={treasuryCols[4]} style={{ padding: '1rem 1.25rem', borderBottom: '1px solid var(--line,#1c3d47)' }}>
                        <div style={{ display: 'flex', gap: '3px', alignItems: 'flex-end', height: '1.5rem' }}>
                          {(t.rungs ?? []).map((r, i) => (<Fragment key={i}>
                            <span aria-hidden="true" style={{ width: '5px', borderRadius: '2px', height: `${r.h}`, background: `${r.bg}` }}></span>
                          </Fragment>))}
                        </div>
                      </td>
                    </tr>
                  </Fragment>))}
                </tbody>
              </table>
            </div>
            )}
            <p style={{ margin: '1rem 0 0', maxWidth: '62ch', textWrap: 'pretty', color: 'var(--dim,#a3bcb8)', fontSize: '0.9375rem' }}>A pooled figure reading <span style={{ color: 'var(--sand,#d9c9a3)' }}>Early</span> is real but below the display threshold; <span style={{ color: 'var(--alert,#f2a29b)' }}>not measured</span> means the reader could not reach the chain. Neither is a zero.</p>

            <section data-reveal aria-labelledby="ladder-title" style={{ marginTop: '3rem', display: 'grid', gap: '3rem', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,20rem),1fr))', alignItems: 'start' }}>
              <div>
                <p style={{ margin: '0 0 0.75rem', fontFamily: '\'Geist Mono\',monospace', fontSize: '0.8125rem', fontWeight: '500', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--sand,#d9c9a3)' }}>The withdrawal ladder</p>
                <h2 id="ladder-title" style={{ margin: '0', fontFamily: '\'Geist\',system-ui,sans-serif', fontWeight: '700', fontSize: '1.5rem', letterSpacing: '-0.03em' }}>Seven rungs, so <span style={{ background: 'linear-gradient(100deg,var(--crest,#8be3c6),var(--teal,#7fd8dd) 46%,var(--sand,#d9c9a3))', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', filter: 'drop-shadow(0 0 26px rgba(var(--crest-rgb,139,227,198),0.35))' }}>nobody waits</span></h2>
                <p style={{ margin: '1.125rem auto 0', maxWidth: '58ch', textAlign: 'center', fontSize: '0.9375rem', lineHeight: '1.65', color: 'var(--dim,#a3bcb8)', textWrap: 'pretty' }}>Stake is split across seven staggered positions so that at any point in the epoch cycle there is an unlocked rung to withdraw from. The cost of that convenience is precise and we publish it: the ladder captures about {capturePct} of the theoretical maximum yield instead of 100%.</p>
                <p style={{ margin: '1rem 0 0', maxWidth: '62ch', textWrap: 'pretty', color: 'var(--dim,#a3bcb8)', fontSize: '0.9375rem' }}>The {givenUpPct} we give up buys the sentence the whole product rests on: withdraw in full, any time, no notice.</p>
              </div>
              <div style={{ background: 'linear-gradient(180deg,rgba(var(--pa,20,52,62),0.78),rgba(var(--pb,9,32,42),0.88))', border: '1px solid rgba(var(--crest-rgb,139,227,198),0.14)', borderRadius: '10px', boxShadow: 'inset 0 1px 0 rgba(var(--hi-rgb,220,233,230),0.07),0 14px 34px -26px rgba(var(--shade-rgb,0,0,0),0.85)', padding: '1.75rem' }}>
                <div style={{ display: 'grid', gap: '0.625rem' }}>
                  {(ladder ?? []).map((l, i) => (<Fragment key={i}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.875rem' }}>
                      <span style={{ fontFamily: '\'Geist Mono\',monospace', fontSize: '0.8125rem', color: 'var(--dim,#a3bcb8)', width: '3.5rem', flexShrink: '0' }}>{l.name}</span>
                      <span style={{ flex: '1', height: '8px', borderRadius: '99px', background: 'var(--bg,#04161d)', border: '1px solid var(--line,#1c3d47)', overflow: 'hidden' }}><span aria-hidden="true" style={{ display: 'block', height: '100%', width: `${l.pct}`, background: `${l.bg}`, transition: 'width 0.7s cubic-bezier(.16,1,.3,1)' }}></span></span>
                      <span style={{ fontFamily: '\'Geist Mono\',monospace', fontVariantNumeric: 'tabular-nums', fontSize: '0.8125rem', color: `${l.color}`, width: '5.5rem', textAlign: 'right', flexShrink: '0' }}>{l.state}</span>
                    </div>
                  </Fragment>))}
                </div>
                <p style={{ margin: '1.5rem 0 0', fontFamily: '\'Geist Mono\',monospace', fontSize: '0.8125rem', color: 'var(--dim,#a3bcb8)' }}>{epochLabel}</p>
              </div>
            </section>

            <section data-reveal aria-labelledby="sim-title" style={{ marginTop: '3rem', background: 'linear-gradient(180deg,rgba(var(--pc,26,66,78),0.88),rgba(var(--pd,11,37,48),0.92))', border: '1px solid rgba(var(--crest-rgb,139,227,198),0.22)', borderTop: '2px solid var(--crest,#8be3c6)', borderRadius: '10px', boxShadow: 'inset 0 1px 0 rgba(var(--hi-rgb,220,233,230),0.08),0 30px 70px -46px rgba(var(--crest-rgb,139,227,198),0.55)', padding: '2rem' }}>
              <p style={{ margin: '0 0 0.75rem', fontFamily: '\'Geist Mono\',monospace', fontSize: '0.8125rem', fontWeight: '500', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--sand,#d9c9a3)' }}>Pool simulator</p>
              <h2 id="sim-title" style={{ margin: '0', fontFamily: '\'Geist\',system-ui,sans-serif', fontWeight: '700', fontSize: '1.5rem', letterSpacing: '-0.03em' }}>What your deposit does, and <span style={{ background: 'linear-gradient(100deg,var(--crest,#8be3c6),var(--teal,#7fd8dd) 46%,var(--sand,#d9c9a3))', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', filter: 'drop-shadow(0 0 26px rgba(var(--crest-rgb,139,227,198),0.35))' }}>what it costs you</span></h2>
              <div style={{ marginTop: '1.5rem', display: 'grid', gap: '1.5rem', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,13rem),1fr))' }}>
                <div>
                  <label htmlFor="simamt" style={{ display: 'block', fontFamily: '\'Geist Mono\',monospace', fontSize: '0.8125rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--dim,#a3bcb8)' }}>Amount</label>
                  <div style={{ marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <input id="simamt" type="number" min="0" step="100" value={simAmount} onChange={onSimAmount} style={{ width: '9rem', background: 'var(--bg,#04161d)', border: '1px solid var(--line,#1c3d47)', borderRadius: '10px', padding: '0.6rem 0.875rem', color: 'var(--ink,#dce9e6)', fontFamily: '\'Geist Mono\',monospace', fontVariantNumeric: 'tabular-nums', fontSize: '0.9375rem' }}/>
                    <span style={{ fontFamily: '\'Geist Mono\',monospace', fontSize: '0.8125rem', color: 'var(--dim,#a3bcb8)' }}>SUI</span>
                  </div>
                </div>
                <div>
                  <label htmlFor="simwho" style={{ display: 'block', fontFamily: '\'Geist Mono\',monospace', fontSize: '0.8125rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--dim,#a3bcb8)' }}>Behind</label>
                  <select id="simwho" value={simWho} onChange={onSimWho} style={{ marginTop: '0.5rem', width: '100%', background: 'var(--bg,#04161d)', border: '1px solid var(--line,#1c3d47)', borderRadius: '10px', padding: '0.6rem 0.875rem', color: 'var(--ink,#dce9e6)', fontFamily: '\'Geist Mono\',monospace', fontSize: '0.9375rem' }}>
                    {(simOptions ?? []).map((o, i) => (<Fragment key={i}>
                      <option value={o.value}>{o.label}</option>
                    </Fragment>))}
                  </select>
                </div>
                <div>
                  <p style={{ margin: '0', fontFamily: '\'Geist Mono\',monospace', fontSize: '0.8125rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--dim,#a3bcb8)' }}>Stays yours</p>
                  <p style={{ margin: '0.25rem 0 0', fontFamily: '\'Geist Mono\',monospace', fontVariantNumeric: 'tabular-nums', fontSize: '1.75rem', fontWeight: '500', color: 'var(--ink,#dce9e6)' }}>{simPrincipal}</p>
                </div>
              </div>
              <div style={{ marginTop: '1.75rem', display: 'grid', gap: '1rem' }}>
                {(simRows ?? []).map((row, i) => (<Fragment key={i}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem 1.5rem', alignItems: 'baseline', paddingBottom: '0.75rem', borderBottom: '1px solid var(--line,#1c3d47)' }}>
                    <span style={{ fontFamily: '\'Geist Mono\',monospace', fontSize: '0.8125rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--dim,#a3bcb8)', minWidth: '14rem' }}>{row.label}</span>
                    <span style={{ fontFamily: `${row.font}`, fontStyle: `${row.style}`, fontVariantNumeric: 'tabular-nums', fontSize: '0.9375rem', color: `${row.color}` }}>{row.value}</span>
                  </div>
                </Fragment>))}
              </div>
              <p style={{ margin: '1.5rem 0 0', maxWidth: '62ch', textWrap: 'pretty', color: 'var(--dim,#a3bcb8)', fontSize: '0.9375rem' }}>{simNote}</p>
            </section>

            {/*
              Where the yield goes, in the order the contract does it.

              Every step here is `credit_proceeds` and `compute_yield_split` in `stake_vault.move`,
              stated in the order those functions run. The order is the point: principal is taken
              out before anything is called yield, and the creator's share to depositors is carved
              out of what is left to the creator — never out of the platform's cut. A page that
              described this as "the platform shares some yield" would be describing a different
              contract.
            */}
            <section data-reveal aria-labelledby="share-title" style={{ marginTop: '3rem', background: 'linear-gradient(180deg,rgba(var(--pc,26,66,78),0.88),rgba(var(--pd,11,37,48),0.92))', border: '1px solid rgba(var(--crest-rgb,139,227,198),0.22)', borderTop: '2px solid var(--crest,#8be3c6)', borderRadius: '10px', boxShadow: 'inset 0 1px 0 rgba(var(--hi-rgb,220,233,230),0.08),0 30px 70px -46px rgba(var(--crest-rgb,139,227,198),0.55)', padding: '2rem' }}>
              <p style={{ margin: '0 0 0.75rem', fontFamily: '\'Geist Mono\',monospace', fontSize: '0.8125rem', fontWeight: '500', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--sand,#d9c9a3)' }}>The share a creator sets</p>
              <h2 id="share-title" style={{ margin: '0', fontFamily: '\'Geist\',system-ui,sans-serif', fontWeight: '700', fontSize: '1.5rem', letterSpacing: '-0.03em' }}>Some of the yield <span style={{ background: 'linear-gradient(100deg,var(--crest,#8be3c6),var(--teal,#7fd8dd) 46%,var(--sand,#d9c9a3))', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent', filter: 'drop-shadow(0 0 26px rgba(var(--crest-rgb,139,227,198),0.35))' }}>can come back to you</span></h2>
              <p style={{ margin: '1rem 0 0', maxWidth: '62ch', fontSize: '0.9375rem', lineHeight: '1.65', color: 'var(--ink-2,#b9cdc9)', textWrap: 'pretty' }}>A creator may set a share of their own yield to return to the people pooled behind them. Here is where every unit goes when a rung matures, in the order the contract does it.</p>
              <ol style={{ margin: '1.75rem 0 0', padding: '0', listStyle: 'none', display: 'grid', gap: '0.75rem', counterReset: 'step' }}>
                <li style={{ display: 'grid', gridTemplateColumns: '2rem 1fr', gap: '0 0.875rem', alignItems: 'start' }}>
                  <span aria-hidden="true" style={{ fontFamily: '\'Geist Mono\',monospace', fontSize: '0.8125rem', color: 'var(--crest,#8be3c6)', paddingTop: '0.15rem' }}>01</span>
                  <span>
                    <p style={{ margin: '0', fontSize: '0.9375rem', fontWeight: '600', color: 'var(--ink,#dce9e6)' }}>Your principal comes out first</p>
                    <p style={{ margin: '0.25rem 0 0', fontSize: '0.9375rem', lineHeight: '1.6', color: 'var(--ink-2,#b9cdc9)', textWrap: 'pretty' }}>Before anything is called yield. A rounding error can only ever shrink the yield; it can never reach the deposit.</p>
                  </span>
                </li>
                <li style={{ display: 'grid', gridTemplateColumns: '2rem 1fr', gap: '0 0.875rem', alignItems: 'start' }}>
                  <span aria-hidden="true" style={{ fontFamily: '\'Geist Mono\',monospace', fontSize: '0.8125rem', color: 'var(--crest,#8be3c6)', paddingTop: '0.15rem' }}>02</span>
                  <span>
                    <p style={{ margin: '0', fontSize: '0.9375rem', fontWeight: '600', color: 'var(--ink,#dce9e6)' }}>Then the platform fee, at the rate stamped into the vault</p>
                    <p style={{ margin: '0.25rem 0 0', fontSize: '0.9375rem', lineHeight: '1.6', color: 'var(--ink-2,#b9cdc9)', textWrap: 'pretty' }}>Taken from the yield, never the principal — and at the rate recorded when that vault opened, so a later rise cannot reach a vault that already exists.</p>
                  </span>
                </li>
                <li style={{ display: 'grid', gridTemplateColumns: '2rem 1fr', gap: '0 0.875rem', alignItems: 'start' }}>
                  <span aria-hidden="true" style={{ fontFamily: '\'Geist Mono\',monospace', fontSize: '0.8125rem', color: 'var(--crest,#8be3c6)', paddingTop: '0.15rem' }}>03</span>
                  <span>
                    <p style={{ margin: '0', fontSize: '0.9375rem', fontWeight: '600', color: 'var(--ink,#dce9e6)' }}>What remains is the creator&rsquo;s, and the share is carved out of it</p>
                    <p style={{ margin: '0.25rem 0 0', fontSize: '0.9375rem', lineHeight: '1.6', color: 'var(--ink-2,#b9cdc9)', textWrap: 'pretty' }}>Out of their money, never the platform&rsquo;s. A creator may set it to anything up to all of it — at 100% they keep none of their own yield.</p>
                  </span>
                </li>
                <li style={{ display: 'grid', gridTemplateColumns: '2rem 1fr', gap: '0 0.875rem', alignItems: 'start' }}>
                  <span aria-hidden="true" style={{ fontFamily: '\'Geist Mono\',monospace', fontSize: '0.8125rem', color: 'var(--crest,#8be3c6)', paddingTop: '0.15rem' }}>04</span>
                  <span>
                    <p style={{ margin: '0', fontSize: '0.9375rem', fontWeight: '600', color: 'var(--ink,#dce9e6)' }}>Your part accrues in proportion to what you deposited</p>
                    <p style={{ margin: '0.25rem 0 0', fontSize: '0.9375rem', lineHeight: '1.6', color: 'var(--ink-2,#b9cdc9)', textWrap: 'pretty' }}>Every harvest, against your own position — twice the deposit earns twice the share. It is held in a pool the contract pays out of.</p>
                  </span>
                </li>
                <li style={{ display: 'grid', gridTemplateColumns: '2rem 1fr', gap: '0 0.875rem', alignItems: 'start' }}>
                  <span aria-hidden="true" style={{ fontFamily: '\'Geist Mono\',monospace', fontSize: '0.8125rem', color: 'var(--crest,#8be3c6)', paddingTop: '0.15rem' }}>05</span>
                  <span>
                    <p style={{ margin: '0', fontSize: '0.9375rem', fontWeight: '600', color: 'var(--ink,#dce9e6)' }}>You claim it yourself</p>
                    <p style={{ margin: '0.25rem 0 0', fontSize: '0.9375rem', lineHeight: '1.6', color: 'var(--ink-2,#b9cdc9)', textWrap: 'pretty' }}>One transaction, whenever you like. Nobody releases it for you and nobody can withhold it — the pool pays against your position, not against anyone&rsquo;s approval.</p>
                  </span>
                </li>
              </ol>
              <p style={{ margin: '1.75rem 0 0', paddingTop: '1.25rem', borderTop: '1px solid rgba(var(--line-rgb,28,61,71),0.9)', maxWidth: '62ch', fontSize: '0.9375rem', lineHeight: '1.65', color: 'var(--ink-2,#b9cdc9)', textWrap: 'pretty' }}>A creator who sets a share is paying supporters out of their own earnings. What it buys is an audience that can back them at no cost to itself — which, for most creators, is nearly all of the audience. The number is on the vault object, public, so nobody has to be trusted to honour it.</p>
            </section>
          </div>
    </>
  );
}
