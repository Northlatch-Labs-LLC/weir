'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude

/**
 * # One copy change, and it is not optional
 *
 * The design says a chest takes "no platform fee, because nothing was sold". That is not true of this
 * deployment: a chest is a tip, `prepareTip` returns `platformReceives`, and the fee comes off at
 * settlement like everywhere else. The words are corrected and the figure is read, because the page
 * two clicks away tells a sceptic to check us against the chain — and this is the claim they would
 * check first.
 *
 * Everything else is the designer's, including the line the whole screen turns on: this is the one
 * place on Weir where money leaves you for good, said plainly.
 */

import { PageHead } from '@/components/design/PageHead';
import { Fragment, useState, type ReactNode } from 'react';
import { useReveals } from '@/components/design/use-weir-line';

export interface DesignChest {
  name: string;
  icon: ReactNode;
  tag: string;
  tagColor: string;
  tagBorder: string;
  rule: string;
  body: string;
  pot: string;
  potFont: string;
  potSize: string;
  potStyle: string;
  potColor: string;
  /**
   * Where the figure above came from, in one line.
   *
   * Required rather than optional, so a caller cannot add a pot without saying how it was arrived
   * at. It carries the difference between the states that matter: "3 gifts from 2 people" is a
   * measured total, "no gifts yet — the log was read" is a measured zero, and a failure names what
   * could not be read. The figure alone cannot express that, and a reader deciding whether to give
   * is exactly the person who should not have to guess.
   */
  potNote: string;
  split: string;
  note: string;
  noteColor: string;
  giveLabel: string;
  href: string;
  amounts: readonly {
    label: string;
    /** The figure this chip prefills. Data, not a handler — see `chests-data.tsx`. */
    sui: number;
    bg: string;
    color: string;
    border: string;
  }[];
}

/** The comparison table's columns; the header row and each stacked cell's label read the same list. */
const COMPARE_COLS = ['', 'Chest', 'Pool', 'Subscription'] as const;

export function DesignChests({
  signedIn,
  myHandle,
  chests,
  feeBps,
}: {
  signedIn: boolean;
  myHandle: string | null;
  chests: readonly DesignChest[];
  /** Live, from the Platform object. Null when it could not be read. */
  feeBps: number | null;
}) {
  const [chestDeposit, setDeposit] = useState('100');
  const onChestDeposit = (e: React.ChangeEvent<HTMLInputElement>) => setDeposit(e.target.value);

  const given = Number(chestDeposit);
  const valid = Number.isFinite(given) && given >= 0;

  /*
    What they receive, after the fee that is actually taken.

    Rounded down, matching the contract's integer arithmetic — showing a supporter a figure a
    fraction higher than the chain will pay is a small lie that compounds across every tip.
  */
  const net =
    !valid || feeBps === null ? null : Math.floor(given * (10000 - feeBps)) / 10000;

  const chestWeight =
    net === null
      ? 'not measured'
      : `${net.toLocaleString(undefined, { maximumFractionDigits: 4 })} SUI`;
  /*
    The bar's own width, as a real percentage of the amount given.

    Not the same value as the sentence below it: this used to hand the bar's `width` a phrase
    like "after the 2.9% taken at settlement", which is not a length CSS can draw, so the bar
    never rendered — the fee note simply looked like an empty track. `null` when the fee itself
    could not be read, so the bar is withheld rather than drawn at a width nobody measured.
  */
  const chestWeightWidthPct =
    feeBps === null ? null : `${((10000 - feeBps) / 100).toFixed(2)}%`;
  /* The honest answer to "what do I get back", and the reason this screen exists. */
  const chestWithdrawable = "never the money; the creator's perks, if they offer any";
  /*
    The fee as a phrase, for the prose that has to name it.

    Derived from the same live read as every other figure on this page. When the read failed it says
    so in words rather than naming a rate — a sentence that reads "less 2.9%" when we could not
    confirm 2.9% is exactly the kind of confident wrong number `/security` invites people to catch.
  */
  const feeLabel =
    feeBps === null
      ? 'the platform fee'
      : `${(feeBps / 100).toFixed(2).replace(/\.?0+$/, '')}%`;

  const chestNote =
    feeBps === null
      ? 'The platform fee could not be read just now, so this figure is not measured rather than estimated.'
      : 'The transfer is one transaction between two addresses, and you can read it on chain afterwards.';

  /*
    Handlers are attached here, in the browser.

    The server supplies the chips as data; a function cannot cross that boundary. Clicking one only
    prefills the give box — the signature is asked for on the creator's own page.
  */
  const withHandlers = chests.map((chest) => ({
    ...chest,
    amounts: chest.amounts.map((amount) => ({
      ...amount,
      onClick: () => setDeposit(String(amount.sui)),
    })),
  }));

  /* The design marks sections `data-reveal`; without an observer they stay at opacity 0. */
  useReveals();

  return (
    <>
          <div className="weir-page" style={{ maxWidth: '72rem', marginInline: 'auto', padding: '3rem 1.5rem 4rem' }}>
            <PageHead
              centered
              kicker="Chests"
              title="Give a creator something"
              accent="outright."
              lede="A chest is a creator's donation box. You send any amount, once. It settles on chain through the same contract that handles a subscription, and the platform takes the same fee; the rest is the creator's, in the vault only they can open. It buys no access and it does not expire; it is simply theirs. A creator may offer perks to the people who give; those are the creator's own promise, kept by them. This is the one place on Weir where money leaves you for good. Everywhere else (a pool, the treasury) your principal stays yours. Here you are choosing to give it away, and we would rather say so than dress a donation up as an investment."
            />

            <div style={{ display: 'grid', gap: '1.5rem', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,19rem),1fr))' }}>
              {(withHandlers ?? []).map((c, i) => (<Fragment key={i}>
                <article className="dh-0b27bfb9" data-reveal style={{ position: 'relative', overflow: 'hidden', background: 'linear-gradient(180deg,rgba(var(--pa,20,52,62),0.78),rgba(var(--pb,9,32,42),0.88))', border: '1px solid rgba(var(--crest-rgb,139,227,198),0.14)', borderRadius: '10px', boxShadow: 'inset 0 1px 0 rgba(var(--hi-rgb,220,233,230),0.07),0 14px 34px -26px rgba(var(--shade-rgb,0,0,0),0.85)', padding: '1.5rem', transition: 'border-color 0.18s ease,transform 0.18s ease,box-shadow 0.18s ease' }}>
                  <span aria-hidden="true" style={{ position: 'absolute', inset: '0 0 auto 0', height: '2px', background: `${c.rule}` }}></span>
                  <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '0.75rem' }}>
                    <h3 style={{ margin: '0', display: 'flex', alignItems: 'center', gap: '0.55rem', fontFamily: '\'Geist\',sans-serif', fontWeight: '700', fontSize: '1.1875rem', letterSpacing: '-0.02em' }}><span style={{ color: 'var(--crest,#8be3c6)', display: 'inline-flex', animation: 'floatY 5s ease-in-out infinite' }}>{c.icon}</span>{c.name}</h3>
                    <span style={{ fontFamily: 'var(--weir-mono)', fontSize: '0.8125rem', letterSpacing: '0.06em', padding: '0.15rem 0.55rem', borderRadius: '99px', border: `1px solid ${c.tagBorder}`, color: `${c.tagColor}`, whiteSpace: 'nowrap' }}>{c.tag}</span>
                  </div>
                  <p style={{ margin: '0.75rem 0 0', color: 'var(--dim,#a3bcb8)', fontSize: '0.9375rem', maxWidth: '62ch', textWrap: 'pretty' }}>{c.body}</p>
                  {/*
                    No figure, no label, no note.

                    An empty `pot` is the page saying the totals could not be read — which it says
                    once, above the list. Drawing "IN THE CHEST / not measured / denied: …" on every
                    card said it six times in red on the one screen whose job is to make giving
                    somebody money feel like a thing that works.
                  */}
                  {c.pot === '' ? null : (
                    <>
                      <p style={{ margin: '1.5rem 0 0', fontFamily: 'var(--weir-mono)', fontSize: '0.8125rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--dim,#a3bcb8)' }}>In the chest</p>
                      <p style={{ margin: '0.25rem 0 0', fontFamily: `${c.potFont}`, fontSize: `${c.potSize}`, fontWeight: '500', fontStyle: `${c.potStyle}`, color: `${c.potColor}`, fontVariantNumeric: 'tabular-nums' }}>{c.pot}</p>
                      {c.potNote === '' ? null : (
                        <p style={{ margin: '0.2rem 0 0', fontFamily: 'var(--weir-mono)', fontSize: '0.75rem', letterSpacing: '0.04em', color: 'var(--dim,#a3bcb8)' }}>{c.potNote}</p>
                      )}
                    </>
                  )}
                  <p style={{ margin: '0.5rem 0 0', fontFamily: 'var(--weir-mono)', fontSize: '0.8125rem', color: 'var(--dim,#a3bcb8)' }}>{c.split}</p>
                  <div style={{ marginTop: '1.25rem', display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
                    {(c.amounts ?? []).map((amt, i) => (<Fragment key={i}>
                      <button type="button" onClick={amt.onClick} style={{ padding: '0.45rem 0.9rem', borderRadius: '99px', cursor: 'pointer', fontFamily: 'var(--weir-mono)', fontVariantNumeric: 'tabular-nums', fontSize: '0.8125rem', background: `${amt.bg}`, color: `${amt.color}`, border: `1px solid ${amt.border}`, transition: 'border-color 0.12s ease,color 0.12s ease,background-color 0.12s ease' }}>{amt.label}</button>
                    </Fragment>))}
                  </div>
                  <button className="dh-f2bac7c4" type="button" onClick={() => { window.location.href = c.href; }} style={{ marginTop: '1.25rem', width: '100%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', padding: '0.7rem 1.35rem', borderRadius: '10px', font: '600 0.9375rem \'Geist\',sans-serif', lineHeight: '1', background: 'var(--crest,#8be3c6)', color: 'var(--bg,#04161d)', border: '1px solid transparent', cursor: 'pointer', boxShadow: '0 0 22px -6px rgba(var(--crest-rgb,139,227,198),0.5)', transition: 'transform 0.12s ease,background-color 0.12s ease,box-shadow 0.18s ease' }}>{c.giveLabel}</button>
                  <p style={{ margin: '0.75rem 0 0', fontFamily: 'var(--weir-mono)', fontSize: '0.8125rem', color: `${c.noteColor}` }}>{c.note}</p>
                </article>
              </Fragment>))}
            </div>

            {/*
              The comparison, which the page could not do without.

              A chest is one of three ways to put money behind a creator here, and it is the only one
              that does not come back. Somebody landing on this page has no way to know that without
              visiting two other pages and holding both in their head. Every cell below is a fact
              this deployment can stand behind: the fee is the live one, the pool's principal is
              withdrawable because no deployed function moves it, and a subscription is an object
              in the buyer's wallet.
            */}
            <section data-reveal aria-labelledby="ways-title" style={{ marginTop: '3.5rem' }}>
              <p style={{ margin: '0 0 0.625rem', fontFamily: 'var(--weir-mono)', fontSize: '0.8125rem', fontWeight: '500', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--sand,#d9c9a3)' }}>Before you give</p>
              <h2 id="ways-title" style={{ margin: '0', fontFamily: '\'Geist\',system-ui,sans-serif', fontWeight: '700', fontSize: 'clamp(1.35rem,1.1rem + 0.8vw,1.75rem)', letterSpacing: '-0.03em' }}>Three ways to back someone. <span className="weir-owned">Only one is a gift.</span></h2>
              <p style={{ margin: '0.75rem 0 0', maxWidth: '62ch', color: 'var(--dim,#a3bcb8)', fontSize: '0.9375rem', textWrap: 'pretty' }}>If you would rather the money came back to you eventually, you want the pool, not a chest. Both support the same creator. Only one of them costs you the principal.</p>

              <div style={{ marginTop: '1.5rem', overflowX: 'auto', border: '1px solid var(--line,#1c3d47)', borderRadius: '10px' }}>
                <table className="weir-stack" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.9375rem', minWidth: '34rem' }}>
                  <thead>
                    <tr>
                      {COMPARE_COLS.map((h, i) => (
                        <th key={i} scope="col" style={{ textAlign: i === 0 ? 'left' : 'left', padding: '0.875rem 1rem', fontFamily: 'var(--weir-mono)', fontSize: '0.75rem', fontWeight: '500', letterSpacing: '0.12em', textTransform: 'uppercase', color: i === 1 ? 'var(--crest,#8be3c6)' : 'var(--sand,#d9c9a3)', borderBottom: '1px solid var(--line,#1c3d47)', background: i === 1 ? 'rgba(var(--crest-rgb,139,227,198),0.05)' : 'transparent' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ['You get back', 'Creator perks, if offered; never the money', 'All of it, any time', 'Access while it runs'],
                      ['They receive', `The amount, less ${feeLabel}`, 'The staking yield', `The price, less ${feeLabel}`],
                      ['It expires', 'Never', 'Never', 'At the end of the term'],
                      ['What you hold after', 'A record on chain', 'A pool deposit you own', 'An object in your wallet'],
                    ].map((row, r) => (
                      <tr key={r}>
                        {row.map((cell, c) => (
                          <td key={c} data-label={c === 0 ? undefined : COMPARE_COLS[c]} style={{ padding: '0.875rem 1rem', borderBottom: r === 3 ? 'none' : '1px solid rgba(var(--line-rgb,28,61,71),0.6)', color: c === 0 ? 'var(--dim,#a3bcb8)' : 'var(--ink-2,#b9cdc9)', fontFamily: c === 0 ? 'var(--weir-mono)' : 'inherit', fontSize: c === 0 ? '0.8125rem' : '0.9375rem', letterSpacing: c === 0 ? '0.04em' : 'normal', background: c === 1 ? 'rgba(var(--crest-rgb,139,227,198),0.05)' : 'transparent', whiteSpace: c === 0 ? 'nowrap' : 'normal' }}>{cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {/*
              What the transaction does, in the order it does it.

              Three steps because there are three, not because three is a pleasing number. Somebody
              about to sign something should be able to read what they are signing without leaving
              the page, and "it settles on chain" is not that.
            */}
            <section data-reveal aria-labelledby="how-title" style={{ marginTop: '3.5rem' }}>
              <p style={{ margin: '0 0 0.625rem', fontFamily: 'var(--weir-mono)', fontSize: '0.8125rem', fontWeight: '500', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--sand,#d9c9a3)' }}>What happens</p>
              <h2 id="how-title" style={{ margin: '0', fontFamily: '\'Geist\',system-ui,sans-serif', fontWeight: '700', fontSize: 'clamp(1.35rem,1.1rem + 0.8vw,1.75rem)', letterSpacing: '-0.03em' }}>One transaction, three effects.</h2>

              <ol style={{ margin: '1.5rem 0 0', padding: '0', listStyle: 'none', display: 'grid', gap: '1rem', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,15rem),1fr))' }}>
                {[
                  { n: '1', t: 'You sign, once', b: 'Your wallet shows the amount and the gas before anything moves. Decline and nothing has happened: no pending state, no partial charge.' },
                  { n: '2', t: 'The split is computed', b: `The contract takes ${feeLabel} at settlement and the rest goes to the creator's address in the same transaction. There is no payout step and nothing waits in an account we hold.` },
                  { n: '3', t: 'It is on chain, permanently', b: 'The transfer is public and readable by anyone, including you, forever. Nothing about it can be reversed by us, by them, or by you.' },
                ].map((s, i) => (
                  <li key={i} style={{ background: 'linear-gradient(180deg,rgba(var(--pa,20,52,62),0.6),rgba(var(--pb,9,32,42),0.8))', border: '1px solid var(--line,#1c3d47)', borderRadius: '10px', padding: '1.25rem' }}>
                    <span aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '1.75rem', height: '1.75rem', borderRadius: '8px', border: '1px solid rgba(var(--crest-rgb,139,227,198),0.35)', background: 'rgba(var(--crest-rgb,139,227,198),0.08)', fontFamily: 'var(--weir-mono)', fontSize: '0.8125rem', color: 'var(--crest,#8be3c6)' }}>{s.n}</span>
                    <h3 style={{ margin: '0.75rem 0 0', fontFamily: '\'Geist\',sans-serif', fontWeight: '600', fontSize: '1rem', letterSpacing: '-0.01em' }}>{s.t}</h3>
                    <p style={{ margin: '0.4rem 0 0', color: 'var(--dim,#a3bcb8)', fontSize: '0.9375rem', textWrap: 'pretty' }}>{s.b}</p>
                  </li>
                ))}
              </ol>
            </section>

            <section data-reveal aria-labelledby="standing-title" style={{ marginTop: '3rem', background: 'linear-gradient(180deg,rgba(var(--pc,26,66,78),0.88),rgba(var(--pd,11,37,48),0.92))', border: '1px solid rgba(var(--crest-rgb,139,227,198),0.22)', borderTop: '2px solid var(--crest,#8be3c6)', borderRadius: '10px', boxShadow: 'inset 0 1px 0 rgba(var(--hi-rgb,220,233,230),0.08),0 30px 70px -46px rgba(var(--crest-rgb,139,227,198),0.55)', padding: '2rem' }}>
              <p style={{ margin: '0 0 0.875rem', textAlign: 'center', fontFamily: 'var(--weir-mono)', fontSize: '0.8125rem', fontWeight: '500', letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--sand,#d9c9a3)' }}>What a donation is</p>
              <h2 id="standing-title" style={{ margin: '0', textAlign: 'center', fontFamily: '\'Geist\',system-ui,sans-serif', fontWeight: '700', fontSize: '1.5rem', letterSpacing: '-0.03em' }}>A gift, <span className="weir-owned">priced honestly</span></h2>
              <p style={{ margin: '0.75rem auto 0', maxWidth: '62ch', textAlign: 'center', textWrap: 'pretty', color: 'var(--dim,#a3bcb8)', fontSize: '0.9375rem' }}>Want the money back eventually? Pool it into the treasury instead: the yield supports them and the principal stays yours. A chest is for when you would rather just hand it over.</p>
              <div style={{ marginTop: '1.5rem', display: 'grid', gap: '1.5rem', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,14rem),1fr))', alignItems: 'end' }}>
                <div>
                  <label htmlFor="chestdep" style={{ display: 'block', fontFamily: 'var(--weir-mono)', fontSize: '0.8125rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--dim,#a3bcb8)' }}>You give</label>
                  <div style={{ marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <input id="chestdep" type="number" min="0" step="50" value={chestDeposit} onChange={onChestDeposit} style={{ width: '9rem', background: 'var(--bg,#04161d)', border: '1px solid var(--line,#1c3d47)', borderRadius: '10px', padding: '0.6rem 0.875rem', color: 'var(--ink,#dce9e6)', fontFamily: 'var(--weir-mono)', fontVariantNumeric: 'tabular-nums', fontSize: '0.9375rem' }}/>
                    <span style={{ fontFamily: 'var(--weir-mono)', fontSize: '0.8125rem', color: 'var(--dim,#a3bcb8)' }}>SUI</span>
                  </div>
                </div>
                <div>
                  <p style={{ margin: '0', fontFamily: 'var(--weir-mono)', fontSize: '0.8125rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--dim,#a3bcb8)' }}>They receive</p>
                  <p style={{ margin: '0.25rem 0 0', fontFamily: 'var(--weir-mono)', fontVariantNumeric: 'tabular-nums', fontSize: '1.75rem', fontWeight: '500', background: 'linear-gradient(100deg,var(--crest,#8be3c6),var(--teal,#7fd8dd))', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>{chestWeight}</p>
                </div>
                <div>
                  <p style={{ margin: '0', fontFamily: 'var(--weir-mono)', fontSize: '0.8125rem', letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--dim,#a3bcb8)' }}>You get back</p>
                  <p style={{ margin: '0.25rem 0 0', fontFamily: 'var(--weir-mono)', fontVariantNumeric: 'tabular-nums', fontSize: '1.75rem', fontWeight: '500', color: 'var(--ink,#dce9e6)' }}>{chestWithdrawable}</p>
                </div>
              </div>
              {chestWeightWidthPct !== null && (
                <div style={{ marginTop: '1.5rem', height: '8px', borderRadius: '99px', background: 'var(--bg,#04161d)', border: '1px solid var(--line,#1c3d47)', overflow: 'hidden' }}>
                  <span aria-hidden="true" style={{ display: 'block', height: '100%', width: chestWeightWidthPct, background: 'linear-gradient(100deg,var(--crest,#8be3c6),var(--teal,#7fd8dd))', transition: 'width 0.5s cubic-bezier(.16,1,.3,1)' }}></span>
                </div>
              )}
              <p style={{ margin: '1rem 0 0', maxWidth: '62ch', textWrap: 'pretty', color: 'var(--dim,#a3bcb8)', fontSize: '0.9375rem' }}>{chestNote}</p>
              <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginTop: '1.75rem' }}>
                <button className="dh-f2bac7c4" type="button" onClick={() => { window.location.href = '/treasury'; }} style={{ padding: '0.7rem 1.35rem', borderRadius: '10px', font: '600 0.9375rem \'Geist\',sans-serif', lineHeight: '1', background: 'var(--crest,#8be3c6)', color: 'var(--bg,#04161d)', border: '1px solid transparent', cursor: 'pointer', boxShadow: '0 0 22px -6px rgba(var(--crest-rgb,139,227,198),0.5)', transition: 'transform 0.12s ease,background-color 0.12s ease,box-shadow 0.18s ease' }}>Pool into the treasury instead</button>
                <button className="dh-f10f4630" type="button" onClick={() => { window.location.href = '/explore'; }} style={{ padding: '0.7rem 1.35rem', borderRadius: '10px', font: '600 0.9375rem \'Geist\',sans-serif', lineHeight: '1', border: '1px solid rgba(var(--crest-rgb,139,227,198),0.45)', background: 'rgba(var(--crest-rgb,139,227,198),0.06)', color: 'var(--ink,#dce9e6)', cursor: 'pointer', transition: 'transform 0.12s ease,border-color 0.12s ease,color 0.12s ease,background-color 0.12s ease' }}>Browse creators</button>
              </div>
            </section>
          </div>
    </>
  );
}
