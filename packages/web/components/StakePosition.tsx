'use client';
// Built-by: @projectx.sui /|\ · Co-authored-by: Claude

/**
 * A supporter's position in a vault: what they put in, what it has earned, and getting it back.
 *
 * # The withdraw button is what makes the no-loss guarantee real
 *
 * The contract's promise is that principal stays the depositor's and is redeemable in full at any
 * time; the creator earns only the yield it generates. That property is only as good as this
 * control, so the withdraw path is the one this component exists to get right.
 *
 * # Principal and yield are never added together
 *
 * They are different money with different owners. Principal is the supporter's and is redeemable
 * one for one; realised yield belongs to the creator, minus whatever share of it the creator has
 * chosen to hand back. A single "your balance" figure would blur the one guarantee worth making.
 *
 * # The rebate figure is a lower bound, and says so
 *
 * The contract accrues on interaction, so yield earned since the supporter last touched the vault
 * is not yet in `pending`. Presenting it as a total would overstate on a rising number, which is
 * the direction that eventually looks like a bug to the person reading it.
 */

import { useCallback, useEffect, useState } from 'react';
import { useSigner } from '@/components/SignerProvider';
import { SignIn } from '@/components/SignIn';
import { formatUnits, SUI_DECIMALS } from '@/lib/units';

const sui = (mist: string) => formatUnits(BigInt(mist), SUI_DECIMALS);

interface VaultView {
  vaultId: string; creator: string; handle: string | null; validator: string;
  accepting: boolean; totalPrincipalMist: string; liquidMist: string; stakedMist: string;
  tranches: number; lifetimeYieldMist: string; harvests: string; creatorYieldMist: string;
  rebatePoolMist: string; rebateBps: string; solvent: boolean;
}
interface Position { principalMist: string; pendingRebateMist: string }

type Load =
  | { state: 'idle' | 'loading' }
  | { state: 'ready'; vault: VaultView; position: Position | null }
  | { state: 'unmeasured'; detail: string };

export function StakePosition({ vaultId }: { vaultId: string }) {
  const { signer } = useSigner();
  const [accountId, setAccountId] = useState<string | null>(null);
  const [load, setLoad] = useState<Load>({ state: 'idle' });
  const [amount, setAmount] = useState('');
  const [quote, setQuote] = useState<{ what: 'withdraw' | 'rebate'; bytes: string; gasMist: string } | null>(null);
  const [digest, setDigest] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (who: string) => {
    setLoad({ state: 'loading' });
    try {
      const r = await fetch(`/api/stake?vault=${encodeURIComponent(vaultId)}&who=${encodeURIComponent(who)}`);
      const b = (await r.json()) as { vault?: VaultView; position?: Position | null; error?: string };
      if (b.vault === undefined) {
        setLoad({ state: 'unmeasured', detail: b.error ?? `the chain returned ${r.status}` });
        return;
      }
      setLoad({ state: 'ready', vault: b.vault, position: b.position ?? null });
    } catch (e) {
      setLoad({ state: 'unmeasured', detail: e instanceof Error ? e.message : String(e) });
    }
  }, [vaultId]);

  useEffect(() => {
    if (signer === null) return;
    void refresh(signer.address);
    // Withdrawing needs the SocialAccount object — the contract authenticates against it, so a
    // supporter without one cannot withdraw and should be told before they try.
    void fetch(`/api/creator?owner=${encodeURIComponent(signer.address)}`)
      .then((r) => r.json())
      .then((b: { accountId?: string }) => setAccountId(b.accountId ?? null))
      .catch(() => setAccountId(null));
  }, [signer, refresh]);

  async function simulate(what: 'withdraw' | 'rebate') {
    if (signer === null || accountId === null) return;
    setBusy(true); setError(null); setQuote(null); setDigest(null);
    try {
      const url = what === 'withdraw' ? '/api/stake/withdraw' : '/api/stake/rebate';
      const payload: Record<string, string> = {
        sender: signer.address, vaultId, accountId,
      };
      if (what === 'withdraw') {
        const typed = amount.trim();
        const all = load.state === 'ready' ? (load.position?.principalMist ?? '0') : '0';
        if (typed === '') payload['amountMist'] = all;
        else {
          if (!/^\d+(\.\d{1,9})?$/.test(typed)) { setError('Enter an amount in SUI, for example 0.5'); return; }
          const [whole = '0', frac = ''] = typed.split('.');
          // String arithmetic. A float here would be off by a unit on values people actually type,
          // and an exact-amount withdrawal would either abort or strand dust forever.
          payload['amountMist'] = BigInt(whole + frac.padEnd(9, '0')).toString();
        }
      }
      const r = await fetch(url, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
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
      // Whatever signed this — a browser extension or a zero-knowledge proof over a Google
      // sign-in — the bytes submitted are the bytes simulated, unchanged.
      const signature = await signer.signTransaction(quote.bytes);
      const r = await fetch('/api/checkout/submit', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ bytes: quote.bytes, signature }),
      });
      const b = (await r.json()) as { digest?: string; error?: string };
      if (b.digest === undefined) { setError(b.error ?? 'that was not accepted'); return; }
      setDigest(b.digest);
      setQuote(null);
      setAmount('');
      // Re-read rather than subtracting locally: the balance after a withdrawal is a fact on chain.
      await refresh(signer.address);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  if (signer === null) {
    return (
      <div className="panel">
        <p style={{ marginTop: 0, color: 'var(--text-secondary)' }}>
          Sign in to see what you have deposited here and to take it back.
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
          The vault could not be read ({load.detail}). This is <strong>not</strong> a zero balance:
          nothing is shown and nothing is offered, because a page that displayed 0 here would be
          telling you your deposit is gone.
        </p>
      </div>
    );
  }

  if (load.state !== 'ready') {
    return <div className="panel"><p style={{ margin: 0, color: 'var(--text-tertiary)' }}>Reading the vault…</p></div>;
  }

  const { vault, position } = load;
  const principal = BigInt(position?.principalMist ?? '0');
  const rebate = BigInt(position?.pendingRebateMist ?? '0');

  return (
    <>
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

      {!vault.solvent && (
        <div className="note crit" style={{ marginBottom: 'var(--space-20)' }}>
          <span className="lbl">Invariant violated</span>
          <p>
            The vault reports less backing than principal. The contract asserts against this on
            every path that moves money, so seeing it here means something is wrong that should be
            investigated before depositing anything further.
          </p>
        </div>
      )}

      <div className="card">
        <span className="k">YOUR DEPOSIT</span>
        <div style={{ display: 'grid', gap: 'var(--space-20)', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', marginTop: 'var(--space-12)' }}>
          <div className="stat">
            <span className="k">Principal (yours)</span>
            <span className="v" style={{ color: principal > 0n ? 'var(--text-prize)' : undefined }}>
              {sui(position?.principalMist ?? '0')}
            </span>
          </div>
          <div className="stat">
            <span className="k">Your share accrued</span>
            <span className="v">{sui(position?.pendingRebateMist ?? '0')}</span>
          </div>
        </div>

        {position === null ? (
          <p className="section-note" style={{ marginBottom: 0 }}>
            You have not deposited here. This is a measured answer — the vault&rsquo;s table was
            read and holds no entry for your address.
          </p>
        ) : (
          <p className="locked-why">
            Your share is a lower bound: the contract accrues on interaction, so anything earned
            since you last touched this vault is not in that figure yet.
          </p>
        )}
      </div>

      {principal > 0n && (
        <div className="card">
          <span className="k">TAKE IT BACK</span>
          <p style={{ color: 'var(--text-secondary)', margin: 'var(--space-10) 0 var(--space-16)' }}>
            In full, at any time, with no waiting period and no approval. If the vault&rsquo;s liquid
            balance is short, the contract unwinds delegated stake in this same transaction. The
            forgone yield is the creator&rsquo;s loss, never yours.
          </p>

          {accountId === null ? (
            <div className="note warn">
              <span className="lbl">No account object at this address</span>
              <p>
                <span className="mono">withdraw</span> authenticates against a{' '}
                <span className="mono">SocialAccount</span>, and this address holds none.{' '}
                <a href="/join">Claim a handle</a> to withdraw.
              </p>
            </div>
          ) : quote?.what === 'withdraw' ? (
            <div className="note">
              <span className="lbl">Checked against the chain. Nothing signed yet</span>
              <p>Gas <strong>{sui(quote.gasMist)} SUI</strong>. The principal returns to this address.</p>
              <div style={{ display: 'flex', gap: 'var(--space-8)', marginTop: 'var(--space-12)' }}>
                <button className="btn" type="button" disabled={busy} onClick={() => void signAndSubmit()}>
                  {busy ? 'Waiting for your signature…' : 'Sign and withdraw'}
                </button>
                <button className="btn ghost" type="button" disabled={busy} onClick={() => setQuote(null)}>Back</button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 'var(--space-8)', flexWrap: 'wrap' }}>
              <input
                className="comment-input" style={{ maxWidth: 220 }} inputMode="decimal"
                aria-label="Amount of SUI to withdraw"
                placeholder={`All of it: ${sui(position?.principalMist ?? '0')} SUI`}
                value={amount} onChange={(e) => setAmount(e.target.value)}
              />
              <button className="btn" type="button" disabled={busy} onClick={() => void simulate('withdraw')}>
                {busy ? 'Checking…' : 'Withdraw'}
              </button>
            </div>
          )}
        </div>
      )}

      {rebate > 0n && accountId !== null && (
        <div className="card">
          <span className="k">YOUR SHARE OF THE YIELD</span>
          <p style={{ color: 'var(--text-secondary)', margin: 'var(--space-10) 0 var(--space-16)' }}>
            This creator returns {Number(vault.rebateBps) / 100}% of the yield to supporters.
            You have <strong>{sui(position?.pendingRebateMist ?? '0')} SUI</strong> accrued.
          </p>
          {quote?.what === 'rebate' ? (
            <div className="note">
              <span className="lbl">Checked against the chain. Nothing signed yet</span>
              <p>Gas <strong>{sui(quote.gasMist)} SUI</strong>.</p>
              <div style={{ display: 'flex', gap: 'var(--space-8)', marginTop: 'var(--space-12)' }}>
                <button className="btn" type="button" disabled={busy} onClick={() => void signAndSubmit()}>
                  {busy ? 'Waiting for your signature…' : 'Sign and claim'}
                </button>
                <button className="btn ghost" type="button" disabled={busy} onClick={() => setQuote(null)}>Back</button>
              </div>
            </div>
          ) : (
            <button className="btn" type="button" disabled={busy} onClick={() => void simulate('rebate')}>
              {busy ? 'Checking…' : 'Claim my share'}
            </button>
          )}
        </div>
      )}

      {error !== null && <p className="unmeasured">{error}</p>}
    </>
  );
}
