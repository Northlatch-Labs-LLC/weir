'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { DigestLine, MoneyDialog } from '@/components/app/MoneyDialog';
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
  assets?: number | undefined;
  onClose: () => void;
}) {
  const { stage, quote, blocked, digest, error, simulate, signAndSubmit, cancel } = useUnlock({
    vaultId,
    contentKey,
    expectedPrice,
  });

  return (
    <MoneyDialog
      title={`Unlock ${creatorName}'s post`}
      who={{
        address: creatorAddress,
        handle: creatorHandle,
        isAgent: creatorIsAgent,
        ...(assets === undefined ? {} : { meta: `${assets} ${assets === 1 ? 'image' : 'images'}` }),
      }}
      stage={stage}
      error={error}
      blocked={blocked}
      facts={
        quote === null
          ? [{ label: 'Price', value: priceLabel }]
          : [
              { label: 'Price', value: priceLabel },
              { label: `${creatorName} receives`, value: quote.creatorReceives, strong: true },
              { label: 'Weir takes', value: quote.platformReceives },
            ]
      }
      factsNote={
        quote === null
          ? 'What the creator and the platform each receive is read from the vault when the price is checked, not assumed here.'
          : undefined
      }
      stageNote={{
        'signing-in': 'Sign in to buy this post.',
        simulating: 'Checking the price against the vault.',
      }}
      signInLine={`${priceLabel} for this post, and it stays yours. Connect the wallet you want it to land in.`}
      refusals={{
        'no-account': (
          <>
            Buying needs an account. It is free apart from gas. <a href="/join">Create account</a>.
          </>
        ),
        'self-payment': 'This is your own vault, so there is nothing to buy.',
        'price-moved': 'The price changed after this page loaded. Reload to see the current price before buying.',
        'not-for-sale': 'This post is not currently for sale.',
      }}
      primaryLabel={
        stage === 'simulating'
          ? 'Checking…'
          : stage === 'submitting'
            ? 'Confirming…'
            : quote === null
              ? `Unlock · ${priceLabel}`
              : 'Sign and pay'
      }
      primaryDisabled={stage === 'simulating'}
      onPrimary={quote === null ? () => void simulate() : () => void signAndSubmit()}
      onCancel={quote === null ? onClose : cancel}
      onClose={onClose}
      foot={`It settles in one transaction, from your wallet into ${creatorName}’s vault. The key opens against what your wallet holds.`}
      done={
        digest === null ? null : (
          <>
            <div className="w-dialog__done">
              <p>
                Sent, and the post is yours permanently — it lands in your wallet as an object you
                keep, not a row in our database.
              </p>
              <DigestLine digest={digest} />
            </div>
            <p className="w-dialog__after">
              Reload to read it. The page checks what your wallet holds on every load, so nothing
              here decides whether it opens.
            </p>
            <div className="w-dialog__actions">
              <button type="button" className="w-btn w-btn--quiet" onClick={onClose}>
                Close
              </button>
              <button type="button" className="w-btn w-btn--primary" onClick={() => window.location.reload()}>
                Reload and read it
              </button>
            </div>
          </>
        )
      }
    />
  );
}
