'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { useCallback, useEffect, useState } from 'react';
import { useSigner } from '@/components/SignerProvider';
import { SignIn } from '@/components/SignIn';
import { StakeVaultSetup } from './StakeVaultSetup';
import { formatSui } from '@/lib/units';

interface TierView { name: string; price: string; periodMs: string; active: boolean }
interface VaultView {
  vaultId: string; capId: string; coinType: string; tiers: TierView[];
  accepting: boolean; handle: string | null;
  decimals: number | null;
  symbol: string;
}

type WithCoin = { vaultCoinTypes: string[] };

type Setup =
  | { stage: 'no-account' }
  | { stage: 'no-vault'; accountId: string; handle: string; creationFeeMist: string }
  | { stage: 'ready'; accountId: string; handle: string; vaults: VaultView[] };

type LoadedSetup = Setup & Partial<WithCoin>;

type Load =
  | { state: 'idle' | 'loading' }
  | { state: 'ready'; setup: LoadedSetup }
  | { state: 'unmeasured'; detail: string };

const DAY_MS = 24 * 60 * 60 * 1000;

const amount = (raw: string, decimals: number) => {
  const scale = 10n ** BigInt(decimals);
  const n = BigInt(raw);
  const frac = (n % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${n / scale}${frac === '' ? '' : `.${frac}`}`;
};
const sui = formatSui;

export function CreatorSetup() {
  const { signer } = useSigner();
  const [load, setLoad] = useState<Load>({ state: 'idle' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [quote, setQuote] = useState<{ what: string; bytes: string; gasMist: string } | null>(null);

  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [tier, setTier] = useState({ name: 'Monthly', price: '5', days: '30', vaultId: '' });
  const [chosenCoin, setChosenCoin] = useState<string | null>(null);

  const refresh = useCallback(async (address: string) => {
    setLoad({ state: 'loading' });
    try {
      const r = await fetch(`/api/creator?owner=${encodeURIComponent(address)}`);
      const b = (await r.json()) as (Setup & { error?: undefined }) | { error: string; stage?: undefined };
      if (b.stage === undefined) {
        setLoad({ state: 'unmeasured', detail: b.error ?? `the chain returned ${r.status}` });
        return;
      }
      setLoad({ state: 'ready', setup: b });
    } catch (e) {
      setLoad({ state: 'unmeasured', detail: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  useEffect(() => {
    if (signer !== null) void refresh(signer.address);
  }, [signer, refresh]);

  async function simulate(what: string, url: string, payload: Record<string, unknown>) {
    setBusy(true); setError(null); setQuote(null);
    try {
      const r = await fetch(url, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sender: signer?.address, ...payload }),
      });
      const b = (await r.json()) as { quote?: { bytes: string; gasMist: string }; error?: string };
      if (b.quote === undefined) setError(b.error ?? 'that could not be simulated');
      else setQuote({ what, bytes: b.quote.bytes, gasMist: b.quote.gasMist });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  async function signAndSubmit(after?: (digest: string) => Promise<void>) {
    if (signer === null || quote === null) return;
    setBusy(true); setError(null);
    try {
      const signature = await signer.signTransaction(quote.bytes);
      const r = await fetch('/api/checkout/submit', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bytes: quote.bytes, signature }),
      });
      const b = (await r.json()) as { digest?: string; error?: string };
      if (b.digest === undefined) { setError(b.error ?? 'that was not accepted'); return; }
      setQuote(null);
      if (after !== undefined) await after(b.digest);
      await refresh(signer.address);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  if (signer === null) {
    return (
      <div className="panel">
        <p style={{ marginTop: 0, color: 'var(--text-secondary)' }}>
          Connecting shows you where you already are: whether you hold an account, a vault, and a
          tier. Each of the three steps is simulated against the chain before you are asked to sign
          it, so nothing is signed on trust and a step that would abort is never offered.
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
          Your setup is loading ({load.detail}). Nothing is offered, because telling you that
          you have no vault when the chain was simply unreachable would send you to pay for a second one.
        </p>
      </div>
    );
  }
  if (load.state !== 'ready') {
    return <div className="panel"><p style={{ margin: 0, color: 'var(--text-tertiary)' }}>Reading the chain…</p></div>;
  }

  const setup = load.setup;
  const offeredCoins = setup.vaultCoinTypes ?? [];

  if (setup.stage === 'no-account') {
    return (
      <div className="panel">
        <h2 style={{ fontSize: 'var(--text-h3)', marginBottom: 'var(--space-10)' }}>Claim a handle first</h2>
        <p style={{ color: 'var(--text-secondary)' }}>
          <span className="mono">open_vault</span> takes a <span className="mono">SocialAccount</span>,
          so the contract will not let you open a vault without one. It is free apart from gas.
        </p>
        <a className="btn" href="/join">Claim a handle</a>
      </div>
    );
  }

  if (setup.stage === 'no-vault') {
    const free = BigInt(setup.creationFeeMist) === 0n;
    return (
      <div className="panel">
        <h2 style={{ fontSize: 'var(--text-h3)', marginBottom: 'var(--space-10)' }}>
          Open your creator vault
        </h2>
        <p style={{ color: 'var(--text-secondary)' }}>
          Payments to <strong>@{setup.handle}</strong> will settle into it, split in the same
          transaction. The platform fee is fixed into the vault at creation and can never be raised
          on it. It can only be lowered, and only if you accept the new terms.
        </p>
        <p className="section-note">
          Creation fee: <strong>{free ? 'none' : `${sui(setup.creationFeeMist)} SUI`}</strong>,
          read from the Platform object.
        </p>

        {offeredCoins.length === 0 ? (
          <p className="unmeasured">
            This site offers no vault denomination, so a vault cannot be opened here yet.
          </p>
        ) : (
          <fieldset
            style={{ border: 0, padding: 0, margin: 'var(--space-12) 0' }}
            disabled={busy || quote?.what === 'vault'}
          >
            <legend className="lbl" style={{ marginBottom: 'var(--space-8)' }}>
              Denomination (permanent)
            </legend>
            <p style={{ color: 'var(--text-secondary)', marginTop: 0 }}>
              This is the vault&rsquo;s type parameter. It is fixed when the vault is created and
              there is no way to change it later, so a different choice means a different vault.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-8)' }}>
              {offeredCoins.map((coin) => {
                const symbol = coin.split('::').pop() ?? coin;
                return (
                  <label key={coin} style={{ display: 'flex', gap: 'var(--space-8)', alignItems: 'flex-start' }}>
                    <input
                      type="radio"
                      name="vault-coin"
                      value={coin}
                      checked={chosenCoin === coin}
                      onChange={() => setChosenCoin(coin)}
                    />
                    <span>
                      <strong>{symbol}</strong>
                      <span
                        className="mono"
                        style={{ display: 'block', color: 'var(--text-tertiary)', overflowWrap: 'anywhere' }}
                      >
                        {coin}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
        )}

        {quote?.what === 'vault' ? (
          <div className="note">
            <span className="lbl">Checked against the chain. Nothing signed yet</span>
            <p>Opening the vault costs <strong>{sui(quote.gasMist)} SUI</strong> in gas.</p>
            <div style={{ display: 'flex', gap: 'var(--space-8)', marginTop: 'var(--space-12)' }}>
              <button className="btn" type="button" disabled={busy}
                onClick={() => void signAndSubmit()}>
                {busy ? 'Waiting for your signature…' : 'Sign and open'}
              </button>
              <button className="btn ghost" type="button" disabled={busy} onClick={() => setQuote(null)}>Back</button>
            </div>
          </div>
        ) : (
          <button className="btn" type="button" disabled={busy || chosenCoin === null}
            onClick={() => void simulate('vault', '/api/creator/vault', {
              accountId: setup.accountId, coinType: chosenCoin, creationFeeMist: setup.creationFeeMist,
            })}>
            {busy ? 'Checking…' : chosenCoin === null ? 'Choose a denomination' : 'Open a vault'}
          </button>
        )}
        {error !== null && <p className="unmeasured">{error}</p>}
      </div>
    );
  }

  return (
    <>
      {setup.vaults.map((vault) => (
        <div className="card" key={vault.vaultId}>
          <div className="byline">
            <span className="avatar" aria-hidden>{(vault.handle ?? setup.handle).slice(0, 2)}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <span className="byline-name">
                {vault.handle === null ? 'Unnamed vault' : `@${vault.handle}`}
              </span>
              <div className="byline-meta"><span className="mono">{vault.vaultId.slice(0, 14)}…</span></div>
            </div>
            <span className={vault.accepting ? 'pill subs' : 'pill'}>
              {vault.accepting ? 'Accepting' : 'Closed'}
            </span>
          </div>

          <div className="note" style={{ marginBottom: 'var(--space-16)' }}>
            <span className="lbl">{vault.accepting ? 'Retiring this page' : 'This page is closed'}</span>
            <p style={{ color: 'var(--text-secondary)' }}>
              {vault.accepting
                ? 'Closing stops new subscriptions, unlocks and tips. Nothing already bought is affected: earnings stay withdrawable, existing subscribers keep their access, and your posts stay readable. You can reopen it whenever you like.'
                : 'It takes no new payments. Everything already bought still works, and reopening restores it exactly as it was.'}
            </p>
            {quote?.what === `accepting:${vault.vaultId}` ? (
              <div className="note">
                <span className="lbl">Checked against the chain. Nothing signed yet</span>
                <p>
                  {vault.accepting ? 'Closing' : 'Reopening'} costs{' '}
                  <strong>{sui(quote.gasMist)} SUI</strong> in gas.
                </p>
                <div style={{ display: 'flex', gap: 'var(--space-8)', marginTop: 'var(--space-12)' }}>
                  <button className="btn" type="button" disabled={busy}
                    onClick={() => void signAndSubmit()}>
                    {busy ? 'Waiting for your signature…' : 'Sign and confirm'}
                  </button>
                  <button className="btn ghost" type="button" disabled={busy}
                    onClick={() => setQuote(null)}>Back</button>
                </div>
              </div>
            ) : (
              <button className="btn ghost" type="button" disabled={busy}
                onClick={() => void simulate(`accepting:${vault.vaultId}`, '/api/creator/accepting', {
                  vaultId: vault.vaultId, capId: vault.capId, coinType: vault.coinType,
                  accepting: !vault.accepting,
                })}>
                {busy ? 'Checking…' : vault.accepting ? 'Close this page' : 'Reopen this page'}
              </button>
            )}
          </div>

          {vault.handle === null ? (
            <>
              <div className="note warn" style={{ marginBottom: 'var(--space-16)' }}>
                <span className="lbl">Not published yet</span>
                <p>
                  The vault exists on chain and can take payments, but nothing here points at it,
                  so it has no page and your posts have nowhere to hang. Name it to publish.
                </p>
              </div>
              <div style={{ display: 'grid', gap: 'var(--space-10)' }}>
                <input className="comment-input" placeholder="Display name"
                  value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
                <input className="comment-input" placeholder="A line about what you publish"
                  value={bio} onChange={(e) => setBio(e.target.value)} />
                <div>
                  <button className="btn" type="button" disabled={busy}
                    onClick={() => {
                      setBusy(true); setError(null);
                      void (async () => {
                      const timestampMs = Date.now();
                      const statement =
                        `Weir\naddress: ${signer.address}\nissued: ${timestampMs}\norigin: ${window.location.origin}` +
                        `\naction: name vault\nvault: ${vault.vaultId}\nname: ${displayName}\nbio: ${bio}\ncoin: ${vault.coinType}`;
                      const signature = await signer.signPersonalMessage(
                        new TextEncoder().encode(statement),
                      );
                      return fetch('/api/creator/profile', {
                        method: 'POST', headers: { 'content-type': 'application/json' },
                        body: JSON.stringify({
                          owner: signer.address, vaultId: vault.vaultId,
            coinType: vault.coinType,
                          displayName, bio, signature, timestampMs,
                        }),
                      })
                        .then((r) => r.json())
                        .then((b: { handle?: string; error?: string }) => {
                          if (b.handle === undefined) setError(b.error ?? 'could not publish');
                          else return refresh(signer.address);
                          return undefined;
                        })
                        .finally(() => setBusy(false));
                      })().catch((e: unknown) => {
                        setError(e instanceof Error ? e.message : String(e));
                        setBusy(false);
                      });
                    }}>
                    {busy ? 'Publishing…' : 'Publish this vault'}
                  </button>
                </div>
              </div>
            </>
          ) : vault.tiers.length === 0 ? (
            <>
              <div className="note warn" style={{ marginBottom: 'var(--space-16)' }}>
                <span className="lbl">No tier yet, so nobody can subscribe</span>
                <p>
                  Tips and one-off unlocks already work. A subscription needs a tier, because
                  <span className="mono"> subscribe</span> takes a tier index and there is nothing to index.
                </p>
              </div>
              <TierForm
                vault={vault}
                tier={tier}
                setTier={setTier}
                busy={busy}
                quote={quote?.what === `tier:${vault.vaultId}` ? quote : null}
                onSimulate={(payload) => void simulate(`tier:${vault.vaultId}`, '/api/creator/tier', payload)}
                onSign={() => void signAndSubmit()}
                onBack={() => setQuote(null)}
              />
            </>
          ) : (
            <>
              <div className="scroll-x">
                <table>
                  <thead>
                    <tr><th>Tier</th><th>Price</th><th>Period</th><th>State</th></tr>
                  </thead>
                  <tbody>
                    {vault.tiers.map((t, i) => (
                      <tr key={i}>
                        <td>{t.name}</td>
                        <td className="mono">{amount(t.price, vault.decimals ?? 0)} {vault.symbol}</td>
                        <td className="mono">{Number(BigInt(t.periodMs) / BigInt(DAY_MS))} days</td>
                        <td>{t.active ? 'Active' : 'Retired'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ marginTop: 'var(--space-16)' }}>
                <TierForm
                  vault={vault}
                  tier={tier}
                  setTier={setTier}
                  busy={busy}
                  quote={quote?.what === `tier:${vault.vaultId}` ? quote : null}
                  onSimulate={(payload) => void simulate(`tier:${vault.vaultId}`, '/api/creator/tier', payload)}
                  onSign={() => void signAndSubmit()}
                  onBack={() => setQuote(null)}
                />
              </div>
            </>
          )}
        </div>
      ))}

      <div className="feed-head">
        <h2>Support without spending</h2>
      </div>
      <StakeVaultSetup accountId={setup.accountId} />

      {error !== null && <p className="unmeasured">{error}</p>}
    </>
  );
}

function TierForm({
  vault, tier, setTier, busy, quote, onSimulate, onSign, onBack,
}: {
  vault: VaultView;
  tier: { name: string; price: string; days: string; vaultId: string };
  setTier: (t: { name: string; price: string; days: string; vaultId: string }) => void;
  busy: boolean;
  quote: { bytes: string; gasMist: string } | null;
  onSimulate: (payload: Record<string, unknown>) => void;
  onSign: () => void;
  onBack: () => void;
}) {
  if (quote !== null) {
    return (
      <div className="note">
        <span className="lbl">Checked against the chain. Nothing signed yet</span>
        <p>
          Adding <strong>{tier.name}</strong> at {tier.price} {vault.symbol} every {tier.days} days costs{' '}
          <strong>{sui(quote.gasMist)} SUI</strong> in gas.
        </p>
        <div style={{ display: 'flex', gap: 'var(--space-8)', marginTop: 'var(--space-12)' }}>
          <button className="btn" type="button" disabled={busy} onClick={onSign}>
            {busy ? 'Waiting for your signature…' : 'Sign and add'}
          </button>
          <button className="btn ghost" type="button" disabled={busy} onClick={onBack}>Back</button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', gap: 'var(--space-8)', flexWrap: 'wrap', alignItems: 'center' }}>
      <input className="comment-input" style={{ maxWidth: 150 }} aria-label="Tier name"
        placeholder="Tier name" value={tier.name}
        onChange={(e) => setTier({ ...tier, name: e.target.value })} />
      <input className="comment-input" style={{ maxWidth: 110 }} aria-label={`Price in ${vault.symbol}`}
        inputMode="decimal" placeholder={vault.symbol} value={tier.price}
        onChange={(e) => setTier({ ...tier, price: e.target.value })} />
      <input className="comment-input" style={{ maxWidth: 100 }} aria-label="Period in days"
        inputMode="numeric" placeholder="days" value={tier.days}
        onChange={(e) => setTier({ ...tier, days: e.target.value })} />
      <button className="btn" type="button" disabled={busy}
        onClick={() => {
          const t = tier.price.trim();
          if (vault.decimals === null) return;
          const places = vault.decimals;
          if (!new RegExp(`^\\d+(\\.\\d{1,${places}})?$`).test(t)) return;
          const [whole = '0', frac = ''] = t.split('.');
          onSimulate({
            vaultId: vault.vaultId,
            capId: vault.capId,
            coinType: vault.coinType,
            name: tier.name,
            price: BigInt(whole + frac.padEnd(places, '0')).toString(),
            periodMs: (BigInt(tier.days.trim() === '' ? '0' : tier.days.trim()) * BigInt(DAY_MS)).toString(),
          });
        }}>
        {busy ? 'Checking…' : 'Add tier'}
      </button>
    </div>
  );
}
