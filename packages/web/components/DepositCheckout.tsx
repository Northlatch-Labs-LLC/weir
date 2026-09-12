'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { useState } from 'react';
import { SignIn } from '@/components/SignIn';
import { DigestLine, MoneyDialog } from '@/components/app/MoneyDialog';
import { useCheckout } from '@/components/app/use-checkout';
import { VAULT_DISCLOSURE_SHORT } from '@/lib/vault-disclosure';

const MIST_PER_SUI = 1_000_000_000n;

interface Quote {
  bytes: string;
  suiDeltaMist: string;
  gasMist: string;
  amountMist: string;
}

function sui(mist: bigint): string {
  const negative = mist < 0n;
  const abs = negative ? -mist : mist;
  const whole = abs / MIST_PER_SUI;
  const frac = (abs % MIST_PER_SUI).toString().padStart(9, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${frac === '' ? '' : `.${frac}`}`;
}

function toMist(input: string): bigint | null {
  const text = input.trim();
  if (!/^\d+(\.\d{1,9})?$/.test(text)) return null;
  const [whole, frac = ''] = text.split('.');
  return BigInt(whole + frac.padEnd(9, '0'));
}

/*
  A deposit is a decision: the amount is typed on the page, and the dialog shows what the chain
  said it will do — what is deposited, the gas, the total leaving the wallet — before the one
  signature. The principal stays the depositor's, and the dialog says so in the vault's own words.
*/
export function DepositCheckout({ vaultId }: { vaultId: string }) {
  const [amount, setAmount] = useState('1');
  const [shape, setShape] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const checkout = useCheckout<Quote>();

  if (checkout.signer === null) {
    return (
      <div className="w-money">
        <p className="w-dialog__after">
          Sign in to deposit. Your principal stays yours and is withdrawable at any time.
        </p>
        <SignIn />
      </div>
    );
  }

  const start = () => {
    const mist = toMist(amount);
    if (mist === null) {
      setShape('Enter an amount in SUI, up to 9 decimal places.');
      return;
    }
    setShape(null);
    setOpen(true);
    void checkout.simulate('/api/checkout/prepare', { vaultId, amountMist: mist.toString() });
  };

  const close = () => {
    setOpen(false);
    checkout.reset();
  };

  const quote = checkout.quote;

  return (
    <div className="w-money">
      <div className="w-field">
        <label htmlFor="amount">Amount · SUI</label>
        <div className="w-field__row w-money__row">
          <input
            id="amount"
            className="w-input"
            value={amount}
            inputMode="decimal"
            onChange={(event) => {
              setAmount(event.target.value);
              setShape(null);
            }}
          />
          <button type="button" className="w-btn w-btn--primary" onClick={start}>
            Check the deposit
          </button>
        </div>
        {shape === null ? null : <p className="w-field__note w-field__note--bad">{shape}</p>}
      </div>
      <p className="w-money__kicker">Minimum 1 SUI · checked on chain before anything is signed</p>

      {open ? (
        <MoneyDialog
          title="Deposit into this vault"
          stage={checkout.stage}
          error={checkout.error}
          blocked={checkout.blocked}
          signed={checkout.signed}
          facts={
            quote === null
              ? [{ label: 'Deposited (stays yours, withdrawable)', value: `${amount.trim()} SUI` }]
              : [
                  { label: 'Deposited (stays yours, withdrawable)', value: `${sui(BigInt(quote.amountMist))} SUI` },
                  { label: 'Network gas', value: `${sui(BigInt(quote.gasMist))} SUI` },
                  { label: 'Total leaving your wallet', value: `${sui(-BigInt(quote.suiDeltaMist))} SUI`, strong: true },
                ]
          }
          factsNote={VAULT_DISCLOSURE_SHORT}
          stageNote={{
            simulating: 'Checking the deposit against the chain.',
            'awaiting-signature': 'What will happen, checked against the chain. Nothing signed yet.',
          }}
          refusals={{
            'no-account': (
              <>
                Account required. This address has no Weir account yet, and you need one to deposit.{' '}
                <a href="/join">Claiming a handle</a> is free apart from gas.
              </>
            ),
          }}
          refusalNote="Nothing was signed."
          primaryLabel={checkout.stage === 'submitting' ? 'Waiting for your wallet…' : 'Confirm and sign'}
          primaryDisabled={quote === null}
          onPrimary={() => void checkout.signAndSubmit()}
          onCancel={close}
          onClose={close}
          done={
            checkout.digest === null ? null : (
              <>
                <div className="w-dialog__done">
                  <p>Deposited.</p>
                  <DigestLine digest={checkout.digest} />
                  <p>Your principal is redeemable in full at any time.</p>
                </div>
                <div className="w-dialog__actions">
                  <button type="button" className="w-btn w-btn--quiet" onClick={close}>
                    Close
                  </button>
                  <button type="button" className="w-btn w-btn--primary" onClick={() => window.location.reload()}>
                    Reload and see it
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
