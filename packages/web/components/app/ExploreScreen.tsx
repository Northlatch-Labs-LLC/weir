'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude
/**
 * The directory, in the application frame.
 *
 * Every account with a page here — people and declared agents alike — in one column, the way the
 * rest of the application reads. This replaces a full-width grid of cards that belonged to the
 * editorial site rather than to an application whose shell never leaves.
 *
 * # It reads nothing
 *
 * `app/explore/page.tsx` does the reading — the profile list, the agent register, the vault index —
 * and hands this component rows that already carry their own honesty. That is why the three-way
 * distinction below cannot be lost here: this file cannot compute a figure, only place one.
 *
 * # The three states of a figure, kept exactly
 *
 * - **measured** — read from the vault; mono, tabular, full ink.
 * - **none** — read, and genuinely nothing ("no pool open"); quieter, body face, never alarming.
 * - **unread** — we could not look; italic, alert colour, never shaped like a number.
 *
 * A creator with no vault is not a failure and must never render as one, and a vault we could not
 * read must never render as a zero. Those are two different sentences and they get two different
 * typographies.
 */

import type { ReactNode } from 'react';
import NextLink from 'next/link';
import { Avatar, AgentBadge, ColumnHeader, EmptyState, ErrorState } from '@projectx-social/ui';
import { AppFrame } from '@/components/app/AppFrame';
import { Freshness } from '@/components/design/Freshness';

/** How a figure was arrived at. Never inferred here — the page decides and this places it. */
export type FigureState = 'measured' | 'none' | 'unread';

export type ExploreRow = {
  handle: string;
  /** The on-chain address. What the avatar is derived from; never the handle. */
  address: string;
  displayName: string;
  bio: string;
  /**
   * True only where the register held a standing declaration. False covers both "the register
   * answered and there is none" and "the register could not be read" — neither of which is a claim
   * that this account is a person, and nothing here is ever marked one.
   */
  isAgent: boolean;
  pooled: string;
  pooledState: FigureState;
  yieldShare: string;
  yieldState: FigureState;
};

function figureClass(state: FigureState): string {
  return state === 'measured' ? 'w-figure__value' : state === 'none' ? 'w-none' : 'w-unread';
}

export function ExploreScreen({
  viewerAddress,
  viewerHandle,
  reader,
  rows,
  readAtMs,
  caveat,
  failure,
}: {
  viewerAddress: string | null;
  viewerHandle: string | null;
  reader?: string | undefined;
  rows: readonly ExploreRow[];
  /** When the count itself was arrived at, taken after every read resolved. */
  readAtMs: number;
  /** What was incomplete about the read, or the empty string when nothing was. */
  caveat: string;
  /** Set when the directory itself could not be read. Then no row is shown at all. */
  failure?: string | undefined;
}) {
  const viewer =
    viewerAddress === null
      ? ({ signedIn: false } as const)
      : ({ signedIn: true, address: viewerAddress, handle: viewerHandle, displayName: viewerHandle } as const);

  const aside: ReactNode = (
    <>
      <section className="w-card">
        <h3>What backing is</h3>
        <p>
          You put SUI behind someone. It is staked, the yield goes to them, and the principal stays
          yours — take any of it back whenever you like. Some creators hand a share of the yield
          back to the people pooled behind them.
        </p>
        <NextLink href="/vault" className="w-btn w-btn--quiet" style={{ width: '100%' }}>
          What you have backed
        </NextLink>
      </section>

      <p style={{ margin: '4px 2px 0', fontFamily: 'var(--w-sans)', fontSize: 12, lineHeight: 1.7, color: 'var(--w-ink-6)' }}>
        <NextLink href="/legal/terms">Terms</NextLink> · <NextLink href="/legal/privacy">Privacy</NextLink> ·{' '}
        <NextLink href="/security">Security</NextLink> · Built on Sui · 2.9% at settlement
      </p>
    </>
  );

  return (
    <AppFrame viewer={viewer} reader={reader} aside={aside}>
      <ColumnHeader title="Explore" sub="everyone with a page here" />

      <p
        style={{
          margin: 0,
          padding: '12px 22px',
          borderBottom: '1px solid var(--w-line)',
          fontFamily: 'var(--w-sans)',
          fontSize: 14,
          lineHeight: 1.6,
          color: 'var(--w-ink-7)',
          maxWidth: '62ch',
        }}
      >
        Every account with a page on Weir, people and declared agents alike. Open one to subscribe,
        unlock a post or tip. Some also keep a pool open, and some share part of its yield back.
      </p>

      {failure !== undefined ? (
        <ErrorState
          cause={`The directory could not be read. ${failure}`}
          moneyState="Nothing was moved, and nothing was spent. Every page and every vault is on chain and is unaffected by this list failing to load."
          next="Try again in a moment."
        />
      ) : rows.length === 0 ? (
        <EmptyState fact="No creators yet. The first page opened here will appear in this list." />
      ) : (
        <>
          <p
            style={{
              margin: 0,
              padding: '10px 22px',
              borderBottom: '1px solid var(--w-line)',
              fontFamily: 'var(--w-mono)',
              fontSize: 12,
              color: 'var(--w-ink-7)',
            }}
          >
            {rows.length} creator{rows.length === 1 ? '' : 's'}, read from the store{' '}
            <Freshness atMs={readAtMs} />.{caveat}
          </p>

          {rows.map((row) => (
            <div
              key={row.handle}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 13,
                padding: '16px 22px',
                borderBottom: '1px solid var(--w-line)',
                flexWrap: 'wrap',
              }}
            >
              <Avatar address={row.address} isAgent={row.isAgent} size={44} />

              <div style={{ flex: 1, minWidth: '14rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                  <NextLink href={`/c/${row.handle}`} className="w-name" style={{ fontSize: 16 }}>
                    {row.displayName}
                  </NextLink>
                  {row.isAgent ? <AgentBadge /> : null}
                  <span className="w-handle">@{row.handle}</span>
                </div>

                {row.bio === '' ? null : (
                  <p
                    style={{
                      margin: '4px 0 0',
                      maxWidth: '58ch',
                      fontFamily: 'var(--w-sans)',
                      fontSize: 14,
                      lineHeight: 1.55,
                      color: 'var(--w-ink-7)',
                    }}
                  >
                    {row.bio}
                  </p>
                )}

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                    gap: 12,
                    marginTop: 12,
                    maxWidth: '30rem',
                  }}
                >
                  <div>
                    <div className="w-figure__label">Pooled behind them</div>
                    <div className={figureClass(row.pooledState)} style={{ fontSize: 17 }}>
                      {row.pooled}
                    </div>
                  </div>
                  <div>
                    <div className="w-figure__label">Yield shared back</div>
                    <div className={figureClass(row.yieldState)} style={{ fontSize: 17 }}>
                      {row.yieldShare}
                    </div>
                  </div>
                </div>
              </div>

              <NextLink href={`/c/${row.handle}`} className="w-btn w-btn--quiet">
                Open page
              </NextLink>
            </div>
          ))}
        </>
      )}
    </AppFrame>
  );
}
