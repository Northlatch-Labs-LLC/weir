'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
/**
 * The moment somebody pays.
 *
 * Every stage of the purchase is named on screen, in order, because the alternative — one spinner
 * from press to outcome — is where a buyer decides whether to trust the product. The stages are
 * real: `simulating` is a call to the chain, `awaiting-signature` is the wallet prompt, and the
 * digest shown afterwards is the transaction, not a receipt this server wrote about itself.
 *
 * # What is never claimed
 *
 * "Settled" is not printed from a 200. The submit route returning a digest means the node accepted
 * the transaction; whether the reader now holds the `Unlock` is decided by reading the chain, which
 * happens on the next load. So the last stage says exactly that and offers the reload.
 *
 * # Escape
 *
 * `Esc` closes, except while a signature is in flight — closing a dialog whose transaction is
 * already at the wallet does not cancel anything, it just takes away the only place the outcome was
 * going to appear.
 */

import { Avatar, Dialog, Icon } from '@projectx-social/ui';
import { SignIn } from '@/components/SignIn';
import { useUnlock } from '@/components/app/use-unlock';

export function UnlockDialog({
  vaultId,
  contentKey,
  expectedPrice,
  priceLabel,
  creatorHandle,
  creatorName,
  creatorAddress,
  creatorIsAgent,
  assets,
  onClose,
}: {
  vaultId: string;
  contentKey: string;
  expectedPrice: string;
  priceLabel: string;
  creatorHandle: string;
  creatorName: string;
  creatorAddress: string;
  creatorIsAgent: boolean;
  /** How many images are behind the lock, when the reader was told. Never guessed. */
  assets?: number | undefined;
  onClose: () => void;
}) {
  const { signer, stage, quote, blocked, digest, busy, error, simulate, signAndSubmit, cancel } = useUnlock({
    vaultId,
    contentKey,
    expectedPrice,
  });

  const signingInFlight = stage === 'submitting';

  /*
    Closing, with the one condition that matters.

    `Dialog` holds Escape, the scrim and the close control behind `busy`, so this is only reached
    when closing is actually allowed. The guard stays anyway: `onClose` is a prop, and a caller
    that ever renders this without `busy` should still not be able to drop a signature in flight.
  */
  const close = () => {
    if (signingInFlight) return;
    onClose();
  };

  const STAGE_NOTE: Record<string, string> = {
    idle: 'Nothing has been sent yet.',
    'signing-in': 'Sign in to buy this post.',
    simulating: 'Checking the price against the vault.',
    'awaiting-signature': 'Checked against the chain. Nothing signed yet.',
    submitting: 'Waiting for your wallet, then sending it.',
    submitted: 'Sent. The chain has it.',
    refused: 'This cannot go ahead.',
    failed: 'It did not go through.',
  };

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) close();
      }}
      title={`Unlock ${creatorName}'s post`}
      busy={signingInFlight}
    >
      <div className="w-dialog__who">
        <Avatar address={creatorAddress} isAgent={creatorIsAgent} size={44} />
        <span className="w-handle">
          @{creatorHandle}
          {assets === undefined ? '' : ` · ${assets} ${assets === 1 ? 'image' : 'images'}`}
        </span>
      </div>

        {stage === 'signing-in' ? (
          <>
            <p style={{ margin: '0 0 16px', fontFamily: 'var(--w-sans)', fontSize: 14, lineHeight: 1.6, color: 'var(--w-ink-9)' }}>
              {priceLabel} for this post, and it stays yours. Connect the wallet you want it to land in.
            </p>
            <SignIn compact />
          </>
        ) : stage === 'submitted' && digest !== null ? (
          <>
            <div
              style={{
                border: '1px solid rgba(140,247,198,0.35)',
                borderRadius: 'var(--w-r-lg)',
                background: 'rgba(140,247,198,0.06)',
                padding: '16px 18px',
              }}
            >
              <p style={{ margin: '0 0 10px', fontFamily: 'var(--w-sans)', fontSize: 14, lineHeight: 1.6, color: 'var(--w-ink-10)' }}>
                Sent, and the post is yours permanently — it lands in your wallet as an object you
                keep, not a row in our database.
              </p>
              <a
                href={`https://suiscan.xyz/mainnet/tx/${digest}`}
                target="_blank"
                rel="noreferrer"
                className="w-mono"
                style={{ fontSize: 12, color: 'var(--w-mint)' }}
              >
                {digest.slice(0, 18)}… <Icon name="external" size={16} />
              </a>
            </div>
            <p style={{ margin: '14px 0 0', fontFamily: 'var(--w-sans)', fontSize: 13, lineHeight: 1.6, color: 'var(--w-ink-7)' }}>
              Reload to read it. The page checks what your wallet holds on every load, so nothing
              here decides whether it opens.
            </p>
            <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
              <button type="button" className="w-btn w-btn--quiet" style={{ flex: 1 }} onClick={onClose}>
                Close
              </button>
              <button
                type="button"
                className="w-btn w-btn--primary"
                style={{ flex: 2 }}
                onClick={() => window.location.reload()}
              >
                Reload and read it
              </button>
            </div>
          </>
        ) : stage === 'refused' && blocked !== null ? (
          <>
            <p style={{ margin: '0 0 18px', fontFamily: 'var(--w-sans)', fontSize: 14, lineHeight: 1.65, color: 'var(--w-ink-9)' }}>
              {blocked.kind === 'no-account' ? (
                <>
                  Buying needs an account. It is free apart from gas. <a href="/join">Claim a handle</a>.
                </>
              ) : blocked.kind === 'self-payment' ? (
                'This is your own vault, so there is nothing to buy.'
              ) : blocked.kind === 'insufficient-balance' ? (
                <>
                  Your wallet holds {blocked.have}, and this costs {blocked.need}.{' '}
                  <a href="/add-funds">Add funds</a>, then try again.
                </>
              ) : blocked.kind === 'price-moved' ? (
                'The price changed after this page loaded. Reload to see the current price before buying.'
              ) : (
                'This post is not currently for sale.'
              )}
            </p>
            <p className="w-state__money" style={{ marginBottom: 18 }}>
              Nothing was spent.
            </p>
            <button type="button" className="w-btn w-btn--quiet" style={{ width: '100%' }} onClick={onClose}>
              Close
            </button>
          </>
        ) : (
          <>
            <div
              style={{
                border: '1px solid var(--w-line)',
                borderRadius: 'var(--w-r-lg)',
                background: 'var(--w-raised)',
                padding: '16px 18px',
                display: 'flex',
                flexDirection: 'column',
                gap: 11,
              }}
            >
              <Row label="Price" value={priceLabel} />
              {quote === null ? (
                <p style={{ margin: 0, fontFamily: 'var(--w-sans)', fontSize: 12, color: 'var(--w-ink-6)' }}>
                  What the creator and the platform each receive is read from the vault when the
                  price is checked, not assumed here.
                </p>
              ) : (
                <>
                  <Row label={`${creatorName} receives`} value={quote.creatorReceives} strong />
                  <Row label="Weir takes" value={quote.platformReceives} />
                </>
              )}
            </div>

            <p
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                margin: '16px 0 0',
                fontFamily: 'var(--w-mono)',
                fontSize: 12,
                letterSpacing: '0.02em',
                color: stage === 'failed' ? 'var(--w-rose)' : 'var(--w-ink-9)',
              }}
              role="status"
            >
              <span
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: 999,
                  flexShrink: 0,
                  background: stage === 'failed' ? 'var(--w-rose)' : 'var(--w-mint)',
                }}
              />
              {error ?? STAGE_NOTE[stage]}
            </p>

            <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
              <button
                type="button"
                className="w-btn w-btn--quiet"
                style={{ flex: 1 }}
                onClick={quote === null ? onClose : cancel}
                disabled={signingInFlight}
              >
                Cancel
              </button>
              <button
                type="button"
                className="w-btn w-btn--primary"
                style={{ flex: 2 }}
                disabled={busy || signer === null}
                onClick={quote === null ? () => void simulate() : () => void signAndSubmit()}
              >
                {stage === 'simulating'
                  ? 'Checking…'
                  : stage === 'submitting'
                    ? 'Confirming…'
                    : quote === null
                      ? `Unlock · ${priceLabel}`
                      : 'Sign and pay'}
              </button>
            </div>

            <p style={{ margin: '14px 0 0', fontFamily: 'var(--w-sans)', fontSize: 12, lineHeight: 1.6, color: 'var(--w-ink-6)', textAlign: 'center' }}>
              It settles in one transaction, from your wallet into {creatorName}&rsquo;s vault. The
              key opens against what your wallet holds.
            </p>
          </>
        )}
    </Dialog>
  );
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 16 }}>
      <span style={{ fontFamily: 'var(--w-sans)', fontSize: 13, color: strong ? 'var(--w-ink-10)' : 'var(--w-ink-7)' }}>
        {label}
      </span>
      <span
        className="w-mono"
        style={{ fontSize: strong ? 14 : 13, fontWeight: strong ? 600 : 400, color: strong ? 'var(--w-mint)' : 'var(--w-ink-9)' }}
      >
        {value}
      </span>
    </div>
  );
}
