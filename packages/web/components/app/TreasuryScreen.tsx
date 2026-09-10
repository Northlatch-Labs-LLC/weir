'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude
/**
 * `/treasury` — where pooled SUI goes, in the application frame.
 *
 * # What this replaces
 *
 * `DesignTreasuries`: a 72rem centred band drawn in the retired teal system, rendered inside the
 * 640px column it was never laid out for. It carried 47 font sizes and six colours typed into the
 * elements, a five-column table that could only be reached by sideways scrolling, and initials in a
 * circle where the rest of the product draws an address-derived avatar. It was the most legacy page
 * left in the product by measurement, and it is the page a stranger reads to decide whether to put
 * money behind somebody.
 *
 * # Three states, kept as three
 *
 * A figure is measured, genuinely none, or unread, exactly as `/explore` keeps them — and the states
 * arrive from the server as states rather than as colours, so this file cannot lose the distinction
 * by picking a shade. "No pool open" is a fact about a creator. "Could not be read" is a fact about
 * us. They are never the same sentence and never the same typography.
 *
 * The ladder has the same rule one level down. A rung is open, maturing, or unplaced — unplaced
 * meaning the epoch could not be read — and an unplaced rung is never drawn as open. Telling
 * somebody a rung is liquid when it is not costs them a withdrawal they were counting on.
 *
 * # The simulator quotes no yield
 *
 * Deliberately. Staking returns vary by validator and by epoch and are not ours to promise. What the
 * contract does fix exactly is what comes back — all of the principal, on demand — so that is what
 * it states.
 */

import { useState, type ReactNode } from 'react';
import NextLink from 'next/link';
import { Avatar, ColumnHeader, EmptyState } from '@projectx-social/ui';
import { AppFrame } from '@/components/app/AppFrame';
import type { FigureState } from '@/components/app/ExploreScreen';

/** One creator's pool, already reduced to what can be shown. Nothing is computed here. */
export interface TreasuryPoolRow {
  handle: string;
  /** The on-chain address. What the avatar is derived from — never the handle. */
  address: string;
  displayName: string;
  pooled: string;
  pooledState: FigureState;
  yieldShare: string;
  yieldState: FigureState;
  /** Shortened, or the word for having none. Never an address this file trimmed. */
  validator: string;
  /** One entry per rung: true where this vault has actually funded that rung. */
  funded: readonly boolean[];
}

/** A rung of the withdrawal ladder. `unplaced` is the epoch unread, never a rung assumed shut. */
export interface LadderRungView {
  name: string;
  /** How far along the cycle this rung sits, as a CSS width. Derived from the contract's `RUNGS`. */
  pct: string;
  state: 'open' | 'maturing' | 'unplaced';
  /** `unlocked`, `maturing`, or the empty string when the position is unknown. */
  label: string;
}

function figureClass(state: FigureState): string {
  return state === 'measured' ? 'w-figure__value' : state === 'none' ? 'w-none' : 'w-unread';
}

function Figure({ label, value, state }: { label: string; value: string; state: FigureState }) {
  return (
    <div>
      <div className="w-figure__label">{label}</div>
      <div className={figureClass(state)}>{value}</div>
    </div>
  );
}

function Def({ k, children, tone }: { k: string; children: ReactNode; tone?: 'money' | 'said' | 'bad' }) {
  return (
    <div className="w-defs__row">
      <span className="w-defs__k">{k}</span>
      <span className={tone === undefined ? 'w-defs__v' : `w-defs__v w-defs__v--${tone}`}>{children}</span>
    </div>
  );
}

export function TreasuryScreen({
  viewerAddress,
  viewerHandle,
  reader,
  pools,
  poolNote,
  ladder,
  epochLabel,
  epochUnread,
  capturePct,
  rungCount,
}: {
  viewerAddress: string | null;
  viewerHandle: string | null;
  reader?: string | undefined;
  pools: readonly TreasuryPoolRow[];
  /** Why the figures are dashes, when they are. Said once for the whole list, never per cell. */
  poolNote: string;
  ladder: readonly LadderRungView[];
  epochLabel: string;
  /** True when the epoch itself could not be read, so no rung has a known position. */
  epochUnread: boolean;
  /** `LADDER_DEPTH / RUNGS` as a percentage. Read from the contract's constants, never typed. */
  capturePct: string;
  rungCount: number;
}) {
  const viewer =
    viewerAddress === null
      ? ({ signedIn: false } as const)
      : ({
          signedIn: true,
          address: viewerAddress,
          handle: viewerHandle,
          displayName: viewerHandle,
        } as const);

  const [amount, setAmount] = useState('500');
  const [who, setWho] = useState<'supporter' | 'creator'>('supporter');

  const typed = Number(amount);
  const valid = Number.isFinite(typed) && typed >= 0 && amount.trim() !== '';
  const sui = valid ? `${typed.toLocaleString(undefined, { maximumFractionDigits: 4 })} SUI` : '';

  /* The remainder the ladder gives up. Derived, so the two figures can never disagree. */
  const givenUpPct = `${(100 - Number(capturePct.replace('%', ''))).toFixed(1)}%`;

  const aside: ReactNode = (
    <section className="w-card w-card--money">
      <h3>What you keep</h3>
      <p>
        Your deposit is delegated, not spent. The staking yield goes to the creator; the principal is
        yours to withdraw in full, whenever you ask, with no notice.
      </p>
      <NextLink href="/vault" className="w-btn w-btn--quiet" style={{ width: '100%' }}>
        What you have backed
      </NextLink>
    </section>
  );

  return (
    <AppFrame viewer={viewer} reader={reader} aside={aside}>
      <ColumnHeader title="Treasury" sub="filled by yield alone" />

      <p className="w-lede">
        Pooled SUI is delegated to validators. The yield it earns flows into the treasury; the
        principal never does. The ladder below is why a withdrawal never waits on an epoch boundary,
        and why the capture is {capturePct} rather than 100%.
      </p>

      {/* --- the pools --- */}
      <p className="w-sect">The pools that fill it</p>

      {poolNote === '' ? null : (
        <p className="w-colnote w-colnote--bad">
          <span>{poolNote}</span>
        </p>
      )}

      {pools.length === 0 ? (
        <EmptyState
          fact="No pools are open yet."
          narrowedBy="The first creator to open one appears here, with what has been pooled behind them."
        />
      ) : (
        pools.map((pool) => (
          <div className="w-row" key={pool.handle}>
            <Avatar address={pool.address} size={44} />

            <div className="w-row__body">
              <div className="w-row__who">
                <NextLink href={`/c/${pool.handle}`} className="w-name">
                  {pool.displayName}
                </NextLink>
                <span className="w-handle">@{pool.handle}</span>
              </div>

              {/*
                A figure that could not be read is omitted here rather than printed as a dash.

                Not a softening of the rule — `poolNote` above states, once, which column could not
                be read. What this drops is the repetition: six creators times two figures printed
                the same rose dash twelve times down the page a stranger uses to decide whether
                money moves here, which reads as a broken product rather than as an index that was
                briefly unreachable. `none` still prints: that is the store answering, and the
                answer is worth showing.
              */}
              {pool.pooledState === 'unread' && pool.yieldState === 'unread' ? null : (
                <div className="w-figs">
                  {pool.pooledState === 'unread' ? null : (
                    <Figure label="Pooled behind them" value={pool.pooled} state={pool.pooledState} />
                  )}
                  {pool.yieldState === 'unread' ? null : (
                    <Figure label="Yield shared back" value={pool.yieldShare} state={pool.yieldState} />
                  )}
                </div>
              )}

              {pool.pooledState === 'unread' ? null : (
                <p className="w-row__meta">Validator {pool.validator}</p>
              )}
            </div>

            {/*
              This vault's rungs, and only where it has funded one.

              Drawn unconditionally, six creators with no pool got six identical rows of seven grey
              bars — a chart of nothing, repeated, beside the figures that already said "no pool
              open". Decorative where it does appear: the same information is in the figures, and a
              row of seven positions is not something a screen reader should read out.
            */}
            {pool.funded.some(Boolean) ? (
              <div className="w-bars" aria-hidden="true">
                {pool.funded.map((funded, index) => (
                  <span
                    key={index}
                    data-funded={funded ? 'true' : 'false'}
                    style={{ height: `${40 + ((index * 11) % 50)}%` }}
                  />
                ))}
              </div>
            ) : null}
          </div>
        ))
      )}

      {/*
        The legend, and it had gone stale within the same pass.

        It read "a dash is a figure that could not be read" — which was true of the version above
        that printed a dash per cell, and false the moment unread figures were omitted instead. A
        legend describing notation the page no longer uses is worse than none.
      */}
      <p className="w-colnote">
        <span>“No pool open” means the creator has no vault. It is not a zero.</span>
      </p>

      {/* --- the ladder --- */}
      <section className="w-block" aria-labelledby="ladder-title">
        <h2 id="ladder-title">{rungCount} rungs, so nobody waits</h2>
        <p className="w-block__sub">
          Stake is split across {rungCount} staggered positions, so at any point in the epoch cycle
          there is an unlocked rung to withdraw from. That costs {givenUpPct} of the theoretical
          maximum yield, and it buys the sentence the whole product rests on: withdraw in full, any
          time, no notice.
        </p>

        <div className="w-ladder">
          {ladder.map((rung) => (
            <div className="w-ladder__row" key={rung.name}>
              <span className="w-ladder__name">{rung.name}</span>
              <span className="w-ladder__track">
                <span
                  aria-hidden="true"
                  className={
                    rung.state === 'open'
                      ? 'w-ladder__fill w-ladder__fill--open'
                      : rung.state === 'unplaced'
                        ? 'w-ladder__fill w-ladder__fill--unplaced'
                        : 'w-ladder__fill'
                  }
                  style={{ width: rung.pct }}
                />
              </span>
              <span
                className={
                  rung.state === 'open' ? 'w-ladder__state w-ladder__state--open' : 'w-ladder__state'
                }
              >
                {rung.label}
              </span>
            </div>
          ))}
        </div>

        {/*
          Which rungs are open, or that nobody knows. `unread` is passed by the caller rather than
          sniffed from the sentence — a screen that reads a state out of prose is one rewording away
          from drawing an unplaced rung in the colour of an open one.
        */}
        <p
          className={epochUnread ? 'w-colnote w-colnote--bad' : 'w-colnote'}
          style={{ padding: '14px 0 0', borderBottom: 0 }}
        >
          <span>{epochLabel}</span>
        </p>
      </section>

      {/* --- the simulator --- */}
      <section className="w-block" aria-labelledby="sim-title">
        <h2 id="sim-title">What a deposit does, and what it costs</h2>

        <div
          style={{
            display: 'grid',
            gap: 16,
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 11rem), 1fr))',
            marginBottom: 18,
          }}
        >
          <div className="w-field">
            <label htmlFor="t-amount">Amount in SUI</label>
            <input
              id="t-amount"
              className="w-input"
              type="number"
              min="0"
              step="100"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="w-field">
            <label htmlFor="t-who">Reading this as</label>
            <select
              id="t-who"
              className="w-select"
              value={who}
              onChange={(e) => setWho(e.target.value === 'creator' ? 'creator' : 'supporter')}
            >
              <option value="supporter">Someone pooling</option>
              <option value="creator">A creator receiving</option>
            </select>
          </div>
        </div>

        {/*
          No yield figure, and that is the design rather than an omission. Returns vary by validator
          and by epoch. A number invented here would be exactly what the rest of this page argues
          against.
        */}
        <div className="w-defs">
          {valid ? (
            <>
              <Def k="You deposit">{sui}</Def>
              <Def k="You can withdraw" tone="money">
                all of it, any time
              </Def>
              <Def k="They receive" tone="said">
                the staking yield it earns
              </Def>
              <Def k="The ladder captures">{`${capturePct} of theoretical maximum`}</Def>
              <Def k="Functions that can move your principal" tone="money">
                0
              </Def>
            </>
          ) : (
            <Def k="Amount" tone="bad">
              not a number
            </Def>
          )}
        </div>

        <p className="w-block__sub" style={{ margin: '16px 0 0' }}>
          {who === 'creator'
            ? `You receive the staking yield on what your supporters pool. The ladder captures ${capturePct} of the theoretical maximum, which is the price of never making anybody wait.`
            : 'Your deposit is delegated, never spent. You give up the yield it would have earned you; you keep every unit of the principal, withdrawable in full with no notice.'}
        </p>
      </section>

      {/* --- where a harvested unit goes --- */}
      <section className="w-block" aria-labelledby="share-title">
        <h2 id="share-title">Some of the yield can come back to you</h2>
        <p className="w-block__sub">
          A creator may set a share of their own yield to return to the people backing them. Here is
          where every unit goes when a rung matures, in the order `credit_proceeds` and
          `compute_yield_split` run.
        </p>

        <ol className="w-order">
          <li>
            <span className="w-order__n" aria-hidden="true">
              01
            </span>
            <span>
              <p className="w-order__what">The principal comes out first</p>
              <p className="w-order__why">
                Before anything is called yield. A rounding error can only ever shrink the yield; it
                cannot reach the deposit.
              </p>
            </span>
          </li>
          <li>
            <span className="w-order__n" aria-hidden="true">
              02
            </span>
            <span>
              <p className="w-order__what">Then the platform fee, at the rate stamped into the vault</p>
              <p className="w-order__why">
                Taken from the yield, at the rate recorded when that vault opened. A later rise
                cannot reach a vault that already exists.
              </p>
            </span>
          </li>
          <li>
            <span className="w-order__n" aria-hidden="true">
              03
            </span>
            <span>
              <p className="w-order__what">What remains is the creator’s, and the share is carved out of it</p>
              <p className="w-order__why">
                Out of their earnings. A creator may set it to anything up to all of it; at 100% they
                keep none of their own yield.
              </p>
            </span>
          </li>
          <li>
            <span className="w-order__n" aria-hidden="true">
              04
            </span>
            <span>
              <p className="w-order__what">Your part accrues in proportion to what you deposited</p>
              <p className="w-order__why">
                Every harvest, against your own position: twice the deposit earns twice the share. It
                is held in a pool the contract pays out of.
              </p>
            </span>
          </li>
          <li>
            <span className="w-order__n" aria-hidden="true">
              05
            </span>
            <span>
              <p className="w-order__what">You claim it yourself</p>
              <p className="w-order__why">
                One transaction, whenever you like. The pool pays against your position.
              </p>
            </span>
          </li>
        </ol>

        <p className="w-block__sub" style={{ margin: '18px 0 0' }}>
          A creator who sets a share is paying supporters out of their own earnings, and what it buys
          them is an audience that can back them at no cost to itself. The rate is on the vault
          object, public, readable by anyone.
        </p>
      </section>
    </AppFrame>
  );
}
