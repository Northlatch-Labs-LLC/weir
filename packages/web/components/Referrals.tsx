'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { useCallback, useEffect, useState } from 'react';
import { useSigner } from '@/components/SignerProvider';
import { SignIn } from '@/components/SignIn';
import { formatUnits } from '@/lib/units';

interface Referred { handle: string; owner: string; createdAtMs: number }

interface CoinEarning { coinType: string | null; symbol: string | null; decimals: number | null; amount: string }

type Load =
  | { state: 'idle' | 'loading' }
  | { state: 'ready'; referred: Referred[]; earned: CoinEarning[]; payments: number; truncated: boolean }
  | { state: 'unmeasured'; detail: string };

function formatEarning(e: CoinEarning): string {
  if (e.decimals === null) return 'not measured';
  const amount = formatUnits(BigInt(e.amount), e.decimals);
  return e.symbol === null || e.symbol === '' ? amount : `${amount} ${e.symbol}`;
}

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
        referred?: Referred[]; earned?: CoinEarning[]; payments?: number; truncated?: boolean; error?: string;
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
          it has paid you. Both are read from chain events, not from a table this server keeps.
        </p>
        <SignIn />
        {error !== null && <p className="unmeasured">{error}</p>}
      </div>
    );
  }

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
          Whoever registers through this is attributed to you permanently. The referrer is written
          into their account when it opens, and the contract has no way to change it.
        </p>
      </div>

      {load.state === 'unmeasured' && (
        <div className="note crit" style={{ marginTop: 'var(--space-20)' }}>
          <span className="lbl">Not measured</span>
          <p>
            Your referrals could not be read ({load.detail}). This is <strong>not</strong> zero
            referrals. It is an unanswered question.
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
              <span className="v" style={{ color: load.earned.length > 0 ? 'var(--text-prize)' : undefined }}>
                {load.earned.length === 0
                  ? '0'
                  : load.earned.map((e) => formatEarning(e)).join(', ')}
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
              Nobody has registered through your link yet. This is a measured zero; the event log
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
