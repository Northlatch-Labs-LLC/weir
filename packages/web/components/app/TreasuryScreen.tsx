'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { useState, type ReactNode } from 'react';
import NextLink from 'next/link';
import { Avatar, ColumnHeader, EmptyState } from '@projectx-social/ui';
import { AppFrame } from '@/components/app/AppFrame';
import type { FigureState } from '@/components/app/ExploreScreen';

export interface TreasuryPoolRow {
  handle: string;
  address: string;
  displayName: string;
  pooled: string;
  pooledState: FigureState;
  yieldShare: string;
  yieldState: FigureState;
  validator: string;
  funded: readonly boolean[];
}

export interface LadderRungView {
  name: string;
  pct: string;
  state: 'open' | 'maturing' | 'unplaced';
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
  poolNote: string;
  ladder: readonly LadderRungView[];
  epochLabel: string;
  epochUnread: boolean;
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

      <p className="w-colnote">
        <span>“No pool open” means the creator has no vault. It is not a zero.</span>
      </p>

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

        <p
          className={epochUnread ? 'w-colnote w-colnote--bad' : 'w-colnote'}
          style={{ padding: '14px 0 0', borderBottom: 0 }}
        >
          <span>{epochLabel}</span>
        </p>
      </section>

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
