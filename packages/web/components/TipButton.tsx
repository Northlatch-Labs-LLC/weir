'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { useState } from 'react';
import { SignIn } from '@/components/SignIn';
import { DigestLine, MoneyDialog } from '@/components/app/MoneyDialog';
import { useCheckout } from '@/components/app/use-checkout';
import { formatUnits, SUI_DECIMALS } from '@/lib/units';

interface Quote {
  bytes: string;
  gasMist: string;
  creatorReceives: string;
  platformReceives: string;
}

function toMinor(input: string, decimals: number): bigint | null {
  const trimmed = input.trim();
  if (!new RegExp(`^\\d+(\\.\\d{1,${decimals}})?$`).test(trimmed)) return null;
  const [whole = '0', frac = ''] = trimmed.split('.');
  const value = BigInt(whole + frac.padEnd(decimals, '0'));
  return value > 0n ? value : null;
}

/*
  A tip is a decision: the amount is typed on the page, and the dialog shows what the vault says
  the creator receives and Weir takes, in the creator's coin at its own scale, before the one
  signature. It buys nothing; it is simply theirs.
*/
export function TipButton({
  vaultId,
  decimals,
  symbol,
}: {
  vaultId: string;
  decimals: number;
  symbol: string;
}) {
  const [amount, setAmount] = useState('');
  const [open, setOpen] = useState(false);
  const checkout = useCheckout<Quote>();
  const minor = toMinor(amount, decimals);
  const money = (raw: string | bigint) => `${formatUnits(BigInt(raw), decimals)} ${symbol}`;

  if (checkout.signer === null) {
    return (
      <div className="w-money">
        <p className="w-dialog__after">
          Send this creator any amount, once. It buys nothing and it is simply theirs.
        </p>
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
      <div className="w-field">
        <label htmlFor="tip">Send a tip · {symbol}</label>
        <div className="w-field__row w-money__row">
          <input
            id="tip"
            className="w-input"
            inputMode="decimal"
            placeholder={`0.00 ${symbol}`}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
          <button
            type="button"
            className="w-btn w-btn--primary"
            disabled={minor === null}
            onClick={() => {
              if (minor === null) return;
              setOpen(true);
              void checkout.simulate('/api/checkout/tip', { vaultId, amount: minor.toString() });
            }}
          >
            Send a tip
          </button>
        </div>
        {amount.trim() !== '' && minor === null ? (
          <p className="w-field__note w-field__note--bad">
            Enter an amount above zero with at most {decimals} decimal places.
          </p>
        ) : (
          <p className="w-field__note">Any amount, once. It buys nothing and it is simply theirs.</p>
        )}
      </div>

      {open && minor !== null ? (
        <MoneyDialog
          title="Send a tip"
          stage={checkout.stage}
          error={checkout.error}
          blocked={checkout.blocked}
          signed={checkout.signed}
          facts={
            quote === null
              ? [{ label: 'Tip', value: money(minor), strong: true }]
              : [
                  { label: 'Tip', value: money(minor), strong: true },
                  { label: 'The creator receives', value: money(quote.creatorReceives) },
                  { label: 'Weir takes', value: money(quote.platformReceives) },
                  { label: 'Gas', value: `${formatUnits(BigInt(quote.gasMist), SUI_DECIMALS)} SUI` },
                ]
          }
          factsNote="What the creator receives is read from the vault when the tip is checked, not assumed here."
          stageNote={{ simulating: 'Checking the tip against the vault.' }}
          refusals={{
            'insufficient-balance': `Not enough ${symbol} for that.`,
            'tier-inactive': 'This vault is not accepting payments.',
          }}
          primaryLabel={checkout.stage === 'submitting' ? 'Sending…' : 'Confirm and send'}
          primaryDisabled={quote === null}
          onPrimary={() => void checkout.signAndSubmit()}
          onCancel={close}
          onClose={close}
          done={
            checkout.digest === null ? null : (
              <>
                <div className="w-dialog__done">
                  <p>Sent.</p>
                  <DigestLine digest={checkout.digest} />
                </div>
                <div className="w-dialog__actions">
                  <button
                    type="button"
                    className="w-btn w-btn--primary"
                    onClick={() => {
                      setAmount('');
                      close();
                    }}
                  >
                    Done
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
