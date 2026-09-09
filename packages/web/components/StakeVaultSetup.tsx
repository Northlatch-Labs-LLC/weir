'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude

/**
 * The creator's side of the support vault: open it, set the supporters' share, take the yield.
 *
 * # Choosing a validator is permanent, and the commission is not shown
 *
 * The validator is stamped into the vault and cannot be changed afterwards. Its commission comes
 * off yield before the vault ever sees it, so this choice sets a floor on what supporters can ever
 * generate here.
 *
 * No commission figure appears below, deliberately. Sui's gRPC system state does not carry the
 * validator set, and a number read once would be right for about a day — validators can change it
 * at any epoch boundary, and a stale figure on a permanent decision is worse than none because it
 * gets believed. The page says what commission does and where to check it live instead.
 */

import { useCallback, useEffect, useState } from 'react';
import { MIN_STAKE_MIST, RUNGS, ladderHealth, sui as suiOf } from '@/lib/ladder';
import { useSigner } from '@/components/SignerProvider';
import { SignIn } from '@/components/SignIn';
import { formatUnits, SUI_DECIMALS } from '@/lib/units';

const sui = (mist: string) => formatUnits(BigInt(mist), SUI_DECIMALS);

interface VaultView {
  vaultId: string; validator: string; accepting: boolean;
  totalPrincipalMist: string; stakedMist: string; lifetimeYieldMist: string;
  creatorYieldMist: string; rebatePoolMist: string; rebateBps: string;
  harvests: string; tranches: number; solvent: boolean;
}

export function StakeVaultSetup({ accountId }: { accountId: string }) {
  const { signer } = useSigner();
  const [caps, setCaps] = useState<Array<{ capId: string; vaultId: string }> | 'unknown'>('unknown');
  /** Which of them is on screen. `null` until the list arrives, or when there are none. */
  const [selected, setSelected] = useState<string | null>(null);

  /*
    Kept as the same three-state value the rest of this component already reads: 'unknown' while
    the chain has not answered, `null` for "no vault", and the cap itself otherwise. Deriving it
    means the branches below did not have to change, and there is only one place that decides which
    vault is current.
  */
  const cap: { capId: string; vaultId: string } | null | 'unknown' =
    caps === 'unknown' ? 'unknown' : (caps.find((c) => c.vaultId === selected) ?? null);
  const [vault, setVault] = useState<VaultView | null>(null);
  const [validator, setValidator] = useState('');

  const [suggested, setSuggested] = useState<{ address: string; name: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/stake/suggested')
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { validator?: { address: string; name: string } | null } | null) => {
        // Only prefills an empty field. Overwriting something the creator has typed because a
        // fetch landed late would change a permanent choice under them.
        if (!cancelled && b?.validator != null) {
          setSuggested(b.validator);
          setValidator((current) => (current === '' ? b.validator!.address : current));
        }
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);
  const [rebate, setRebate] = useState('');
  const [claim, setClaim] = useState('');
  const [quote, setQuote] = useState<{ what: string; bytes: string; gasMist: string } | null>(null);
  const [digest, setDigest] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /*
    Every vault this address holds a cap for, not the first one.

    The endpoint used to answer with a single cap or null, so a creator with two support vaults was
    shown one and told that was all — while `/c/<handle>` listed both, because that page reads them
    from events instead. The selection survives a refresh when the chosen vault is still there, so
    acting on the second vault does not silently bounce back to the first.
  */
  const refresh = useCallback(async (owner: string) => {
    try {
      const r = await fetch(`/api/stake?owner=${encodeURIComponent(owner)}`);
      const b = (await r.json()) as {
        stakeCaps?: Array<{ capId: string; vaultId: string }>;
        error?: string;
      };
      if (b.stakeCaps === undefined) { setError(b.error ?? 'could not read your vaults'); return; }
      const found = b.stakeCaps;
      setCaps(found);
      setSelected((current) =>
        current !== null && found.some((c) => c.vaultId === current)
          ? current
          : (found[0]?.vaultId ?? null),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  /* The chosen vault's state, refetched whenever the choice changes. */
  useEffect(() => {
    if (selected === null) { setVault(null); return; }
    let cancelled = false;
    void fetch(`/api/stake?vault=${encodeURIComponent(selected)}`)
      .then((r) => r.json())
      .then((vb: { vault?: VaultView }) => { if (!cancelled) setVault(vb.vault ?? null); })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [selected]);

  useEffect(() => { if (signer !== null) void refresh(signer.address); }, [signer, refresh]);


  async function simulate(what: string, url: string, payload: Record<string, string>) {
    if (signer === null) return;
    setBusy(true); setError(null); setQuote(null); setDigest(null);
    try {
      const r = await fetch(url, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sender: signer.address, ...payload }),
      });
      const b = (await r.json()) as { quote?: { bytes: string; gasMist: string }; error?: string };
      if (b.quote === undefined) setError(b.error ?? 'that could not be simulated');
      else setQuote({ what, bytes: b.quote.bytes, gasMist: b.quote.gasMist });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  async function signAndSubmit() {
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
      setDigest(b.digest); setQuote(null); setRebate(''); setClaim('');
      await refresh(signer.address);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  const confirmable = (what: string, describe: string) =>
    quote?.what === what ? (
      <div className="note">
        <span className="lbl">Checked against the chain. Nothing signed yet</span>
        <p>{describe} Gas <strong>{sui(quote.gasMist)} SUI</strong>.</p>
        <div style={{ display: 'flex', gap: 'var(--space-8)', marginTop: 'var(--space-12)' }}>
          <button className="btn" type="button" disabled={busy} onClick={() => void signAndSubmit()}>
            {busy ? 'Waiting for your signature…' : 'Sign and confirm'}
          </button>
          <button className="btn ghost" type="button" disabled={busy} onClick={() => setQuote(null)}>Back</button>
        </div>
      </div>
    ) : null;

  if (signer === null) {
    return (
      <div className="panel">
        <p style={{ marginTop: 0, color: 'var(--text-secondary)' }}>
          A support vault lets people back you without spending anything: they deposit, you earn the
          staking yield, and their principal stays theirs.
        </p>
        <SignIn />
        {error !== null && <p className="unmeasured">{error}</p>}
      </div>
    );
  }

  if (cap === 'unknown') {
    /*
     * A failed read leaves `cap` on 'unknown', so without this branch the screen said "Reading the
     * chain…" forever while the error sat in state, rendered only by the two branches that are
     * never reached. Waiting indefinitely with no explanation is worse than a stated failure.
     *
     * It deliberately does not fall through to the open form. 'unknown' is not 'they have no
     * vault' — offering `open` here would let a creator create a second vault they did not know
     * they already had, which the contract permits and nobody wants.
     */
    return (
      <div className="panel">
        {error === null ? (
          <p style={{ margin: 0, color: 'var(--text-tertiary)' }}>Reading the chain…</p>
        ) : (
          <p className="unmeasured" style={{ margin: 0 }}>{error}</p>
        )}
      </div>
    );
  }

  if (cap === null) {
    return (
      <div className="panel">
        <h2 style={{ fontSize: 'var(--text-h3)', marginBottom: 'var(--space-10)' }}>Open a support vault</h2>
        <p style={{ color: 'var(--text-secondary)' }}>
          Members deposit SUI, it is delegated to a validator, and you receive the yield. Their
          principal is never touched and they can withdraw in full at any time.
        </p>

        <label className="k" htmlFor="validator" style={{ display: 'block', marginTop: 'var(--space-16)' }}>
          VALIDATOR · PERMANENT, CANNOT BE CHANGED LATER
        </label>
        <input
          id="validator" className="comment-input" style={{ width: '100%', marginTop: 'var(--space-6)' }}
          value={validator} onChange={(e) => setValidator(e.target.value)}
        />
        <p className="locked-why">
          Their commission is taken from the yield before your vault sees it, and they can change it
          at any epoch boundary. No figure is shown here because it would be stale within days. Check
          it live with <span className="mono">sui validator display-metadata</span> or on an
          explorer before you commit.{' '}
          {suggested !== null
            ? `${suggested.name} is prefilled because it is what Weir's own vault uses.`
            : 'No validator is suggested here, so this is entirely your choice.'}
        </p>

        {confirmable('open', 'Opens your support vault.') ?? (
          <button
            className="btn" type="button" disabled={busy} style={{ marginTop: 'var(--space-12)' }}
            onClick={() => void simulate('open', '/api/stake/vault', { accountId, validator })}
          >
            {busy ? 'Checking…' : 'Open the vault'}
          </button>
        )}
        {error !== null && <p className="unmeasured">{error}</p>}
      </div>
    );
  }

  const yieldMist = BigInt(vault?.creatorYieldMist ?? '0');

  return (
    <>
      {/*
        Which vault, when there is more than one. Withheld for a single vault, where a picker with
        one option is a control that asks a question with no alternative answer.
      */}
      {caps !== 'unknown' && caps.length > 1 && (
        <div className="panel" style={{ marginBottom: 'var(--space-20)' }}>
          <label className="k" htmlFor="sv">
            YOU HOLD {caps.length} SUPPORT VAULTS · SHOWING
          </label>
          <select
            id="sv"
            className="field"
            value={selected ?? ''}
            onChange={(e) => {
              setSelected(e.target.value);
              // A quote and a digest belong to the vault they were made for.
              setQuote(null);
              setDigest(null);
            }}
          >
            {caps.map((c, i) => (
              <option key={c.vaultId} value={c.vaultId}>
                Vault {i + 1} · {c.vaultId.slice(0, 16)}…
              </option>
            ))}
          </select>
        </div>
      )}

      {digest !== null && (
        <div className="note" style={{ marginBottom: 'var(--space-20)' }}>
          <span className="lbl">Done</span>
          <p>
            <a href={`https://suiscan.xyz/mainnet/tx/${digest}`} target="_blank" rel="noreferrer">
              <span className="mono">{digest.slice(0, 14)}…</span>
            </a>
          </p>
        </div>
      )}

      <div className="card">
        <div className="byline">
          <span className="avatar" aria-hidden>SV</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <span className="byline-name">Your support vault</span>
            <div className="byline-meta">
              <a className="mono" href={`/vault/${cap.vaultId}`}>{cap.vaultId.slice(0, 16)}…</a>
            </div>
          </div>
          <span className={vault?.accepting ? 'pill subs' : 'pill'}>
            {vault?.accepting ? 'Accepting' : 'Closed'}
          </span>
        </div>

        {/*
          The creator should learn this before a supporter does.

          A vault under the minimum stake earns nothing at all and says so nowhere else: the daemon
          declines correctly, no error is raised, and the numbers above render a healthy-looking
          zero. The creator is the one person who can fix it.
        */}
        {(() => {
          const health = ladderHealth(BigInt(vault?.totalPrincipalMist ?? '0'));
          if (health.kind === 'full') return null;
          return health.kind === 'idle' ? (
            <div className="note warn" style={{ marginBottom: 'var(--space-16)' }}>
              <span className="lbl">Nothing here is earning yet</span>
              <p>
                Sui will not delegate less than {suiOf(MIN_STAKE_MIST)} SUI. Until this vault holds
                that much, deposits sit liquid and produce no yield for you. It is{' '}
                {suiOf(health.shortfallMist)} SUI short. Nobody&rsquo;s principal is at risk; it
                simply is not working.
              </p>
            </div>
          ) : (
            <div className="note" style={{ marginBottom: 'var(--space-16)' }}>
              <span className="lbl">Earning on a partial ladder</span>
              <p>
                {health.rungs.toString()} of {RUNGS.toString()} rungs funded, so yield arrives in
                bursts rather than every epoch. Another {suiOf(health.shortfallMist)} SUI deposited
                would fill it.
              </p>
            </div>
          );
        })()}

        <div style={{ display: 'grid', gap: 'var(--space-20)', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
          <div className="stat">
            <span className="k">Supporting you</span>
            <span className="v">{sui(vault?.totalPrincipalMist ?? '0')}</span>
          </div>
          <div className="stat">
            <span className="k">Yield realised</span>
            <span className="v">{sui(vault?.lifetimeYieldMist ?? '0')}</span>
          </div>
          <div className="stat">
            <span className="k">Yours to claim</span>
            <span className="v" style={{ color: yieldMist > 0n ? 'var(--text-prize)' : undefined }}>
              {sui(vault?.creatorYieldMist ?? '0')}
            </span>
          </div>
          <div className="stat">
            <span className="k">Members&rsquo; share</span>
            <span className="v">{Number(vault?.rebateBps ?? '0') / 100}%</span>
          </div>
        </div>

        <p className="locked-why">
          Principal shown here is <strong>not yours</strong>: it belongs to the people who deposited
          it and they can take it back at any moment. Only the yield column is your revenue.
        </p>
      </div>

      <div className="card">
        <span className="k">CLAIM YOUR YIELD</span>
        {yieldMist === 0n ? (
          <p className="section-note" style={{ marginBottom: 0 }}>
            Nothing realised yet. A tranche must mature before its yield exists: this is a measured
            zero, not a failed read.
          </p>
        ) : confirmable('yield', `Withdraws ${sui(claim.trim() === '' ? (vault?.creatorYieldMist ?? '0') : claim)} SUI of yield.`) ?? (
          <div style={{ display: 'flex', gap: 'var(--space-8)', flexWrap: 'wrap', marginTop: 'var(--space-10)' }}>
            <input
              className="comment-input" style={{ maxWidth: 200 }} inputMode="decimal"
              aria-label="Amount of yield to claim"
              placeholder={`All of it: ${sui(vault?.creatorYieldMist ?? '0')}`}
              value={claim} onChange={(e) => setClaim(e.target.value)}
            />
            <button
              className="btn" type="button" disabled={busy}
              onClick={() => {
                const typed = claim.trim();
                let amountMist = vault?.creatorYieldMist ?? '0';
                if (typed !== '') {
                  if (!/^\d+(\.\d{1,9})?$/.test(typed)) { setError('Enter an amount in SUI'); return; }
                  const [whole = '0', frac = ''] = typed.split('.');
                  amountMist = BigInt(whole + frac.padEnd(9, '0')).toString();
                }
                void simulate('yield', '/api/stake/yield', { vaultId: cap.vaultId, capId: cap.capId, amountMist });
              }}
            >
              {busy ? 'Checking…' : 'Claim'}
            </button>
          </div>
        )}
      </div>

      <div className="card">
        <span className="k">GIVE SUPPORTERS A SHARE</span>
        <p style={{ color: 'var(--text-secondary)', margin: 'var(--space-10) 0 var(--space-16)' }}>
          A percentage of the yield handed back to the people funding it, out of{' '}
          <strong>your</strong> share rather than the platform&rsquo;s. It starts at zero, because a
          share nobody chose should not quietly redirect your revenue. Setting it to 100% is
          allowed. Some creators run the vault purely as a give-back to their audience.
        </p>
        {confirmable('rebate', `Sets the members' share to ${rebate || '0'}%.`) ?? (
          <div style={{ display: 'flex', gap: 'var(--space-8)', flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              className="comment-input" style={{ maxWidth: 120 }} inputMode="decimal"
              aria-label="Members' share, percent"
              placeholder={`${Number(vault?.rebateBps ?? '0') / 100}%`}
              value={rebate} onChange={(e) => setRebate(e.target.value)}
            />
            <button
              className="btn" type="button" disabled={busy}
              onClick={() => {
                const typed = rebate.trim();
                if (!/^\d+(\.\d{1,2})?$/.test(typed)) { setError('Enter a percentage, for example 20'); return; }
                // Percent to basis points, by string arithmetic — 12.34% is 1234 bps exactly, where
                // Math.round(12.34 * 100) is a coin flip on the last unit.
                const [whole = '0', frac = ''] = typed.split('.');
                const bps = BigInt(whole + frac.padEnd(2, '0'));
                if (bps > 10_000n) { setError('The share cannot exceed 100%'); return; }
                void simulate('rebate', '/api/stake/settings', {
                  vaultId: cap.vaultId, capId: cap.capId, rebateBps: bps.toString(),
                });
              }}
            >
              {busy ? 'Checking…' : 'Set share'}
            </button>
          </div>
        )}
      </div>

      {error !== null && <p className="unmeasured">{error}</p>}
    </>
  );
}
