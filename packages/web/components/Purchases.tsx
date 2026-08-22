'use client';
// Built-by: @projectx.sui /|\ · Co-authored-by: Claude

/**
 * What you have bought.
 *
 * # An expired subscription still belongs here
 *
 * `readEntitlements` drops them, correctly — an expired subscription grants nothing and a gate
 * should not see it. A receipt is the opposite: hiding a lapsed subscription makes a renewal look
 * like a first purchase, and it removes the one record that shows somebody supported a creator for
 * a year. Both are shown, with the state said plainly.
 *
 * # These are objects, not rows
 *
 * Every line is a `Subscription` or `Unlock` the reader owns on chain. This platform cannot revoke
 * one, edit one, or take one away by shutting down — which is the strongest claim the product makes,
 * so each line links to the object rather than asking to be believed.
 */

import { useCallback, useEffect, useState } from 'react';
import { useSigner } from '@/components/SignerProvider';
import { SignIn } from '@/components/SignIn';
import { formatUnits, USDC_DECIMALS } from '@/lib/units';

interface Sub {
  objectId: string; vaultId: string; handle: string | null; tier: number;
  pricePaid: string; startedAtMs: number; expiresAtMs: number; renewals: number; active: boolean;
}
interface Unlock {
  objectId: string; vaultId: string; handle: string | null; contentKey: string;
  title: string | null; pricePaid: string; purchasedAtMs: number;
}

type Load =
  | { state: 'idle' | 'loading' }
  | { state: 'ready'; subscriptions: Sub[]; unlocks: Unlock[]; truncated: boolean }
  | { state: 'unmeasured'; detail: string };

const DECIMALS = USDC_DECIMALS;
const units = (raw: string) => formatUnits(BigInt(raw), USDC_DECIMALS);

const day = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

export function Purchases() {
  const { signer } = useSigner();
  const [load, setLoad] = useState<Load>({ state: 'idle' });
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (address: string) => {
    setLoad({ state: 'loading' });
    try {
      const r = await fetch(`/api/purchases?buyer=${encodeURIComponent(address)}`);
      const b = (await r.json()) as {
        subscriptions?: Sub[]; unlocks?: Unlock[]; truncated?: boolean; error?: string;
      };
      if (b.subscriptions === undefined || b.unlocks === undefined) {
        setLoad({ state: 'unmeasured', detail: b.error ?? `the chain returned ${r.status}` });
        return;
      }
      setLoad({
        state: 'ready',
        subscriptions: b.subscriptions,
        unlocks: b.unlocks,
        truncated: b.truncated === true,
      });
    } catch (e) {
      setLoad({ state: 'unmeasured', detail: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  useEffect(() => {
    if (signer !== null) void refresh(signer.address);
  }, [signer, refresh]);


  if (signer === null) {
    return (
      <div className="panel">
        <p style={{ marginTop: 0, color: 'var(--text-secondary)' }}>
          Everything you buy here is an object you own on Sui. This platform cannot revoke one, edit
          one, or take it away by shutting down.
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
          Your purchases could not be read ({load.detail}). This is <strong>not</strong> an empty
          history — it is an unanswered question, and the two look identical if nothing says so.
        </p>
      </div>
    );
  }

  if (load.state !== 'ready') {
    return <div className="panel"><p style={{ margin: 0, color: 'var(--text-tertiary)' }}>Reading the chain…</p></div>;
  }

  const nothing = load.subscriptions.length === 0 && load.unlocks.length === 0;

  return (
    <>
      {load.truncated && (
        <div className="note warn" style={{ marginBottom: 'var(--space-20)' }}>
          <span className="lbl">Recent, not complete</span>
          <p>A page ceiling stopped the walk, so older purchases are missing from this list.</p>
        </div>
      )}

      {nothing && (
        <div className="card empty">
          Nothing bought yet. Unlock a post or join a membership and it appears here — the chain was read and your address holds no
          subscriptions or unlocks.
        </div>
      )}

      {load.subscriptions.length > 0 && (
        <>
          <div className="feed-head"><h2>Subscriptions</h2></div>
          {load.subscriptions.map((s) => (
            <div className="card" key={s.objectId}>
              <div className="byline">
                <span className="avatar" aria-hidden>{(s.handle ?? '??').slice(0, 2)}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span className="byline-name">{s.handle === null ? 'Unknown creator' : `@${s.handle}`}</span>
                  <div className="byline-meta">
                    tier {s.tier}
                    {s.renewals > 0 && ` · renewed ${s.renewals}×`}
                  </div>
                </div>
                <span className={s.active ? 'pill subs' : 'pill'}>
                  {s.active ? 'Active' : 'Expired'}
                </span>
              </div>

              <div style={{ display: 'grid', gap: 'var(--space-20)', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))' }}>
                <div className="stat">
                  <span className="k">Paid per period</span>
                  <span className="v">{units(s.pricePaid)}</span>
                </div>
                <div className="stat">
                  <span className="k">Started</span>
                  <span className="v" style={{ fontSize: 'var(--text-body)' }}>{day(s.startedAtMs)}</span>
                </div>
                <div className="stat">
                  <span className="k">{s.active ? 'Runs until' : 'Ended'}</span>
                  <span className="v" style={{ fontSize: 'var(--text-body)' }}>{day(s.expiresAtMs)}</span>
                </div>
              </div>

              <p className="section-note" style={{ marginBottom: 0 }}>
                <a href={`https://suiscan.xyz/mainnet/object/${s.objectId}`} target="_blank" rel="noreferrer">
                  <span className="mono">{s.objectId.slice(0, 14)}…</span>
                </a>{' '}
                — the object you hold
              </p>
            </div>
          ))}
        </>
      )}

      {load.unlocks.length > 0 && (
        <>
          <div className="feed-head"><h2>Unlocked posts</h2></div>
          {load.unlocks.map((u) => (
            <div className="card" key={u.objectId}>
              <div className="byline">
                <span className="avatar" aria-hidden>{(u.handle ?? '??').slice(0, 2)}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span className="byline-name">
                    {u.title ?? <span className="mono">{u.contentKey}</span>}
                  </span>
                  <div className="byline-meta">
                    {u.handle === null ? 'unknown creator' : `@${u.handle}`} · {day(u.purchasedAtMs)}
                  </div>
                </div>
                <span className="pill paid">{units(u.pricePaid)}</span>
              </div>
              <p className="section-note" style={{ margin: 0 }}>
                Yours permanently.{' '}
                <a href={`https://suiscan.xyz/mainnet/object/${u.objectId}`} target="_blank" rel="noreferrer">
                  <span className="mono">{u.objectId.slice(0, 14)}…</span>
                </a>
              </p>
            </div>
          ))}
        </>
      )}
    </>
  );
}
