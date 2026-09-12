'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import NextLink from 'next/link';
import { useState, type ReactNode } from 'react';
import { PageHead } from '@/components/app/PageHead';
import { useReveals } from '@/components/shell/use-reveals';

/* What sits in a creator's chest: a measured figure, a read that found nothing, no vault, or a read that failed. */
export type ChestPot =
  | { state: 'measured'; value: string; note: string }
  | { state: 'early'; note: string }
  | { state: 'no-vault'; note: string }
  | { state: 'unread'; why: string };

export interface ChestView {
  handle: string;
  name: string;
  icon: ReactNode;
  open: boolean;
  body: string;
  pot: ChestPot;
  split: string;
  note: string;
  giveLabel: string;
  href: string;
  amounts: readonly { label: string; sui: number }[];
}

const COMPARE_COLS = ['', 'Chest', 'Pool', 'Subscription'] as const;

export function ChestsScreen({ chests, feeBps }: { chests: readonly ChestView[]; feeBps: number | null }) {
  const [deposit, setDeposit] = useState('100');
  useReveals();

  const given = Number(deposit);
  const valid = Number.isFinite(given) && given >= 0;
  /* The fee is read from the Platform object. Until it answers, no figure is computed. */
  const net = !valid || feeBps === null ? null : Math.floor(given * (10000 - feeBps)) / 10000;
  const theyReceive = net === null ? null : `${net.toLocaleString(undefined, { maximumFractionDigits: 4 })} SUI`;
  const feeLabel = feeBps === null ? 'the platform fee' : `${(feeBps / 100).toFixed(2).replace(/\.?0+$/, '')}%`;

  return (
    <div className="w-doc">
      <PageHead
        title="Give a creator something"
        accent="outright."
        lede="A chest is a creator's donation box. You send any amount, once. It settles on chain through the same contract that handles a subscription, and the platform takes the same fee; the rest is the creator's, in the vault only they can open. It buys no access and it does not expire; it is simply theirs. A creator may offer perks to the people who give; those are the creator's own promise, kept by them. This is the one place on Weir where money leaves you for good. Everywhere else (a pool, the treasury) your principal stays yours. Here you are choosing to give it away, and we would rather say so than dress a donation up as an investment."
      />

      <div className="w-grid">
        {chests.map((c) => (
          <article key={c.handle} className="w-card" data-reveal>
            <div className="w-card__title-row">
              <h3>
                <span aria-hidden="true">{c.icon}</span>
                {c.name}
              </h3>
              <span className={c.open ? 'w-chip w-chip--money w-card__tag' : 'w-chip w-card__tag'}>{c.open ? 'open' : 'no vault'}</span>
            </div>
            <p>{c.body}</p>
            <p className="w-fact__label w-fact__label--after">In the chest</p>
            {c.pot.state === 'measured' ? (
              <>
                <p className="w-fact__value w-fact__value--strong">{c.pot.value}</p>
                <p className="w-fact__label">{c.pot.note}</p>
              </>
            ) : c.pot.state === 'unread' ? (
              <p className="w-fact__none" data-unavailable="true">{c.pot.why}</p>
            ) : (
              <p className="w-fact__none">{c.pot.note}</p>
            )}
            <p className="w-card__note w-card__note--after">{c.split}</p>
            <div className="w-amounts">
              {c.amounts.map((amt) => (
                <button key={amt.sui} type="button" className="w-btn w-btn--quiet w-btn--sm w-mono" onClick={() => setDeposit(String(amt.sui))}>
                  {amt.label}
                </button>
              ))}
            </div>
            <NextLink href={c.href} className="w-btn w-btn--primary w-btn--block">
              {c.giveLabel}
            </NextLink>
            <p className="w-card__note w-card__note--after">{c.note}</p>
          </article>
        ))}
      </div>

      <section className="w-doc__section" data-reveal aria-labelledby="ways-title">
        <p className="w-kicker">Before you give</p>
        <h2 id="ways-title">Three ways to back someone. Only one is a gift.</h2>
        <p className="w-doc__lede">If you would rather the money came back to you eventually, you want the pool, not a chest. Both support the same creator. Only one of them costs you the principal.</p>
        <div className="w-table__wrap">
          <table className="w-table">
            <thead>
              <tr>
                {COMPARE_COLS.map((h, i) => (
                  <th key={h === '' ? 'blank' : h} scope="col" className={i === 1 ? 'w-table__ours' : undefined}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                ['You get back', 'Creator perks, if offered; never the money', 'All of it, any time', 'Access while it runs'],
                ['They receive', `The amount, less ${feeLabel}`, 'The staking yield', `The price, less ${feeLabel}`],
                ['It expires', 'Never', 'Never', 'At the end of the term'],
                ['What you hold after', 'A record on chain', 'A pool deposit you own', 'An object in your wallet'],
              ].map((row) => (
                <tr key={row[0]}>
                  {row.map((cell, c) => (
                    <td key={COMPARE_COLS[c]} className={c === 1 ? 'w-table__ours' : undefined}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="w-doc__section" data-reveal aria-labelledby="how-title">
        <p className="w-kicker">What happens</p>
        <h2 id="how-title">One transaction, three effects.</h2>
        <ol className="w-order">
          {[
            { n: '1', t: 'You sign, once', b: 'Your wallet shows the amount and the gas before anything moves. Decline and nothing has happened: no pending state, no partial charge.' },
            { n: '2', t: 'The split is computed', b: `The contract takes ${feeLabel} at settlement and the rest goes to the creator's address in the same transaction. There is no payout step and nothing waits in an account we hold.` },
            { n: '3', t: 'It is on chain, permanently', b: 'The transfer is public and readable by anyone, including you, forever. Nothing about it can be reversed by us, by them, or by you.' },
          ].map((s) => (
            <li key={s.n}>
              <span className="w-order__n" aria-hidden="true">{s.n}</span>
              <span>
                <p className="w-order__what">{s.t}</p>
                <p className="w-order__why">{s.b}</p>
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section className="w-doc__section w-card w-card--ours" data-reveal aria-labelledby="standing-title">
        <p className="w-kicker">What a donation is</p>
        <h2 id="standing-title">A gift, priced honestly</h2>
        <p>Want the money back eventually? Pool it into the treasury instead: the yield supports them and the principal stays yours. A chest is for when you would rather just hand it over.</p>
        <div className="w-facts--grid">
          <div className="w-field">
            <label htmlFor="chestdep">You give</label>
            <div className="w-amount">
              <input id="chestdep" className="w-input" type="number" min="0" step="50" value={deposit} onChange={(e) => setDeposit(e.target.value)} />
              <span>SUI</span>
            </div>
          </div>
          <div>
            <p className="w-fact__label">They receive</p>
            {theyReceive === null ? (
              <p className="w-fact__none" data-unavailable="true">reading from the chain</p>
            ) : (
              <p className="w-fact__value w-fact__value--good">{theyReceive}</p>
            )}
          </div>
          <div>
            <p className="w-fact__label">You get back</p>
            <p className="w-fact__none">never the money; the creator&apos;s perks, if they offer any</p>
          </div>
        </div>
        {feeBps !== null && <progress className="w-meter" aria-hidden="true" value={10000 - feeBps} max={10000} />}
        <p className="w-card__note w-card__note--after">
          {feeBps === null
            ? 'The platform fee is being read from the chain. This figure appears once it answers, and it is never an estimate.'
            : 'The transfer is one transaction between two addresses, and you can read it on chain afterwards.'}
        </p>
        <div className="w-actions">
          <NextLink href="/treasury" className="w-btn w-btn--primary">
            Pool into the treasury instead
          </NextLink>
          <NextLink href="/explore" className="w-btn w-btn--quiet">
            Browse creators
          </NextLink>
        </div>
      </section>
    </div>
  );
}
