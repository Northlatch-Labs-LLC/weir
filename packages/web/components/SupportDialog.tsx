'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude
/**
 * Supporting a creator, as a dialog.
 *
 * # What this is
 *
 * The ported design's payment modal, on this application's real checkout. It opens over the page a
 * reader was already on, walks one path — amount, then wallet if there is none, then signature,
 * then the receipt — and closes. The control it replaces was an inline panel that pushed the page
 * down and asked the reader to leave for `/signin` if they had no wallet, losing the amount they
 * had typed and the post they were reading.
 *
 * # The confirm names the amount
 *
 * The irreversible button reads `Send 0.25 SUI` — verb, exact figure, token — never `Confirm`. It
 * is the last thing a person sees before money moves, and a generic word there is how somebody
 * signs for a number they did not check.
 *
 * # What it does not do
 *
 * It does not build the transaction. `/api/checkout/tip` returns opaque bytes, the wallet signs
 * exactly those bytes, and `/api/checkout/submit` takes them back with the signature. Nothing here
 * constructs, inspects or edits a transaction, so a bug in this file cannot change an amount.
 *
 * No confetti, no sound, no counting up. Every progress state is a word as well as a colour.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSigner } from '@/components/SignerProvider';
import { Icon } from '@/components/design/icons';

const ECOSYSTEM_URL = 'https://sui.io/ecosystem';

type Blocker =
  | { kind: 'no-account' }
  | { kind: 'self-payment' }
  | { kind: 'insufficient-balance'; have: string; need: string }
  | { kind: 'tier-inactive' };

interface Quote {
  bytes: string;
  gasMist: string;
  creatorReceives: string;
  platformReceives: string;
}

/** Where the reader is in the one path this dialog walks. */
type Stage = 'amount' | 'review' | 'signing' | 'settled';

/**
 * A typed decimal to smallest units. `null` for anything that is not a clean amount.
 *
 * Rejects rather than rounds: accepting more decimal places than the coin has would silently
 * truncate somebody's intent, and the difference belongs to them.
 */
function toMinor(input: string, decimals: number): bigint | null {
  const trimmed = input.trim();
  if (!new RegExp(`^\\d+(\\.\\d{1,${decimals}})?$`).test(trimmed)) return null;
  const [whole = '0', frac = ''] = trimmed.split('.');
  const value = BigInt(whole + frac.padEnd(decimals, '0'));
  return value > 0n ? value : null;
}

/** Preset amounts, in whole units of whatever the vault is denominated in. */
const PRESETS = ['0.1', '0.25', '1', '5'] as const;

export function SupportDialog({
  vaultId,
  decimals,
  symbol,
  creatorName,
  onClose,
}: {
  vaultId: string;
  /** From the coin's own metadata. Never assumed — a wrong scale misprices by orders of magnitude. */
  decimals: number;
  symbol: string;
  creatorName: string;
  onClose: () => void;
}) {
  const { signer } = useSigner();
  const [stage, setStage] = useState<Stage>('amount');
  const [amount, setAmount] = useState('0.25');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [blocked, setBlocked] = useState<Blocker | null>(null);
  const [digest, setDigest] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cardRef = useRef<HTMLDivElement>(null);
  const minor = toMinor(amount, decimals);

  /*
    Escape closes, and focus moves into the dialog when it opens.

    A modal that cannot be dismissed from the keyboard traps somebody who opened it by accident on
    the one screen where the next control spends money.
  */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    document.addEventListener('keydown', onKey);
    cardRef.current?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const simulate = useCallback(async () => {
    if (signer === null || minor === null) return;
    setBusy(true);
    setError(null);
    setBlocked(null);
    try {
      const response = await fetch('/api/checkout/tip', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // No coin type — the route reads the vault's own denomination.
        body: JSON.stringify({ sender: signer.address, vaultId, amount: minor.toString() }),
      });
      const body = (await response.json()) as { quote?: Quote; blocked?: Blocker; error?: string };
      if (body.blocked !== undefined) setBlocked(body.blocked);
      else if (body.quote === undefined) setError(body.error ?? 'This could not be checked. Try again.');
      else {
        setQuote(body.quote);
        setStage('review');
      }
    } catch {
      setError('That did not reach the network. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }, [signer, minor, vaultId]);

  const signAndSubmit = useCallback(async () => {
    if (signer === null || quote === null) return;
    setBusy(true);
    setError(null);
    setStage('signing');
    try {
      const signature = await signer.signTransaction(quote.bytes);
      const response = await fetch('/api/checkout/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // The bytes that were simulated, unchanged.
        body: JSON.stringify({ bytes: quote.bytes, signature }),
      });
      const body = (await response.json()) as { digest?: string; error?: string };
      if (body.digest === undefined) {
        setError(body.error ?? 'The payment was not accepted. Nothing was charged.');
        setStage('review');
      } else {
        setDigest(body.digest);
        setStage('settled');
      }
    } catch {
      // A rejected signature is the commonest path here and is not a failure.
      setError('Nothing was signed, so nothing was charged.');
      setStage('review');
    } finally {
      setBusy(false);
    }
  }, [signer, quote]);

  return (
    <div className="sd" role="presentation" onClick={() => !busy && onClose()}>
      <div
        ref={cardRef}
        className="sd__card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sd-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sd__head">
          <div>
            <h2 id="sd-title" className="sd__title">
              Support {creatorName}
            </h2>
            <p className="sd__sub">
              Goes straight to their vault.
            </p>
          </div>
          <button type="button" className="sd__close" onClick={onClose} aria-label="Close" disabled={busy}>
            <Icon name="close" size={18} />
          </button>
        </div>

        {/* No wallet: the path forward, in the dialog, instead of sending them away. */}
        {signer === null ? (
          <div className="sd__body">
            <p className="sd__note">
              You need a Sui wallet to send money. It is a browser extension that holds your key,
              and it takes about a minute to set up.
            </p>
            <a className="sd__secondary" href={ECOSYSTEM_URL} rel="noreferrer noopener" target="_blank">
              See Sui wallets <Icon name="external" size={15} />
            </a>
            <p className="sd__foot">
              Already have one? Connect it from the account menu at the top of the page.
            </p>
          </div>
        ) : stage === 'amount' ? (
          <div className="sd__body">
            <label className="sd__label" htmlFor="sd-amount">
              How much, in {symbol}
            </label>
            <input
              id="sd-amount"
              className="sd__input"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-invalid={amount !== '' && minor === null}
            />
            <div className="sd__presets">
              {PRESETS.map((v) => (
                <button
                  key={v}
                  type="button"
                  className="sd__preset"
                  data-on={amount === v ? '' : undefined}
                  onClick={() => setAmount(v)}
                >
                  {v}
                </button>
              ))}
            </div>

            {amount !== '' && minor === null && (
              <p className="sd__error">
                {symbol} takes at most {decimals} decimal places. Try a simpler amount.
              </p>
            )}

            {blocked !== null && (
              <p className="sd__error">
                {blocked.kind === 'insufficient-balance'
                  ? `Your wallet holds ${blocked.have} and this needs ${blocked.need}.`
                  : blocked.kind === 'self-payment'
                    ? 'This is your own vault, so there is nothing to send.'
                    : blocked.kind === 'no-account'
                      ? 'Sending needs an account. It is free to create one.'
                      : 'This creator is not accepting support right now.'}
              </p>
            )}
            {error !== null && <p className="sd__error">{error}</p>}

            <div className="sd__actions">
              <button type="button" className="sd__secondary" onClick={onClose}>
                Cancel
              </button>
              <button
                type="button"
                className="sd__primary"
                disabled={minor === null || busy}
                onClick={() => void simulate()}
              >
                {busy ? 'Checking…' : 'Continue'}
              </button>
            </div>
          </div>
        ) : stage === 'settled' ? (
          <div className="sd__body">
            <p className="sd__settled">Sent. It is in {creatorName}&rsquo;s vault.</p>
            {digest !== null && (
              <a className="sd__secondary" href={`/receipt/${digest}`}>
                See the receipt
              </a>
            )}
            <div className="sd__actions">
              <button type="button" className="sd__primary" onClick={onClose}>
                Done
              </button>
            </div>
          </div>
        ) : (
          // review and signing share one screen: the figures do not move while a wallet is open.
          <div className="sd__body">
            <dl className="sd__split">
              <div>
                <dt>{creatorName} receives</dt>
                <dd>
                  {quote?.creatorReceives} {symbol}
                </dd>
              </div>
              <div>
                <dt>Platform fee</dt>
                <dd>
                  {quote?.platformReceives} {symbol}
                </dd>
              </div>
              <div className="sd__total">
                <dt>You sign for</dt>
                <dd>
                  {amount} {symbol}
                </dd>
              </div>
            </dl>

            {error !== null && <p className="sd__error">{error}</p>}

            <div className="sd__actions">
              <button
                type="button"
                className="sd__secondary"
                disabled={busy}
                onClick={() => {
                  setStage('amount');
                  setQuote(null);
                }}
              >
                Back
              </button>
              {/* The last control before money moves names the amount, never "Confirm". */}
              <button
                type="button"
                className="sd__primary sd__primary--commit"
                disabled={busy}
                onClick={() => void signAndSubmit()}
              >
                {stage === 'signing' ? 'Waiting for your wallet…' : `Send ${amount} ${symbol}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
