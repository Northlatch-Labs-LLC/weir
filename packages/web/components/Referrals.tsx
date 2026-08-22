'use client';
// Built-by: @projectx.sui /|\ · Co-authored-by: Claude

/**
 * Your referral link, who used it, and what it has paid you.
 *
 * # The share comes out of the platform's cut, never the creator's
 *
 * That is the sentence this page exists to make true rather than merely claim. On a 10 USDC
 * subscription at 290 bps with a 5% referral share, ProjectX takes 0.29 and hands 0.0145 of it to
 * the referrer — the creator receives exactly what they would have received anyway. A referral
 * scheme funded out of the creator's earnings would be a pay cut with a friendly name.
 *
 * # Both figures come from chain events
 *
 * Counting referrals in a database written at signup undercounts: the account opens on chain, the
 * row fails to write, and somebody is never credited for a person they brought. `AccountOpened`
 * carries the referrer and `PaymentSettled` carries the cut actually paid, so if the signup
 * happened the referral exists — they are the same fact.
 */

import { useCallback, useEffect, useState } from 'react';
import { useSigner } from '@/components/SignerProvider';
import { SignIn } from '@/components/SignIn';
import { formatUnits, USDC_DECIMALS } from '@/lib/units';

interface Referred { handle: string; owner: string; createdAtMs: number }

type Load =
  | { state: 'idle' | 'loading' }
  | { state: 'ready'; referred: Referred[]; earned: string; payments: number; truncated: boolean }
  | { state: 'unmeasured'; detail: string };

const DECIMALS = USDC_DECIMALS;
const units = (raw: string) => formatUnits(BigInt(raw), USDC_DECIMALS);

export function Referrals() {
  const { signer } = useSigner();
  const [load, setLoad] = useState<Load>({ state: 'idle' });
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (address: string) => {
    setLoad({ state: 'loading' });
    try {
      const r = await fetch(`/api/referrals?address=${encodeURIComponent(address)}`);
      const b = (await r.json()) as {
        referred?: Referred[]; earned?: string; payments?: number; truncated?: boolean; error?: string;
      };
      if (b.referred === undefined || b.earned === undefined) {
        setLoad({ state: 'unmeasured', detail: b.error ?? `the chain returned ${r.status}` });
        return;
      }
      setLoad({
        state: 'ready',
        referred: b.referred,
        earned: b.earned,
        payments: b.payments ?? 0,
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
          Your referral link is your address. Sign in to see it, along with who has used it and what
          it has paid you — both read from chain events rather than from a table this server keeps.
        </p>
        <SignIn />
        {error !== null && <p className="unmeasured">{error}</p>}
      </div>
    );
  }

  // Built from the page's own origin, so it is right in development, in a container and in
  // production without a configured base URL that would be wrong in two of the three.
  const link =
    typeof window === 'undefined' ? '' : `${window.location.origin}/join?ref=${signer.address}`;

  return (
    <>
      <div className="panel">
        <span className="k">YOUR LINK</span>
        <div style={{ display: 'flex', gap: 'var(--space-8)', marginTop: 'var(--space-10)', flexWrap: 'wrap' }}>
          <input className="comment-input" readOnly value={link} onFocus={(e) => e.currentTarget.select()} />
          <button
            className="btn"
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(link).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              });
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <p className="section-note" style={{ marginBottom: 0 }}>
          Whoever registers through this is attributed to you permanently — the referrer is written
          into their account at creation and the protocol has no setter for it.
        </p>
      </div>

      {load.state === 'unmeasured' && (
        <div className="note crit" style={{ marginTop: 'var(--space-20)' }}>
          <span className="lbl">Not measured</span>
          <p>
            Your referrals could not be read ({load.detail}). This is <strong>not</strong> zero
            referrals — it is an unanswered question.
          </p>
        </div>
      )}

      {load.state === 'ready' && (
        <>
          <div
            className="panel"
            style={{
              marginTop: 'var(--space-16)',
              display: 'grid',
              gap: 'var(--space-20)',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            }}
          >
            <div className="stat">
              <span className="k">Earned</span>
              <span className="v" style={{ color: BigInt(load.earned) > 0n ? 'var(--text-prize)' : undefined }}>
                {units(load.earned)}
              </span>
            </div>
            <div className="stat">
              <span className="k">People referred</span>
              <span className="v">{load.referred.length}</span>
            </div>
            <div className="stat">
              <span className="k">Payments credited</span>
              <span className="v">{load.payments}</span>
            </div>
          </div>

          {load.truncated && (
            <div className="note warn" style={{ marginTop: 'var(--space-16)' }}>
              <span className="lbl">Recent, not complete</span>
              <p>A page ceiling stopped the event walk, so these totals are a lower bound.</p>
            </div>
          )}

          {load.referred.length === 0 ? (
            <div className="card empty" style={{ marginTop: 'var(--space-16)' }}>
              Nobody has registered through your link yet. This is a measured zero — the event log
              was read.
            </div>
          ) : (
            <>
              <div className="feed-head"><h2>Who you referred</h2></div>
              {load.referred.map((r) => (
                <div className="card" key={r.owner}>
                  <div className="byline" style={{ marginBottom: 0 }}>
                    <span className="avatar" aria-hidden>{r.handle.slice(0, 2)}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <span className="byline-name">@{r.handle}</span>
                      <div className="byline-meta">
                        joined{' '}
                        {new Date(r.createdAtMs).toLocaleDateString(undefined, {
                          day: 'numeric', month: 'short', year: 'numeric',
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </>
          )}
        </>
      )}
    </>
  );
}
