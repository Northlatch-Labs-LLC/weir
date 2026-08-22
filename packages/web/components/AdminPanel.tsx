'use client';
// Built-by: @projectx.sui /|\ · Co-authored-by: Claude

/**
 * # Nothing here is gated by this component
 *
 * The controls are hidden from somebody without a `PlatformCap`, and that hiding is a courtesy
 * rather than a defence. Every administrative function in `platform.move` takes the capability by
 * reference, so the chain refuses a caller who does not hold it whatever this interface renders.
 *
 * # A failed read is not "you are not an administrator"
 */

import { useEffect, useState } from 'react';
import { useSigner } from '@/components/SignerProvider';
import { SignIn } from '@/components/SignIn';
import { AdminControls } from '@/components/AdminControls';
import { PlatformRevenue } from '@/components/PlatformRevenue';
import { formatSui } from '@/lib/units';

interface PlatformView {
  feeBps: string;
  referralShareBps: string;
  creationFeeMist: string;
  creationPaused: boolean;
  paymentsPaused: boolean;
  treasuryMist: string;
  accountsCreated: string;
  vaultsCreated: string;
}

type State =
  | { name: 'idle' }
  | { name: 'loading' }
  | { name: 'read'; isAdmin: boolean; capId: string | null; platform: PlatformView | null }
  | { name: 'unmeasured'; detail: string };

/** Mist to SUI. String arithmetic — `Number` loses precision above 2^53, and this is a treasury. */
const sui = formatSui;

/** Basis points as a percentage, without floating point. 250 → "2.5%". */
function pct(bps: string): string {
  const value = BigInt(bps);
  const whole = value / 100n;
  const frac = (value % 100n).toString().padStart(2, '0').replace(/0+$/, '');
  return frac === '' ? `${whole}%` : `${whole}.${frac}%`;
}

export function AdminPanel() {
  const { signer } = useSigner();
  const [state, setState] = useState<State>({ name: 'idle' });

  useEffect(() => {
    const address = signer?.address;
    if (address === undefined) {
      setState({ name: 'idle' });
      return;
    }
    let cancelled = false;
    setState({ name: 'loading' });

    void (async () => {
      try {
        const response = await fetch(`/api/admin?address=${encodeURIComponent(address)}`);
        const body = (await response.json()) as {
          isAdmin?: boolean;
          capId?: string | null;
          platform?: PlatformView | null;
          error?: string;
        };
        if (cancelled) return;
        if (body.isAdmin === undefined) {
          setState({ name: 'unmeasured', detail: body.error ?? 'the platform did not answer' });
          return;
        }
        setState({
          name: 'read',
          isAdmin: body.isAdmin,
          capId: body.capId ?? null,
          platform: body.platform ?? null,
        });
      } catch (cause) {
        if (!cancelled) {
          setState({
            name: 'unmeasured',
            detail: cause instanceof Error ? cause.message : String(cause),
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [signer?.address]);

  if (signer === null) {
    return (
      <div className="panel">
        <p style={{ marginTop: 0 }}>
          Administering this platform means holding its <span className="mono">PlatformCap</span>.
          Sign in so we can ask the chain whether your address does.
        </p>
        <SignIn />
      </div>
    );
  }

  if (state.name === 'loading' || state.name === 'idle') {
    return (
      <div className="panel" role="status">
        <p style={{ margin: 0, color: 'var(--text-tertiary)' }}>Reading the chain…</p>
      </div>
    );
  }

  if (state.name === 'unmeasured') {
    return (
      <div className="note crit" role="alert">
        <span className="lbl">Not measured</span>
        <p>
          {state.detail} Nothing is shown either way — a failed read is not an answer about who you
          are, and treating it as one would lock you out at the worst moment.
        </p>
      </div>
    );
  }

  const { platform } = state;

  return (
    <>
      {!state.isAdmin && (
        <div className="note warn">
          <span className="lbl">Read only</span>
          <p>
            This address holds no <span className="mono">PlatformCap</span> for this platform, so
            the controls are not offered. The figures below are public and readable by anyone.
          </p>
        </div>
      )}

      {platform === null ? (
        <div className="note crit" role="alert">
          <span className="lbl">Not measured</span>
          <p>The platform object could not be read, so none of its terms are shown.</p>
        </div>
      ) : (
        <>
          <div className="card">
            <span className="k">STATUS</span>
            <div className="tiers" style={{ marginTop: 'var(--space-12)' }}>
              <div className="stat">
                <span className="k">Vault creation</span>
                <span className="v" style={{ color: platform.creationPaused ? 'var(--text-danger)' : 'var(--text-prize)' }}>
                  {platform.creationPaused ? 'Paused' : 'Open'}
                </span>
              </div>
              <div className="stat">
                <span className="k">Payments</span>
                <span className="v" style={{ color: platform.paymentsPaused ? 'var(--text-danger)' : 'var(--text-prize)' }}>
                  {platform.paymentsPaused ? 'Paused' : 'Open'}
                </span>
              </div>
            </div>
          </div>

          <div className="card" style={{ marginTop: 'var(--space-20)' }}>
            <span className="k">TERMS</span>
            <div className="tiers" style={{ marginTop: 'var(--space-12)' }}>
              <div className="stat">
                <span className="k">Platform fee</span>
                <span className="v">{pct(platform.feeBps)}</span>
              </div>
              <div className="stat">
                <span className="k">Referral share</span>
                <span className="v">{pct(platform.referralShareBps)}</span>
              </div>
              <div className="stat">
                <span className="k">Vault creation fee</span>
                <span className="v">{sui(platform.creationFeeMist)} SUI</span>
              </div>
            </div>
            <p className="locked-why" style={{ marginBottom: 0 }}>
              The referral share is a share <em>of the platform fee</em>, not of the gross — a
              referral can never reduce what a creator earns. Changing these affects vaults opened
              afterwards; every existing vault keeps the fee stamped into it at creation.
            </p>
          </div>

          <div className="card" style={{ marginTop: 'var(--space-20)' }}>
            <span className="k">MEASURED</span>
            <div className="tiers" style={{ marginTop: 'var(--space-12)' }}>
              <div className="stat">
                <span className="k">Treasury</span>
                <span className="v">{sui(platform.treasuryMist)} SUI</span>
              </div>
              <div className="stat">
                <span className="k">Accounts</span>
                <span className="v">{BigInt(platform.accountsCreated).toLocaleString('en-US')}</span>
              </div>
              <div className="stat">
                <span className="k">Vaults</span>
                <span className="v">{BigInt(platform.vaultsCreated).toLocaleString('en-US')}</span>
              </div>
            </div>
          </div>

          {/*
            Revenue renders for any signed-in viewer, not only the capability holder, because every
            figure in it is already public — shared vault objects and on-chain events. The collect
            button inside it is what needs the capability, and the chain enforces that.
          */}
          <PlatformRevenue address={state.isAdmin ? signer.address : null} />

          {state.isAdmin && (
            <>
              <div className="note" style={{ marginTop: 'var(--space-20)' }}>
                <span className="lbl">You hold the capability</span>
                <p className="mono" style={{ overflowWrap: 'anywhere' }}>{state.capId}</p>
              </div>

              <AdminControls
                address={signer.address}
                feeBps={platform.feeBps}
                referralShareBps={platform.referralShareBps}
                creationFeeMist={platform.creationFeeMist}
                creationPaused={platform.creationPaused}
                paymentsPaused={platform.paymentsPaused}
                treasuryMist={platform.treasuryMist}
              />
            </>
          )}
        </>
      )}
    </>
  );
}
