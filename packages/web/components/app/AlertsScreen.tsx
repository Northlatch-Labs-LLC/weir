'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { useState } from 'react';
import type { ReactNode } from 'react';
import NextLink from 'next/link';
import { ColumnHeader, EmptyState, ErrorState, Icon, type IconName } from '@projectx-social/ui';
import { AppFrame } from '@/components/app/AppFrame';

export type AlertTone = 'money' | 'agent' | 'plain';

export type AlertView = {
  id: string;
  tone: AlertTone;
  icon: IconName;
  text: string;
  detail?: string | undefined;
  when?: string | undefined;
};

const TONE: Readonly<Record<AlertTone, string>> = {
  money: 'var(--w-mint)',
  agent: 'var(--w-violet)',
  plain: 'var(--w-ink-9)',
};

type Filter = 'all' | 'money';

export function AlertsScreen({
  viewerAddress,
  viewerHandle,
  reader,
  alerts,
  truncated,
  failure,
  discovery,
}: {
  viewerAddress: string | null;
  viewerHandle: string | null;
  reader?: string | undefined;
  alerts: readonly AlertView[];
  truncated: boolean;
  failure?: string | undefined;
  discovery?: ReactNode;
}) {
  const [filter, setFilter] = useState<Filter>('all');

  const viewer =
    viewerAddress === null
      ? ({ signedIn: false } as const)
      : ({ signedIn: true, address: viewerAddress, handle: viewerHandle, displayName: viewerHandle } as const);

  const shown = filter === 'all' ? alerts : alerts.filter((a) => a.tone === 'money');

  const aside: ReactNode = (
    <>
      <section className="w-card">
        <h3>Where these come from</h3>
        <p>
          Payments are read back out of the settlement events the contract emits, so a payment that
          settled has a row here. Comments, follows and messages are recorded by this site.
        </p>
        <NextLink href="/earnings" className="w-btn w-btn--quiet" style={{ width: '100%' }}>
          Open earnings
        </NextLink>
      </section>

      <section className="w-card">
        <h3>Payments are ordered by checkpoint</h3>
        <p>
          A settlement event carries a checkpoint and no clock, so payments are placed against the
          checkpoint that is exact rather than against a time nobody recorded.
        </p>
      </section>

      <p style={{ margin: '4px 2px 0', fontFamily: 'var(--w-sans)', fontSize: 12, lineHeight: 1.7, color: 'var(--w-ink-6)' }}>
        <NextLink href="/purchases">Purchases</NextLink> · <NextLink href="/vault">Vault</NextLink> ·{' '}
        <NextLink href="/security">Security</NextLink> · Built on Sui
      </p>
    </>
  );

  return (
    <AppFrame
      viewer={viewer}
      reader={reader}
      aside={
        <>
          {aside}
          {discovery}
        </>
      }
    >
      <ColumnHeader title="Alerts" />

      {viewerAddress === null ? (
        <EmptyState
          fact="Sign in to see what happened."
          narrowedBy="Alerts are what settled to your address and what people did to your pages, so this needs to know which address is yours."
          action={
            <NextLink href="/signin" className="w-btn w-btn--primary">
              Sign in
            </NextLink>
          }
        />
      ) : failure !== undefined ? (
        <ErrorState
          cause={`Your alerts could not be read. ${failure}`}
          moneyState="Nothing was moved, and nothing was spent. Payments settle on chain whether or not this page can list them."
          next="Try again in a moment."
        />
      ) : (
        <>
          {/*
            The filter is a view of one list, not a second read — which is why it is a button rather
            than a link: nothing on the server changes when it is pressed.
          */}
          <div className="w-tabs" role="tablist" aria-label="Filter alerts">
            {(
              [
                { key: 'all', label: 'All' },
                { key: 'money', label: 'Money' },
              ] as ReadonlyArray<{ key: Filter; label: string }>
            ).map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={filter === t.key}
                aria-current={filter === t.key ? 'page' : undefined}
                className="w-tab"
                style={{ background: 'transparent', border: 0, cursor: 'pointer' }}
                onClick={() => setFilter(t.key)}
              >
                <span>{t.label}</span>
                <span className="w-tab__rule" />
              </button>
            ))}
          </div>

          {shown.length === 0 ? (
            filter === 'money' ? (
              <EmptyState
                fact="No money has settled to you yet."
                narrowedBy="This is the money filter. Comments, follows and messages are under All."
              />
            ) : (
              <EmptyState
                fact="Nothing has happened to you yet."
                narrowedBy="Payments, unlocks, follows and messages land here as they happen."
              />
            )
          ) : (
            shown.map((alert) => (
              <div
                key={alert.id}
                style={{
                  display: 'flex',
                  gap: 14,
                  padding: '16px 20px',
                  borderBottom: '1px solid var(--w-line)',
                }}
              >
                <span style={{ color: TONE[alert.tone], flexShrink: 0, marginTop: 1 }}>
                  <Icon name={alert.icon} size={20} strokeWidth={1.7} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontFamily: 'var(--w-sans)', fontSize: 15, lineHeight: 1.5, color: 'var(--w-ink-10)' }}>
                    {alert.text}
                  </p>
                  {alert.detail === undefined ? null : (
                    <p style={{ margin: '4px 0 0', fontFamily: 'var(--w-sans)', fontSize: 13, lineHeight: 1.5, color: 'var(--w-ink-7)' }}>
                      {alert.detail}
                    </p>
                  )}
                </div>
                {/* No time is drawn where none was recorded. */}
                {alert.when === undefined ? null : (
                  <span className="w-mono" style={{ fontSize: 12, color: 'var(--w-ink-6)', flexShrink: 0 }}>
                    {alert.when}
                  </span>
                )}
              </div>
            ))
          )}

          {truncated ? (
            <p
              style={{
                margin: '14px 20px 0',
                padding: '10px 14px',
                border: '1px solid var(--w-line-strong)',
                borderRadius: 'var(--w-r-md)',
                fontFamily: 'var(--w-sans)',
                fontSize: 13,
                lineHeight: 1.55,
                color: 'var(--w-ink-7)',
              }}
            >
              The walk over payment events stopped at its ceiling, so these are recent payments
              rather than all of them.
            </p>
          ) : null}

          <p
            style={{
              margin: '18px 20px 32px',
              fontFamily: 'var(--w-sans)',
              fontSize: 13,
              lineHeight: 1.65,
              color: 'var(--w-ink-6)',
              maxWidth: '58ch',
            }}
          >
            An amount appears only where its coin&rsquo;s scale was read. A row that names a payment
            without a figure is a payment whose denomination this page could not establish.
          </p>
        </>
      )}
    </AppFrame>
  );
}
