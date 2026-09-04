'use client';
// Built-by: @projectx.sui /|\ · Co-authored-by: Claude

/**
 * Becoming a creator: open a vault, name it, add a tier.
 *
 * # This did not exist, and the studio pretended otherwise
 *
 * The studio carried a hardcoded vault id, coin type and handle — so it was a studio for exactly
 * one creator, and everybody else got a form that published against somebody else's vault. Opening
 * a vault and adding a tier were command-line operations. The product could take a creator's money
 * and pay it out, and could not sign one up.
 *
 * # The order is the contract's
 *
 * `open_vault` takes a `&SocialAccount`; `add_tier` takes the vault and its cap; nobody can
 * subscribe until a tier exists. Each step is gated by the one before it in Move, so the steps are
 * presented in that order rather than as a form that aborts.
 *
 * # Every transaction is simulated before it can be signed
 *
 * Including the free ones. The creation fee is currently zero on this platform, and a zero-cost
 * transaction still costs gas and can still abort — on a paused platform, on a second account, on a
 * period the contract refuses.
 */

import { useCallback, useEffect, useState } from 'react';
import { useSigner } from '@/components/SignerProvider';
import { SignIn } from '@/components/SignIn';
import { StakeVaultSetup } from './StakeVaultSetup';
import { formatSui } from '@/lib/units';

interface TierView { name: string; price: string; periodMs: string; active: boolean }
interface VaultView {
  vaultId: string; capId: string; coinType: string; tiers: TierView[];
  accepting: boolean; handle: string | null;
  /** From the coin's metadata. `null` when the vault has no coin type yet. */
  decimals: number | null;
  /** Display only — see the note in `lib/creator-setup.ts`. */
  symbol: string;
}

/** Carried on every stage, because the vault form needs it before a vault exists. */
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

/**
 * An amount in a coin's own scale.
 *
 * This was fixed at six decimals and named `usdc`, so every vault was formatted as though it held
 * USDC. A nine-decimal coin displayed its tier prices a thousand times too large, and the tier
 * *creation* path parsed them a thousand times too small — a creator asking for 5 got 0.005.
 */
const amount = (raw: string, decimals: number) => {
  const scale = 10n ** BigInt(decimals);
  const n = BigInt(raw);
  const frac = (n % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${n / scale}${frac === '' ? '' : `.${frac}`}`;
};
/*
  Was a private copy that stripped a leading minus before dividing, so a negative balance rendered
  as its own opposite. The shared one keeps the sign.
*/
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
  /*
   * Which coin a new vault will be denominated in.
   *
   * `null` until the creator picks, and deliberately not pre-filled with the first offered coin. The
   * coin type is the vault's type parameter, fixed at creation with no migration — a pre-selected
   * radio button would be a permanent decision about someone's business made by whoever ordered the
   * configuration variable.
   */
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


  /** Simulate anything. The confirm button only exists once this has returned bytes. */
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
        // The bytes that were simulated, unchanged.
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

  /*
    What a vault is and what it costs is stated by the page above, server-rendered, so a visitor
    without a wallet reads it there. Repeating it here put the same paragraph on screen twice; what
    is left to say at the button is what connecting reveals and that nothing is signed blind.
  */
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
        <span className="lbl">Not measured</span>
        <p>
          Your setup could not be read ({load.detail}). Nothing is offered, because telling you that
          you have no vault when the chain was simply unreachable would send you to pay for a second one.
        </p>
      </div>
    );
  }
  if (load.state !== 'ready') {
    return <div className="panel"><p style={{ margin: 0, color: 'var(--text-tertiary)' }}>Reading the chain…</p></div>;
  }

  const setup = load.setup;
  /*
   * The denominations a NEW vault may use, from the server rather than a literal here. Empty means
   * the deployment configured none — and the vault form is then withheld rather than defaulted,
   * because the coin type is the vault's type parameter and is fixed at creation.
   */
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
        {/* "Creator vault" — the support vault is a different object with a different purpose, and
            both were called "vault" on screens a creator reads in the same session. */}
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
          /*
            Withheld rather than defaulted. A deployment that has configured no denomination has not
            configured a safe one to guess, and the vault it would open cannot be changed afterwards.
          */
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
                      {/*
                        `overflowWrap: anywhere` because a coin type is one unbroken token — 66 hex
                        characters with no space to break at — and the default `normal` will not
                        break inside a word. Without it this span was 689px wide in a 514px viewport
                        and the whole page scrolled sideways. Every test still passed.
                      */}
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
          // Disabled until a denomination is chosen. The alternative — enabling it and sending
          // whatever happens to be selected — would open a permanent vault in a coin nobody picked.
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

          {/*
            Closing a page, which is the only kind of retirement the contract has.

            There is no destroy, close or delete in `creator.move` and there should not be: a
            `CreatorVault` is shared and the subscriptions and unlocks already sold point at it, so
            deleting it would orphan what people paid for. Closing refuses new money and takes
            nothing from anyone — earnings stay withdrawable, entitlements keep working, posts stay
            readable.

            Until now the application could open a vault and had no way to close one, so a creator
            who stopped publishing left a page still taking subscriptions.
          */}
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
                      /*
                        Signed, with no gas and no transaction. The route used to compare an `owner`
                        field against the vault's owner read from chain, which authorises nothing —
                        a vault's owner is public, so anyone could send it and rename this vault.
                        The statement must match `statementFor('name-vault')` exactly.
                      */
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
                          // An existing vault's own type parameter. There is no fallback because there is
            // nothing to fall back to: a vault that exists has a coin type, and guessing one for
            // it would build a transaction against a different generic instantiation entirely.
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
                        // A refused or failed signature must not leave the button spinning.
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

      {/*
        The support vault is a separate object from the paid vault and neither requires the other —
        a creator can take deposits without selling anything, or sell without taking deposits. It
        appears once they have an account, because `stake_vault::open` needs one exactly as
        `open_vault` does.
      */}
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
          // Price by string manipulation, never parseFloat × 1e6 — 0.07 becomes
          // 69999.99999999999 that way, and the tier would be listed at a price nobody chose.
          const t = tier.price.trim();
          /*
           * Scaled by the vault's own decimals. Fixed at six, a price of "5" on a nine-decimal coin
           * became five thousandths of one — the tier is created, the transaction succeeds, and the
           * creator sells at a thousandth of their intended price until somebody notices.
           *
           * A vault with no known decimals cannot price anything, so nothing is submitted.
           */
          if (vault.decimals === null) return;
          const places = vault.decimals;
          if (!new RegExp(`^\\d+(\\.\\d{1,${places}})?$`).test(t)) return;
          const [whole = '0', frac = ''] = t.split('.');
          onSimulate({
            vaultId: vault.vaultId,
            capId: vault.capId,
            // An existing vault's own type parameter. There is no fallback because there is
            // nothing to fall back to: a vault that exists has a coin type, and guessing one for
            // it would build a transaction against a different generic instantiation entirely.
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
