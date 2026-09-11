'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { useCallback, useEffect, useState } from 'react';
import { useSigner } from '@/components/SignerProvider';
import { SignIn } from '@/components/SignIn';
import { formatUnits, formatSui } from '@/lib/units';

interface VaultEarnings {
  handle: string;
  vaultId: string;
  coinType: string;
  earnings: string;
  grossVolume: string;
  platformFees: string;
  subscriptionsSold: string;
  feeBpsSnapshot: string;
  decimals: number;
  capId: string | null;
}

type Load =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'ready'; vaults: VaultEarnings[] }
  /** The chain could not be read. Not a zero balance, and no button. */
  | { state: 'unmeasured'; detail: string };

const units = (raw: string, decimals: number) => formatUnits(BigInt(raw), decimals);

const sui = formatSui;

export function Earnings() {
  const { signer } = useSigner();
  const [load, setLoad] = useState<Load>({ state: 'idle' });
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [quote, setQuote] = useState<{ vaultId: string; bytes: string; gasMist: string; amount: string } | null>(null);
  const [digest, setDigest] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (address: string) => {
    setLoad({ state: 'loading' });
    try {
      const r = await fetch(`/api/earnings?owner=${encodeURIComponent(address)}`);
      const body = (await r.json()) as { vaults?: VaultEarnings[]; error?: string };
      if (body.vaults === undefined) {
        setLoad({ state: 'unmeasured', detail: body.error ?? `the chain returned ${r.status}` });
        return;
      }
      setLoad({ state: 'ready', vaults: body.vaults });
    } catch (e) {
      setLoad({ state: 'unmeasured', detail: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  useEffect(() => {
    if (signer !== null) void refresh(signer.address);
  }, [signer, refresh]);

  async function simulate(vault: VaultEarnings) {
    if (signer === null || vault.capId === null) return;
    setBusy(true);
    setError(null);
    setQuote(null);
    setDigest(null);
    try {
      const typed = (amounts[vault.vaultId] ?? '').trim();
      let amount = vault.earnings;
      if (typed !== '') {
        if (!/^\d+(\.\d+)?$/.test(typed)) {
          setError('Enter a number, for example 12.50');
          return;
        }
        const [whole = '0', frac = ''] = typed.split('.');
        if (frac.length > vault.decimals) {
          setError(`This coin has ${vault.decimals} decimal places; ${typed} has ${frac.length}`);
          return;
        }
        amount = BigInt(whole + frac.padEnd(vault.decimals, '0')).toString();
      }

      const r = await fetch('/api/earnings/prepare', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          sender: signer.address,
          vaultId: vault.vaultId,
          capId: vault.capId,
          coinType: vault.coinType,
          amount,
        }),
      });
      const body = (await r.json()) as { quote?: { bytes: string; gasMist: string }; error?: string };
      if (body.quote === undefined) setError(body.error ?? 'the withdrawal could not be simulated');
      else setQuote({ vaultId: vault.vaultId, bytes: body.quote.bytes, gasMist: body.quote.gasMist, amount });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function signAndSubmit() {
    if (signer === null || quote === null) return;
    setBusy(true);
    setError(null);
    try {
      const signature = await signer.signTransaction(quote.bytes);

      const r = await fetch('/api/checkout/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bytes: quote.bytes, signature }),
      });
      const body = (await r.json()) as { digest?: string; error?: string };
      if (body.digest === undefined) setError(body.error ?? 'the withdrawal was not accepted');
      else {
        setDigest(body.digest);
        setQuote(null);
        await refresh(signer.address);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (signer === null) {
    return (
      <div className="panel">
        <p style={{ marginTop: 0, color: 'var(--text-secondary)' }}>
          Your earnings sit in your vault on chain. Withdraw them whenever you like — the
          transaction is yours to sign and it settles when the chain accepts it.
        </p>
        <SignIn />
        {error !== null && <p className="unmeasured">{error}</p>}
      </div>
    );
  }

  if (load.state === 'unmeasured') {
    return (
      <div className="note crit">
        <span className="lbl">Reading from the chain</span>
        <p>
          Your vault is loading ({load.detail}). Everything it has earned is held on chain and is
          unaffected by this page — the balance and the withdraw control appear once it answers.
        </p>
      </div>
    );
  }

  if (load.state !== 'ready') {
    return <div className="panel"><p style={{ margin: 0, color: 'var(--text-tertiary)' }}>Reading your vaults…</p></div>;
  }

  if (load.vaults.length === 0) {
    return (
      <div className="card empty">
        This address owns no creator vault. Earnings appear here once you open one.
      </div>
    );
  }

  return (
    <>
      {digest !== null && (
        <div className="note" style={{ marginBottom: 'var(--space-20)' }}>
          <span className="lbl">Withdrawn</span>
          <p>
            The coin is in your wallet.{' '}
            <a href={`https://suiscan.xyz/mainnet/tx/${digest}`} target="_blank" rel="noreferrer">
              <span className="mono">{digest.slice(0, 12)}…</span>
            </a>
          </p>
        </div>
      )}

      {load.vaults.map((vault) => {
        const balance = BigInt(vault.earnings);
        const quoted = quote !== null && quote.vaultId === vault.vaultId;
        return (
          <div className="card" key={vault.vaultId}>
            <div className="byline">
              <span className="avatar" aria-hidden>{vault.handle.slice(0, 2)}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span className="byline-name">@{vault.handle}</span>
                <div className="byline-meta">
                  vault <span className="mono">{vault.vaultId.slice(0, 10)}…</span> ·{' '}
                  {Number(vault.feeBpsSnapshot) / 100}% platform fee, fixed at creation
                </div>
              </div>
            </div>

            <div
              style={{
                display: 'grid',
                gap: 'var(--space-20)',
                gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                margin: 'var(--space-20) 0',
              }}
            >
              <div className="stat">
                <span className="k">Withdrawable now</span>
                <span className="v" style={{ color: balance > 0n ? 'var(--text-prize)' : 'var(--text-primary)' }}>
                  {units(vault.earnings, vault.decimals)}
                </span>
              </div>
              <div className="stat">
                <span className="k">Buyers paid</span>
                <span className="v">{units(vault.grossVolume, vault.decimals)}</span>
              </div>
              <div className="stat">
                <span className="k">Platform took</span>
                <span className="v">{units(vault.platformFees, vault.decimals)}</span>
              </div>
              <div className="stat">
                <span className="k">Subscriptions</span>
                <span className="v">{vault.subscriptionsSold}</span>
              </div>
            </div>

            {vault.capId === null ? (
              <div className="note warn">
                <span className="lbl">No CreatorCap at this address</span>
                <p>
                  The contract requires the capability to withdraw, and this address does not hold
                  one. Withdraw from the wallet that holds it.
                </p>
              </div>
            ) : balance === 0n ? (
              <p className="section-note" style={{ margin: 0 }}>
                Nothing to withdraw yet. This is a measured zero; the vault was read.
              </p>
            ) : quoted ? (
              <div className="note">
                <span className="lbl">Checked against the chain. Nothing signed yet</span>
                <p>
                  Withdrawing <strong>{units(quote.amount, vault.decimals)}</strong> costs{' '}
                  <strong>{sui(quote.gasMist)} SUI</strong> in gas. The coin goes to the address you
                  are signing with.
                </p>
                <div style={{ display: 'flex', gap: 'var(--space-8)', marginTop: 'var(--space-12)' }}>
                  <button className="btn" type="button" disabled={busy} onClick={() => void signAndSubmit()}>
                    {busy ? 'Waiting for your signature…' : 'Sign and withdraw'}
                  </button>
                  <button className="btn ghost" type="button" disabled={busy} onClick={() => setQuote(null)}>
                    Back
                  </button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 'var(--space-8)', flexWrap: 'wrap' }}>
                <input
                  className="comment-input"
                  style={{ maxWidth: 220 }}
                  inputMode="decimal"
                  aria-label={`Amount to withdraw from @${vault.handle}`}
                  placeholder={`All of it: ${units(vault.earnings, vault.decimals)}`}
                  value={amounts[vault.vaultId] ?? ''}
                  onChange={(e) => setAmounts((a) => ({ ...a, [vault.vaultId]: e.target.value }))}
                />
                <button className="btn" type="button" disabled={busy} onClick={() => void simulate(vault)}>
                  {busy ? 'Checking…' : 'Withdraw'}
                </button>
              </div>
            )}
          </div>
        );
      })}

      {error !== null && <p className="unmeasured">{error}</p>}
    </>
  );
}
