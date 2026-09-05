'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude

/**
 * Deposit checkout.
 *
 * # The confirm button does not exist until a simulation has passed
 *
 * That is structural rather than a disabled attribute: the button is rendered only in the `quoted`
 * state, and the only way to reach that state is a `prepare` response carrying signable bytes. A
 * disabled button can be re-enabled by anything that flips a boolean; a button that is not in the
 * tree cannot be pressed.
 *
 * # What is signed is what was simulated
 *
 * The bytes come back from the server, go to the wallet unchanged, and go back to the server
 * unchanged. Nothing is rebuilt between the simulation and the signature, so the numbers shown
 * below are the numbers that will execute.
 */

import { useState } from 'react';
import { useSigner } from '@/components/SignerProvider';
import { SignIn } from '@/components/SignIn';

const MIST_PER_SUI = 1_000_000_000n;

interface Quote {
  bytes: string;
  suiDeltaMist: string;
  gasMist: string;
  amountMist: string;
}

type Stage =
  | { name: 'idle' }
  | { name: 'simulating' }
  | { name: 'needs-account' }
  | { name: 'quoted'; quote: Quote }
  | { name: 'signing' }
  | { name: 'submitting' }
  | { name: 'done'; digest: string }
  | { name: 'failed'; message: string };

/** Format MIST as SUI, exactly. String arithmetic — no float ever touches an amount. */
function sui(mist: bigint): string {
  const negative = mist < 0n;
  const abs = negative ? -mist : mist;
  const whole = abs / MIST_PER_SUI;
  const frac = (abs % MIST_PER_SUI).toString().padStart(9, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${frac === '' ? '' : `.${frac}`}`;
}

/** Parse a SUI decimal string into MIST by string manipulation. `parseFloat` is never used. */
function toMist(input: string): bigint | null {
  const text = input.trim();
  if (!/^\d+(\.\d{1,9})?$/.test(text)) return null;
  const [whole, frac = ''] = text.split('.');
  return BigInt(whole + frac.padEnd(9, '0'));
}

export function DepositCheckout({ vaultId }: { vaultId: string }) {
  const { signer } = useSigner();
  const [amount, setAmount] = useState('1');
  const [stage, setStage] = useState<Stage>({ name: 'idle' });


  async function simulate() {
    if (signer === null) return;
    const mist = toMist(amount);
    if (mist === null) {
      setStage({ name: 'failed', message: 'Enter an amount in SUI, up to 9 decimal places.' });
      return;
    }

    setStage({ name: 'simulating' });
    try {
      const response = await fetch('/api/checkout/prepare', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sender: signer.address, vaultId, amountMist: mist.toString() }),
      });
      const body = (await response.json()) as {
        quote?: Quote;
        needsAccount?: boolean;
        error?: string;
      };

      if (body.needsAccount === true) return setStage({ name: 'needs-account' });
      if (body.quote === undefined) {
        // The server's message, unmodified. It already carries the plain-language explanation when
        // the abort code is one we recognise, and the raw text when it is not.
        return setStage({ name: 'failed', message: body.error ?? 'the simulation failed' });
      }
      setStage({ name: 'quoted', quote: body.quote });
    } catch (error) {
      setStage({ name: 'failed', message: error instanceof Error ? error.message : String(error) });
    }
  }

  async function confirm(quote: Quote) {
    if (signer === null) return;
    setStage({ name: 'signing' });
    try {
      // The exact bytes the server simulated, whichever way this session signs.
      const signature = await signer.signTransaction(quote.bytes);

      setStage({ name: 'submitting' });
      const response = await fetch('/api/checkout/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bytes: quote.bytes, signature: signature }),
      });
      const body = (await response.json()) as { digest?: string; error?: string };

      if (body.digest === undefined) {
        return setStage({ name: 'failed', message: body.error ?? 'submission failed' });
      }
      setStage({ name: 'done', digest: body.digest });
    } catch (error) {
      setStage({ name: 'failed', message: error instanceof Error ? error.message : String(error) });
    }
  }

  if (signer === null) {
    return (
      <div className="panel">
        <p style={{ marginTop: 0 }}>
          Sign in to deposit. Your principal stays yours and is withdrawable at any time.
        </p>
        <SignIn />
        {stage.name === 'failed' && <p className="unmeasured">{stage.message}</p>}
      </div>
    );
  }

  return (
    <div className="panel">
      <label className="k" htmlFor="amount" style={{ display: 'block', marginBottom: 6 }}>
        AMOUNT · SUI
      </label>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          id="amount"
          className="field mono"
          value={amount}
          inputMode="decimal"
          onChange={(event) => {
            setAmount(event.target.value);
            // Any edit invalidates the quote. Keeping it would let someone change the number
            // after the simulation and sign bytes that no longer match what is on screen.
            if (stage.name === 'quoted') setStage({ name: 'idle' });
          }}
          /*
            The amount is the one figure on this panel somebody checks twice before signing, so it
            keeps its own size: larger than a field, and only as wide as the number needs. Colour,
            border and background come from `.field` — what was wrong here was the boundary, not
            the proportions.
          */
          style={{ fontSize: 18, padding: '9px 12px', width: 160 }}
        />
        <button
          className="btn ghost"
          type="button"
          onClick={() => void simulate()}
          disabled={stage.name === 'simulating'}
        >
          {stage.name === 'simulating' ? 'Checking…' : 'Check the deposit'}
        </button>
      </div>

      <p className="k" style={{ marginTop: 14 }}>
        MINIMUM 1 SUI · CHECKED ON CHAIN BEFORE ANYTHING IS SIGNED
      </p>

      {stage.name === 'needs-account' && (
        <div className="note warn">
          <span className="lbl">Account required</span>
          <p>
            This address has no Weir account yet. You need one to deposit. Claiming a handle
            is free apart from gas.
          </p>
        </div>
      )}

      {stage.name === 'quoted' && (
        <>
          <div className="note">
            <span className="lbl">What will happen</span>
            <table style={{ marginTop: 4 }}>
              <tbody>
                <tr>
                  <td>Deposited (stays yours, withdrawable)</td>
                  <td className="num">{sui(BigInt(stage.quote.amountMist))} SUI</td>
                </tr>
                <tr>
                  <td>Network gas</td>
                  <td className="num">{sui(BigInt(stage.quote.gasMist))} SUI</td>
                </tr>
                <tr>
                  <td>
                    <strong>Total leaving your wallet</strong>
                  </td>
                  <td className="num">
                    <strong>{sui(-BigInt(stage.quote.suiDeltaMist))} SUI</strong>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <button className="btn" type="button" onClick={() => void confirm(stage.quote)}>
            Confirm and sign
          </button>
        </>
      )}

      {(stage.name === 'signing' || stage.name === 'submitting') && (
        <p className="k" style={{ marginTop: 16 }}>
          {stage.name === 'signing' ? 'AWAITING YOUR WALLET…' : 'SUBMITTING…'}
        </p>
      )}

      {stage.name === 'done' && (
        <div className="note">
          <span className="lbl">Deposited</span>
          <p>
            <a
              className="mono"
              href={`https://suiscan.xyz/mainnet/tx/${stage.digest}`}
              rel="noreferrer"
              target="_blank"
            >
              {stage.digest.slice(0, 10)}…
            </a>
            . Your principal is redeemable in full at any time.
          </p>
        </div>
      )}

      {stage.name === 'failed' && (
        <div className="note crit">
          <span className="lbl">Nothing was signed</span>
          <p className="mono" style={{ fontSize: 13 }}>
            {stage.message}
          </p>
          {signer !== null && (
            <div style={{ marginTop: 12 }}>
              <p className="unmeasured" style={{ margin: 0 }}>
                If this wallet is short of SUI, add some from wherever you hold it, then check
                again.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
