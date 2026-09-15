'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { useState } from 'react';
import { SignIn } from '@/components/SignIn';
import { DigestLine, MoneyDialog } from '@/components/app/MoneyDialog';
import { useCheckout } from '@/components/app/use-checkout';
import { formatPeriod, formatUnits, SUI_DECIMALS } from '@/lib/units';

interface Quote {
  bytes: string;
  gasMist: string;
  tierName: string;
  pricePerPeriod: string;
  periodMs: string;
  creatorReceives: string;
  platformReceives: string;
}

/*
  Joining a membership is a decision: one button on the tier, then the dialog with what the
  vault says the tier costs, what the creator receives, what Weir takes and the gas, then the one
  signature. The subscription lands in the reader's wallet as an object; nothing here renews it.
*/
export function SubscribeButton({
  vaultId,
  coinType,
  tierIndex,
  decimals,
  symbol,
}: {
  vaultId: string;
  coinType: string;
  tierIndex: number;
  decimals: number;
  symbol: string;
}) {
  const [open, setOpen] = useState(false);
  const checkout = useCheckout<Quote>();
  const amount = (raw: string) => `${formatUnits(BigInt(raw), decimals)} ${symbol}`;

  if (checkout.signer === null) {
    return (
      <div className="w-money">
        <SignIn compact />
      </div>
    );
  }

  const close = () => {
    setOpen(false);
    checkout.reset();
  };
  const quote = checkout.quote;

  return (
    <div className="w-money">
      <button
        type="button"
        className="w-btn w-btn--primary"
        data-testid="subscribe"
        onClick={() => {
          setOpen(true);
          void checkout.simulate('/api/checkout/subscribe', { vaultId, coinType, tierIndex });
        }}
      >
        Join
      </button>

      {open ? (
        <MoneyDialog
          title="Join this membership"
          stage={checkout.stage}
          error={checkout.error}
          blocked={checkout.blocked}
          signed={checkout.signed}
          facts={
            quote === null
              ? []
              : [
                  { label: 'Tier', value: quote.tierName },
                  { label: `Every ${formatPeriod(quote.periodMs)}`, value: amount(quote.pricePerPeriod), strong: true },
                  { label: 'The creator receives', value: amount(quote.creatorReceives) },
                  { label: 'Weir takes', value: amount(quote.platformReceives) },
                  { label: 'Gas', value: `${formatUnits(BigInt(quote.gasMist), SUI_DECIMALS)} SUI` },
                ]
          }
          factsNote={
            quote === null
              ? 'What the tier costs and what the creator receives are read from the vault when the price is checked, not assumed here.'
              : 'This is a payment. It is final and does not renew. The subscription ends when its period ends.'
          }
          stageNote={{ simulating: 'Checking the tier against the vault.' }}
          refusals={{
            'insufficient-balance':
              checkout.blocked?.kind === 'insufficient-balance' ? (
                <>
                  This costs {amount(checkout.blocked.need)} and you hold {amount(checkout.blocked.have)}.{' '}
                  <a href="/add-funds">Add funds</a>, then try again.
                </>
              ) : undefined,
            'self-payment': 'This is your own vault. The contract refuses a creator paying themselves.',
          }}
          primaryLabel={checkout.stage === 'submitting' ? 'Waiting for your wallet…' : 'Pay and join'}
          primaryDisabled={quote === null}
          onPrimary={() => void checkout.signAndSubmit()}
          onCancel={close}
          onClose={close}
          foot="It settles in one transaction, from your wallet into the creator’s vault."
          done={
            checkout.digest === null ? null : (
              <>
                <div className="w-dialog__done">
                  <p>You are a member.</p>
                  <p>
                    The <span className="w-mono">Subscription</span> object is in your wallet. It is what opens
                    subscriber posts; this site checks it on every read, and nothing here can revoke it.
                  </p>
                  <DigestLine digest={checkout.digest} />
                </div>
                <div className="w-dialog__actions">
                  <button type="button" className="w-btn w-btn--quiet" onClick={close}>
                    Close
                  </button>
                  <button type="button" className="w-btn w-btn--primary" onClick={() => window.location.reload()}>
                    Reload and read
                  </button>
                </div>
              </>
            )
          }
        />
      ) : null}
    </div>
  );
}
