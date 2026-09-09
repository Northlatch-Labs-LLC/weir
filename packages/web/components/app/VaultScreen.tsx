'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude
/**
 * Your money.
 *
 * The product's central claim is that backing somebody costs you nothing — your SUI stays yours,
 * it earns while it sits behind them, the earnings are theirs, and the principal comes back
 * whenever you ask. This is the page where that stops being a claim and becomes a figure you can
 * look at. Until now it existed nowhere: a reader who had backed three creators had to visit each
 * of them in turn and remember.
 *
 * # Every number here is read, or says it was not
 *
 * A failed read renders as a refusal with what it cost stated — never as a zero. Telling somebody
 * their money is not there because a node timed out is the worst thing this page could do, and it
 * is the specific failure the whole `Reading<T>` discipline exists to prevent.
 */

import type { ReactNode } from 'react';
import NextLink from 'next/link';
import { Avatar, ColumnHeader, EmptyState, ErrorState, Icon } from '@projectx-social/ui';
import { AppFrame } from '@/components/app/AppFrame';

export type BackingRowView = {
  vaultId: string;
  creator: string;
  handle: string | null;
  /** Formatted for reading; the raw MIST sits beside it for anyone checking an explorer. */
  principal: string;
  principalMist: string;
  rebate: string | null;
  pendingRebate: string | null;
  accepting: boolean;
};

export function VaultScreen({
  viewerAddress,
  viewerHandle,
  reader,
  rows,
  total,
  totalPending,
  truncated,
  unreadable,
  failure,
  ownVaultId,
}: {
  viewerAddress: string | null;
  viewerHandle: string | null;
  reader?: string | undefined;
  rows: readonly BackingRowView[];
  total: string | null;
  totalPending: string | null;
  truncated: boolean;
  unreadable: number;
  /** Set when the index itself could not be read. Then nothing below is shown as a figure. */
  failure?: string | undefined;
  /** The support vault this address owns, when it owns one. */
  ownVaultId?: string | null;
}) {
  const viewer =
    viewerAddress === null
      ? ({ signedIn: false } as const)
      : ({ signedIn: true, address: viewerAddress, handle: viewerHandle, displayName: viewerHandle } as const);

  const aside: ReactNode = (
    <>
      <section className="w-card">
        <h3>What being a member is</h3>
        <p>
          You put SUI behind someone. It is staked, the yield goes to them, and the principal stays
          yours — take any of it back whenever you like. Some creators hand a share of the yield
          back to the people who are members.
        </p>
        <NextLink href="/explore" className="w-btn w-btn--quiet" style={{ width: '100%' }}>
          Find someone to back
        </NextLink>
      </section>

      {ownVaultId === undefined || ownVaultId === null ? null : (
        <section className="w-card">
          <h3>Your own support vault</h3>
          <p>The vault your members keep SUI in, with its ladder and its harvests.</p>
          <NextLink href={`/vault/${ownVaultId}`} className="w-btn w-btn--quiet" style={{ width: '100%' }}>
            Open it
          </NextLink>
        </section>
      )}

    </>
  );

  return (
    <AppFrame viewer={viewer} reader={reader} aside={aside}>
      <ColumnHeader title="Vault" sub="your money" />

      {viewerAddress === null ? (
        <EmptyState
          fact="Sign in to see what you have backed."
          narrowedBy="Your positions are objects your address owns, so this page needs to know which address is yours."
          action={
            <NextLink href="/signin" className="w-btn w-btn--primary">
              Sign in
            </NextLink>
          }
        />
      ) : failure !== undefined ? (
        <ErrorState
          cause={`The index of vaults could not be read. ${failure}`}
          moneyState="Nothing was moved, and nothing was spent. Your positions are objects on chain and are unaffected by this page failing to read them."
          next="Try again in a moment."
        />
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12, padding: '20px 22px' }}>
            <div className="w-card">
              <div className="w-figure__label">Yours, in their vaults</div>
              <div className="w-figure__value">{total ?? '—'}</div>
              <div className="w-figure__note">withdraw any of it, any time</div>
            </div>
            <div className="w-card">
              <div className="w-figure__label">Rebate waiting for you</div>
              <div className="w-figure__value w-figure__value--money">{totalPending ?? '—'}</div>
              <div className="w-figure__note">accrued and unclaimed, as of each vault&rsquo;s last write</div>
            </div>
          </div>

          {truncated ? (
            <p
              style={{
                margin: '0 22px 12px',
                padding: '10px 14px',
                border: '1px solid rgba(255,138,160,0.35)',
                borderRadius: 'var(--w-r-md)',
                fontFamily: 'var(--w-sans)',
                fontSize: 13,
                lineHeight: 1.55,
                color: 'var(--w-rose)',
              }}
            >
              The walk over vault-opening events hit its ceiling, so this is some of what you have
              backed rather than all of it. The total above is a floor, not a balance.
            </p>
          ) : null}

          {unreadable > 0 ? (
            <p style={{ margin: '0 22px 12px', fontFamily: 'var(--w-sans)', fontSize: 13, color: 'var(--w-ink-7)' }}>
              {unreadable} {unreadable === 1 ? 'vault' : 'vaults'} could not be read just now and{' '}
              {unreadable === 1 ? 'is' : 'are'} left out. Anything you hold in{' '}
              {unreadable === 1 ? 'it' : 'them'} is untouched.
            </p>
          ) : null}

          <div style={{ padding: '4px 22px 8px' }}>
            <h2 style={{ margin: 0, fontFamily: 'var(--w-sans)', fontSize: 15, fontWeight: 700, color: 'var(--w-ink-10)' }}>
              Who you are a member of
            </h2>
          </div>

          {rows.length === 0 ? (
            <EmptyState
              fact="You have not backed anyone yet."
              narrowedBy="Being a member costs nothing but the time your money spends there."
              action={
                <NextLink href="/explore" className="w-btn w-btn--primary">
                  Find someone to back
                </NextLink>
              }
            />
          ) : (
            rows.map((row) => (
              <div
                key={row.vaultId}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 13,
                  padding: '15px 22px',
                  borderBottom: '1px solid var(--w-line)',
                  flexWrap: 'wrap',
                }}
              >
                <Avatar address={row.creator} size={44} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    {row.handle === null ? (
                      <span className="w-mono" style={{ fontSize: 14, color: 'var(--w-ink-9)' }}>
                        {row.creator.slice(0, 6)}…{row.creator.slice(-4)}
                      </span>
                    ) : (
                      <NextLink href={`/c/${row.handle}`} className="w-name">
                        @{row.handle}
                      </NextLink>
                    )}
                    {row.accepting ? null : <span className="w-chip">Closed to new deposits</span>}
                  </div>
                  <p style={{ margin: '3px 0 0', fontFamily: 'var(--w-sans)', fontSize: 13, color: 'var(--w-ink-7)' }}>
                    {row.rebate === null
                      ? 'Rebate not read'
                      : row.rebate === '0%'
                        ? 'No rebate'
                        : `${row.rebate} of the yield comes back to you`}
                    {row.pendingRebate === null || row.pendingRebate === '0 SUI'
                      ? ''
                      : ` · ${row.pendingRebate} waiting`}
                  </p>
                </div>
                <span className="w-mono" style={{ fontSize: 17, fontWeight: 600, color: 'var(--w-ink-10)' }}>
                  {row.principal}
                </span>
                <NextLink href={`/vault/${row.vaultId}`} className="w-btn w-btn--quiet w-btn--sm">
                  <Icon name="arrow" size={16} /> Manage
                </NextLink>
              </div>
            ))
          )}

          <p
            style={{
              margin: '18px 22px 32px',
              fontFamily: 'var(--w-sans)',
              fontSize: 13,
              lineHeight: 1.65,
              color: 'var(--w-ink-6)',
              maxWidth: '58ch',
            }}
          >
            Every figure on this page is read from the chain when you load it. Your principal is
            redeemable one for one — that is what the contract asserts, not a promise this page
            makes.
          </p>
        </>
      )}
    </AppFrame>
  );
}
