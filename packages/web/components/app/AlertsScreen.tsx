'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
/**
 * What happened while you were away, in the application frame.
 *
 * # This component reads nothing
 *
 * `/alerts` reads the chain and the store and hands this component rows that are already words. A
 * payment arrives here as text, not as a `bigint` and a decimals field, because deciding what a
 * figure means is the page's job and formatting one at a guessed scale is the specific bug that
 * showed a creator paid in a nine-decimal coin a figure a thousand times too large.
 *
 * # An empty list and a failed read are drawn differently
 *
 * `failure` is set when the feed could not be read at all. Then no list is drawn — not an empty
 * one. An empty inbox says nothing has happened to you, which is a claim a timed-out node has not
 * earned.
 *
 * # Kind reads as colour, and only where the data supports it
 *
 * Money is mint, a machine is violet, everything else is plain ink. There is no violet on this
 * screen today: `readNotifications` has no agent event kind, so nothing here can honestly claim
 * one. The tone travels with an icon and with words as well, so the meaning survives the colour
 * being invisible to the reader.
 */

import { useState } from 'react';
import type { ReactNode } from 'react';
import NextLink from 'next/link';
import { ColumnHeader, EmptyState, ErrorState, Icon, type IconName } from '@projectx-social/ui';
import { AppFrame } from '@/components/app/AppFrame';

/** Money, a machine, or neither. Never a guess: the page sets this from the event's own kind. */
export type AlertTone = 'money' | 'agent' | 'plain';

export type AlertView = {
  id: string;
  tone: AlertTone;
  icon: IconName;
  /** The lead line. Already formatted; this component adds no figures of its own. */
  text: string;
  /** The second line. Absent when there is nothing measured to say — never an empty string. */
  detail?: string | undefined;
  /**
   * How long ago, when the event has a clock.
   *
   * Payments do not have one. `PaymentSettled` carries a checkpoint and no time, and neither the
   * transaction nor its effects hold one either — so a payment row shows its checkpoint in `detail`
   * and no relative time at all, rather than a plausible-looking figure nobody measured.
   */
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
  /** True when the walk over payment events hit its ceiling. These are recent, not complete. */
  truncated: boolean;
  /** Set when the feed itself could not be read. Then no list is drawn. */
  failure?: string | undefined;
  /**
   * The discovery column, read on the server and handed down.
   *
   * A server component passed as a prop into a client one: this screen cannot read the store
   * itself, and the rail is the same rail every other wrapped route gets. Optional, so a test or a
   * caller without it renders the page's own cards and nothing else.
   */
  discovery?: ReactNode;
}) {
  const [filter, setFilter] = useState<Filter>('all');

  const viewer =
    viewerAddress === null
      ? ({ signedIn: false } as const)
      : ({ signedIn: true, address: viewerAddress, handle: viewerHandle, displayName: viewerHandle } as const);

  const shown = filter === 'all' ? alerts : alerts.filter((a) => a.tone === 'money');


  /*
    The page's own cards, and then the people.

    These four screens pass an `aside`, and an `aside` REPLACES the discovery column rather than
    joining it — so `/vault`, `/studio`, `/alerts` and `/messages` were the only wrapped routes with
    no faces on them at all, and 337 to 715 pixels of empty ground under one explanatory card. The
    discovery rail is read on the server and handed down as `discovery`, so it renders beneath the
    page's own cards instead of replacing them.
  */
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
