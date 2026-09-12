'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import type { ReactNode } from 'react';
import { PageHead } from '@/components/app/PageHead';
import { useReveals } from '@/components/shell/use-reveals';
import { BUILT_ON } from '@/lib/built-on';

export interface Guarantee {
  icon: ReactNode;
  title: string;
  body: string;
  mechanism: string;
}
export interface OnlyChain {
  figure: string;
  title: string;
  body: string;
}
export interface CompareRow {
  icon: ReactNode;
  q: string;
  weir: string;
  patreon: string;
  of: string;
}
export interface CompareCard {
  name: string;
  ours: boolean;
  /* A figure that was read, or null when the chain has not answered yet. */
  figure: string | null;
  unread: string;
  note: string;
}
export interface ContractRow {
  name: string;
  icon: ReactNode;
  /* Present when the object id is known; absent means not published, never a placeholder. */
  id: string | null;
  what: string;
  href: string | undefined;
}

export function SecurityScreen({
  guarantees,
  onlyChain,
  cmpRows,
  cmpSummary,
  cmpSources,
  contracts,
}: {
  guarantees: readonly Guarantee[];
  onlyChain: readonly OnlyChain[];
  cmpRows: readonly CompareRow[];
  cmpSummary: readonly CompareCard[];
  cmpSources: readonly string[];
  contracts: readonly ContractRow[];
}) {
  useReveals();

  return (
    <div className="w-doc">
      <PageHead
        title="A policy can be revised."
        accent="A contract cannot."
        lede="Each guarantee below is a property of the contracts, with the mechanism that enforces it beside it. Not a padlock icon."
      />

      <div className="w-grid">
        {guarantees.map((g) => (
          <article key={g.title} className="w-card" data-reveal>
            <span className="w-guarantee__icon" aria-hidden="true">
              {g.icon}
            </span>
            <h3>{g.title}</h3>
            <p>{g.body}</p>
            <p className="w-guarantee__how">{g.mechanism}</p>
          </article>
        ))}
      </div>

      <section className="w-doc__section" data-reveal aria-labelledby="only-title">
        <p className="w-kicker">Why this cannot be copied</p>
        <h2 id="only-title">Three things only a chain can do</h2>
        <div className="w-grid">
          {onlyChain.map((o) => (
            <div key={o.title} className="w-card w-card--ours">
              <p className="w-big">{o.figure}</p>
              <h3>{o.title}</h3>
              <p>{o.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="w-doc__section" data-reveal aria-labelledby="cmp-title">
        <p className="w-kicker">Side by side</p>
        <h2 id="cmp-title">The same questions, asked of everyone</h2>
        <p className="w-doc__lede">
          Figures for the other platforms are their own published rates, dated at the foot of this section. Where a number is a range we print the range, not the flattering end of it.
        </p>
        <div className="w-grid">
          {cmpSummary.map((c) => (
            <article key={c.name} className={c.ours ? 'w-card w-card--ours' : 'w-card'}>
              <p className={c.ours ? 'w-kicker w-kicker--good' : 'w-kicker'}>{c.name}</p>
              {c.figure === null ? (
                <p className="w-big w-big--unread" data-unavailable="true">{c.unread}</p>
              ) : (
                <p className="w-big">{c.figure}</p>
              )}
              <p className="w-card__note">{c.note}</p>
            </article>
          ))}
        </div>
        <div className="w-form">
          {cmpRows.map((row) => (
            <article key={row.q} className="w-card">
              <h3>
                <span className="w-guarantee__icon" aria-hidden="true">
                  {row.icon}
                </span>{' '}
                {row.q}
              </h3>
              <div className="w-cmp">
                <div className="w-cmp__cell w-cmp__cell--ours">
                  <p className="w-kicker w-kicker--good">Weir</p>
                  <p>{row.weir}</p>
                </div>
                <div className="w-cmp__cell">
                  <p className="w-kicker">Patreon</p>
                  <p>{row.patreon}</p>
                </div>
                <div className="w-cmp__cell">
                  <p className="w-kicker">OnlyFans</p>
                  <p>{row.of}</p>
                </div>
              </div>
            </article>
          ))}
        </div>
        <section className="w-card" aria-label="Sources">
          <p className="w-kicker">Sources</p>
          <ul className="w-list">
            {cmpSources.map((src) => (
              <li key={src} className="w-card__note">
                {src}
              </li>
            ))}
          </ul>
        </section>
      </section>

      <section className="w-doc__section" data-reveal aria-labelledby="pub-title">
        <p className="w-kicker">Published on chain</p>
        <h2 id="pub-title">Read the contracts yourself</h2>
        <p className="w-doc__lede">
          Every claim on this page is enforced by code at one of these addresses. Copy an id, open it in an explorer, and check us. A slot reading <em>not published</em> is one we have not deployed yet, never a placeholder dressed as a live address.
        </p>
        <div className="w-form">
          {contracts.map((c) => {
            const present = c.id !== null && c.id !== '';
            return (
              <article key={c.name} className="w-card w-contract">
                <div>
                  <div className="w-contract__head">
                    <span className="w-guarantee__icon" aria-hidden="true">
                      {c.icon}
                    </span>
                    <h3>{c.name}</h3>
                    <span className={present ? 'w-chip w-chip--money' : 'w-chip'}>{present ? 'live' : 'not published'}</span>
                  </div>
                  <p className={present ? 'w-contract__id' : 'w-contract__id w-contract__id--none'}>{present ? c.id : 'not published'}</p>
                  <p className="w-card__note">{c.what}</p>
                </div>
                <div className="w-contract__actions">
                  <button
                    type="button"
                    className="w-btn w-btn--quiet w-btn--sm"
                    disabled={!present}
                    onClick={() => {
                      if (present && c.id !== null) void navigator.clipboard.writeText(c.id);
                    }}
                  >
                    {present ? 'Copy id' : 'Nothing to copy'}
                  </button>
                  {present && c.href !== undefined ? (
                    <a className="w-btn w-btn--quiet w-btn--sm" href={c.href} rel="noreferrer" target="_blank">
                      View on Suiscan
                    </a>
                  ) : (
                    <span className="w-card__note">Not published; set at deploy</span>
                  )}
                </div>
              </article>
            );
          })}
        </div>
        <p className="w-card__note w-card__note--after">
          Network: Sui mainnet. Module source is published with the package: an explorer will show you the bytecode and, where verification is available, the Move source that produced it. If a figure on this site disagrees with one of these objects, the object is right.
        </p>
      </section>

      <section className="w-doc__section" data-reveal aria-labelledby="built-title">
        <h2 id="built-title">What it runs on</h2>
        <ul className="w-built">
          {BUILT_ON.map((b) => (
            <li key={b.name}>
              <span className="w-built__mark" aria-hidden>
                {'logo' in b ? <img src={b.logo} alt="" width={20} height={20} /> : b.mark}
              </span>
              <span className="w-funnel__body">
                <a className="w-built__name" href={b.href} rel="noreferrer" target="_blank">
                  {b.name}
                </a>
                <span className="w-built__note">{b.note}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="w-doc__section" data-reveal aria-label="Back up your key">
        <div className="w-outcome w-outcome--bad">
          <p className="w-kicker w-kicker--bad">Back up your key</p>
          <p>Your key is the account. Keep a copy somewhere safe and offline. If it is lost there is no reset, here or anywhere else, because nobody else ever had it.</p>
        </div>
      </section>
    </div>
  );
}
