'use client';
// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
/**
 * The names this wallet holds, and what each one does.
 *
 * Two separate settings, kept separate because SuiNS keeps them separate and collapsing them would
 * be a lie about the chain:
 *
 *   * **where a name points** — `alice.sui` → an address. One name, one destination.
 *   * **what an address is displayed as** — the reverse record. One address, one name, and setting
 *     it for a second name replaces the first.
 *
 * Every change is built and simulated by the server before the wallet is asked, so a change that
 * would abort is never offered — the same sequence the name purchase uses.
 */
import { useCallback, useEffect, useState } from 'react';
import { useSigner } from '@/components/SignerProvider';
import { formatSui } from '@/lib/units';

interface OwnedName {
  nftId: string;
  name: string;
  expiresAtMs: number;
  targetAddress: string | null;
}

interface Owned {
  names: OwnedName[];
  unconfirmed: number;
  truncated: boolean;
}

type Pending = { key: string; bytes: string; gasMist: string; summary: string };

function short(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function NameManager({ reverseName }: { reverseName: string | null }) {
  const { signer } = useSigner();
  const address = signer?.address ?? null;

  const [owned, setOwned] = useState<Owned | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [digest, setDigest] = useState<string | null>(null);
  /* What the reverse record says now: the server's answer at load, then whatever we have set since. */
  const [displayed, setDisplayed] = useState<string | null>(reverseName);

  const load = useCallback(async () => {
    if (address === null) return;
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch(`/api/names/owned?address=${encodeURIComponent(address)}`);
      const body = (await response.json()) as Partial<Owned> & { error?: string };
      if (!response.ok || body.names === undefined) {
        setLoadError(body.error ?? 'your names could not be read');
        setOwned(null);
      } else {
        setOwned({
          names: body.names,
          unconfirmed: body.unconfirmed ?? 0,
          truncated: body.truncated ?? false,
        });
      }
    } catch (cause) {
      setLoadError(cause instanceof Error ? cause.message : 'your names could not be read');
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    void load();
  }, [load]);

  async function prepare(key: string, payload: Record<string, unknown>) {
    if (address === null) return;
    setBusy(key);
    setError(null);
    setDigest(null);
    setPending(null);
    try {
      const response = await fetch('/api/names/manage/prepare', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sender: address, ...payload }),
      });
      const body = (await response.json()) as {
        bytes?: string;
        gasMist?: string;
        summary?: string;
        error?: string;
      };
      if (body.bytes === undefined) setError(body.error ?? 'that change could not be prepared');
      else
        setPending({
          key,
          bytes: body.bytes,
          gasMist: body.gasMist ?? '0',
          summary: body.summary ?? 'make this change',
        });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'that change could not be prepared');
    } finally {
      setBusy(null);
    }
  }

  async function signAndSubmit() {
    if (signer === null || pending === null) return;
    setBusy(pending.key);
    setError(null);
    try {
      const signature = await signer.signTransaction(pending.bytes);
      const response = await fetch('/api/checkout/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // The bytes that were simulated, unchanged. Nothing is rebuilt here.
        body: JSON.stringify({ bytes: pending.bytes, signature }),
      });
      const body = (await response.json()) as { digest?: string; error?: string };
      if (body.digest === undefined) {
        setError(body.error ?? 'the change was not accepted');
      } else {
        setDigest(body.digest);
        // What we just did, reflected without waiting for a re-read that may lag the chain.
        if (pending.key === 'display-clear') setDisplayed(null);
        else if (pending.key.startsWith('display-')) setDisplayed(pending.key.slice('display-'.length));
        setPending(null);
        void load();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'the change was not accepted');
    } finally {
      setBusy(null);
    }
  }

  if (signer === null) {
    return (
      <p className="section-note">
        Connect the wallet that holds your names to point them or choose which one you are shown as.
      </p>
    );
  }

  return (
    <div className="names-manage">
      {loading && owned === null && <p className="section-note">Reading your names…</p>}

      {loadError !== null && (
        <p className="form-note warn">
          {loadError} Your names are unaffected — this is our reader, not your wallet.
        </p>
      )}

      {owned !== null && owned.names.length === 0 && owned.unconfirmed === 0 && (
        <p className="section-note">
          No .sui names in this wallet yet. Registering one above puts it here.
        </p>
      )}

      {owned !== null && owned.names.length > 0 && (
        <ul className="names-list">
          {owned.names.map((name) => {
            const pointsHere = name.targetAddress !== null && name.targetAddress === address;
            const isDisplayed = displayed === name.name;
            return (
              <li key={name.nftId} className="names-item">
                <div className="names-item__head">
                  <span className="names-item__name">{name.name}</span>
                  <span className={name.targetAddress === null ? 'pill' : 'pill free'}>
                    {name.targetAddress === null
                      ? 'points nowhere'
                      : pointsHere
                        ? 'points here'
                        : `points at ${short(name.targetAddress)}`}
                  </span>
                </div>
                <p className="names-item__meta mono">
                  Expires {new Date(name.expiresAtMs).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}
                  {isDisplayed ? ' · shown as your name' : ''}
                </p>
                <div className="names-item__actions">
                  {!pointsHere && (
                    <button
                      type="button"
                      className="btn ghost"
                      disabled={busy !== null}
                      onClick={() => void prepare(`point-${name.nftId}`, { kind: 'point-here', nftId: name.nftId })}
                    >
                      Point it at this wallet
                    </button>
                  )}
                  {name.targetAddress !== null && (
                    <button
                      type="button"
                      className="btn ghost"
                      disabled={busy !== null}
                      onClick={() => void prepare(`clear-${name.nftId}`, { kind: 'point-nowhere', nftId: name.nftId })}
                    >
                      Stop it resolving
                    </button>
                  )}
                  {!isDisplayed && (
                    <button
                      type="button"
                      className="btn ghost"
                      disabled={busy !== null}
                      onClick={() => void prepare(`display-${name.name}`, { kind: 'display', name: name.name })}
                    >
                      Show me as this
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {displayed !== null && (
        <p className="names-displayed">
          Your address is shown as <strong>{displayed}</strong> across Weir and anywhere else that
          reads the chain.{' '}
          <button
            type="button"
            className="linklike"
            disabled={busy !== null}
            onClick={() => void prepare('display-clear', { kind: 'stop-displaying' })}
          >
            Stop showing it
          </button>
        </p>
      )}

      {owned !== null && owned.unconfirmed > 0 && (
        /*
          A count with no names is what a stale layout looks like. Said plainly rather than shown as
          "you own nothing", which would be a different and wrong claim.
        */
        <p className="form-note warn">
          {owned.unconfirmed} object{owned.unconfirmed === 1 ? '' : 's'} in this wallet look like
          names but the registry did not confirm {owned.unconfirmed === 1 ? 'it' : 'them'}. Nothing
          is wrong with your names — we are not showing what we could not verify.
        </p>
      )}

      {owned !== null && owned.truncated && (
        <p className="section-note">Showing the first names in this wallet; there may be more.</p>
      )}

      {pending !== null && (
        <div className="note" data-reveal>
          <span className="lbl">Ready to sign</span>
          <p>
            This will {pending.summary}. It has been simulated against the chain and it succeeds.
            Network fee about {formatSui(BigInt(pending.gasMist))} SUI.
          </p>
          <div className="names-item__actions">
            <button type="button" className="btn" disabled={busy !== null} onClick={() => void signAndSubmit()}>
              {busy !== null ? 'Confirm in your wallet…' : 'Sign it'}
            </button>
            <button type="button" className="btn ghost" disabled={busy !== null} onClick={() => setPending(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {error !== null && <p className="form-note warn">{error}</p>}

      {digest !== null && (
        <p className="form-note">
          Done.{' '}
          <a href={`https://suiscan.xyz/mainnet/tx/${digest}`} target="_blank" rel="noreferrer">
            See it on chain
          </a>
        </p>
      )}
    </div>
  );
}
