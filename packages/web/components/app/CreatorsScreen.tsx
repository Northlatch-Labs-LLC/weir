'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { useState, type ChangeEvent, type ReactNode } from 'react';
import NextLink from 'next/link';
import { ColumnHeader, EmptyState } from '@projectx-social/ui';
import { AppFrame } from '@/components/app/AppFrame';
import { useHandleAvailability } from '@/components/design/use-handle-availability';
import { handleShapeProblem } from '@/lib/waitlist';

const FIELD: React.CSSProperties = {
  background: 'var(--w-ground)',
  border: '1px solid var(--w-line)',
  borderRadius: 'var(--w-r-md)',
  color: 'var(--w-ink-10)',
  fontFamily: 'var(--w-mono)',
  fontSize: 15,
  minHeight: 44,
  padding: '0 14px',
};

const SECTION: React.CSSProperties = {
  padding: '20px 22px',
  borderBottom: '1px solid var(--w-line)',
};

const LABEL: React.CSSProperties = {
  display: 'block',
  fontFamily: 'var(--w-mono)',
  fontSize: 12,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--w-ink-7)',
};

const NOTE: React.CSSProperties = {
  margin: '10px 0 0',
  maxWidth: '58ch',
  fontFamily: 'var(--w-sans)',
  fontSize: 14,
  lineHeight: 1.6,
  color: 'var(--w-ink-7)',
};

export function CreatorsScreen({
  viewerAddress,
  viewerHandle,
  reader,
  feeBps,
}: {
  viewerAddress: string | null;
  viewerHandle: string | null;
  reader?: string | undefined;
  feeBps: number | null;
}) {
  const [wanted, setWanted] = useState('');
  const [tierInput, setTierInput] = useState('10');
  const [share, setShare] = useState(15);

  const viewer =
    viewerAddress === null
      ? ({ signedIn: false } as const)
      : ({ signedIn: true, address: viewerAddress, handle: viewerHandle, displayName: viewerHandle } as const);

  const availability = useHandleAvailability(wanted);
  const shape = handleShapeProblem(wanted);
  const clean = wanted.trim().replace(/^@/, '').toLowerCase();

  const handleNote =
    clean === ''
      ? 'Three or more characters: lowercase letters, numbers and underscores.'
      : shape !== null
        ? shape
        : availability === 'checking'
          ? 'Checking the registry…'
          : availability === 'taken'
            ? `@${clean} is taken; it resolves to a page already on chain.`
            : availability === 'available'
              ? `@${clean} is free. It stays first-come until the transaction mints it.`
              : availability === 'unreadable'
                ? 'We could not reach the registry, so this is unchecked rather than free.'
                : '';
  const handleNoteColor =
    shape !== null || availability === 'taken'
      ? 'var(--w-rose)'
      : availability === 'unreadable'
        ? 'var(--w-ink-9)'
        : availability === 'available'
          ? 'var(--w-mint)'
          : 'var(--w-ink-7)';

  const feeLabel = feeBps === null ? 'a platform fee' : `${(feeBps / 100).toFixed(2).replace(/\.?0+$/, '')}%`;

  const tier = Number(tierInput);
  const keeps =
    !Number.isFinite(tier) || tier < 0
      ? 'not a number'
      : feeBps === null
        ? 'reading from the chain'
        : `${((tier * (10000 - feeBps)) / 10000).toFixed(4).replace(/\.?0+$/, '')} per period`;
  const keepsUnread = keeps === 'reading from the chain' || keeps === 'not a number';

  const shareNote =
    share === 0
      ? 'You keep all of it. Perfectly normal, and the number is public, so say why if you like.'
      : `You give your members back ${share}% of the yield their deposit generates for you; you keep ${100 - share}% as your own. The share is written on the vault object itself.`;

  const summary: ReadonlyArray<{ label: string; value: string; unread: boolean }> = [
    { label: 'Handle', value: clean === '' ? 'not set' : `@${clean}`, unread: false },
    {
      label: 'Monthly tier',
      value: Number.isFinite(tier) ? `${tier} USDC` : 'not a number',
      unread: !Number.isFinite(tier),
    },
    { label: 'You keep', value: `${keeps} (${feeLabel} at settlement)`, unread: keepsUnread },
    { label: 'Yield shared back', value: `${share}%`, unread: false },
    { label: 'Objects created', value: '1 tier object, 1 creator vault', unread: false },
  ];

  const aside: ReactNode = (
    <>
      {viewerAddress === null ? null : (
      <section className="w-card">
        <h3>{clean === '' ? 'Your page' : `weir.social/c/${clean}`}</h3>
        <p>Nothing has been sent. The next step is one transaction your wallet signs.</p>
        {summary.map((row) => (
          <div key={row.label} className="w-card__row" style={{ justifyContent: 'space-between' }}>
            <span style={{ fontFamily: 'var(--w-sans)', fontSize: 13, color: 'var(--w-ink-7)' }}>{row.label}</span>
            {row.unread ? (
              <span className="w-unread" style={{ fontSize: 13 }}>
                {row.value}
              </span>
            ) : (
              <span className="w-mono" style={{ fontSize: 12, color: 'var(--w-ink-9)' }}>
                {row.value}
              </span>
            )}
          </div>
        ))}
      </section>
      )}

      <section className="w-card">
        <h3>The share you can set</h3>
        <p>
          When a rung matures the deposit comes out first, then the platform fee. What is left is
          yours, and the share is taken from that. Each supporter&rsquo;s part accrues in proportion
          to what they deposited, and they claim it themselves.
        </p>
        <p>
          The number lives on the vault object where anyone can read it. Set it above zero and
          pooling behind you costs a supporter nothing they keep and pays them a little for staying
          — the part of an audience a subscription never reaches.
        </p>
        <NextLink href="/explore" className="w-btn w-btn--quiet" style={{ width: '100%' }}>
          See who is already here
        </NextLink>
      </section>

    </>
  );

  return (
    <AppFrame viewer={viewer} reader={reader} aside={aside}>
      <ColumnHeader title="Open a page" sub="two revenue lines, one page" />

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
        Subscriptions and unlocks settle on chain and {feeLabel} is taken at settlement. The pool
        costs your members nothing they keep, and it is the line that reaches the people who will
        never subscribe.
      </p>

      {viewerAddress === null ? (
        <EmptyState
          fact="Sign in to set your page up."
          narrowedBy="A page belongs to an address, not to an account we hold, so this needs to know which address is yours."
          action={
            <NextLink href="/signin" className="w-btn w-btn--primary">
              Sign in to start
            </NextLink>
          }
        />
      ) : (
        <>
          <div style={SECTION}>
            <label htmlFor="creators-handle" style={LABEL}>
              Handle
            </label>
            <div
              style={{
                marginTop: 8,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                ...FIELD,
              }}
            >
              <span style={{ fontFamily: 'var(--w-mono)', fontSize: 15, color: 'var(--w-ink-7)' }}>
                weir.social/c/
              </span>
              <input
                id="creators-handle"
                type="text"
                value={wanted}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setWanted(e.target.value)}
                placeholder="yourname"
                style={{
                  flex: 1,
                  minWidth: 0,
                  minHeight: 44,
                  background: 'transparent',
                  border: 0,
                  outline: 'none',
                  color: 'var(--w-ink-10)',
                  fontFamily: 'var(--w-mono)',
                  fontSize: 15,
                }}
              />
            </div>
            <p style={{ ...NOTE, color: handleNoteColor }}>{handleNote}</p>
          </div>

          <div style={SECTION}>
            <label htmlFor="creators-tier" style={LABEL}>
              Monthly tier
            </label>
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <input
                id="creators-tier"
                type="number"
                min="0"
                step="0.5"
                value={tierInput}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setTierInput(e.target.value)}
                style={{ ...FIELD, width: '9rem', fontVariantNumeric: 'tabular-nums' }}
              />
              <span style={{ fontFamily: 'var(--w-mono)', fontSize: 13, color: 'var(--w-ink-7)' }}>
                USDC · every 30 days
              </span>
            </div>
            <p style={NOTE}>
              You keep{' '}
              {keepsUnread ? (
                <span className="w-unread" style={{ fontSize: 14 }}>
                  {keeps}
                </span>
              ) : (
                <span className="w-mono" style={{ color: 'var(--w-ink-10)', fontWeight: 500 }}>
                  {keeps}
                </span>
              )}{' '}
              of every payment. The {feeLabel} is taken at settlement, in the same transaction,
              computed here with the integer maths the contract uses.
            </p>
          </div>

          <div style={SECTION}>
            <label htmlFor="creators-yield" style={LABEL}>
              Yield shared back to members
            </label>
            <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 16 }}>
              <input
                id="creators-yield"
                type="range"
                min="0"
                max="50"
                step="1"
                value={share}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setShare(Number(e.target.value))}
                style={{ flex: 1, minWidth: 0, minHeight: 44, accentColor: 'var(--w-mint)' }}
              />
              <span
                className="w-mono"
                style={{ fontSize: 24, fontWeight: 500, color: 'var(--w-ink-10)', minWidth: '4rem', textAlign: 'right' }}
              >
                {share}%
              </span>
            </div>
            <p style={NOTE}>{shareNote}</p>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 14,
              flexWrap: 'wrap',
              padding: '20px 22px',
              borderBottom: '1px solid var(--w-line)',
            }}
          >
            <p style={{ margin: 0, maxWidth: '36ch', fontFamily: 'var(--w-mono)', fontSize: 13, color: 'var(--w-ink-7)' }}>
              Creates a tier object and a vault owned by your address. One transaction, signed on the
              next screen.
            </p>
            <NextLink href="/join" className="w-btn w-btn--primary">
              Review and sign
            </NextLink>
          </div>
        </>
      )}
    </AppFrame>
  );
}
