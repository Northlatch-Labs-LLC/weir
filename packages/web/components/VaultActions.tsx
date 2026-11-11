'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { useEffect, useState } from 'react';
import { useSigner } from '@/components/SignerProvider';
import { SignIn } from '@/components/SignIn';
import { StakePosition } from '@/components/StakePosition';
import { DepositCheckout } from '@/components/DepositCheckout';
import { useCheckout } from '@/components/app/use-checkout';

/*
  The deposit form used to be offered only when this vault appeared in the list built from
  StakeVaultOpened events. That list is capped at ten pages of fifty, so any vault whose event fell
  out of the window became "unknown" and quietly lost its deposit form — including vaults that had
  been working for weeks. The event index is a convenience for discovery; the object is the truth.
  If the object reads, the vault exists, and a read of it is all the evidence a deposit needs.

  The accepting switch is the other half. stake_vault::set_accepting has always existed in the
  contract and was never wired on this side, so a creator had no way to open or close their own
  pool from the product. Both halves are here because a closed vault with no switch is a dead end.
*/
export function VaultActions({
  vaultId,
  exists,
  accepting,
}: {
  vaultId: string;
  exists: boolean;
  accepting: boolean;
}) {
  const { signer } = useSigner();
  const [capId, setCapId] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(accepting);
  const toggle = useCheckout<{ bytes: string }>();

  useEffect(() => {
    if (signer === null) return;
    let cancelled = false;
    void fetch('/api/stake?owner=' + encodeURIComponent(signer.address))
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { stakeCaps?: Array<{ capId: string; vaultId: string }> } | null) => {
        if (cancelled) return;
        const mine = (b?.stakeCaps ?? []).find((c) => c.vaultId === vaultId);
        setCapId(mine === undefined ? null : mine.capId);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [signer, vaultId]);

  if (signer === null) {
    return (
      <div className="card">
        <span className="k">SUPPORT THIS VAULT</span>
        <p className="unmeasured">
          Sign in to deposit, see your position and withdraw it. Your deposit stays yours; this is
          the one place on the platform where the money comes back.
        </p>
        <SignIn />
      </div>
    );
  }

  const owner = capId !== null;

  const ask = async (next: boolean): Promise<void> => {
    if (capId === null) return;
    await toggle.simulate('/api/stake/accepting', {
      sender: signer.address,
      vaultId,
      capId,
      accepting: next,
    });
  };

  return (
    <div className="card">
      <span className="k">YOUR POSITION</span>
      <StakePosition vaultId={vaultId} />

      <div className="feed-head">
        <h2>{isOpen ? "Deposit" : "Closed to new deposits"}</h2>
      </div>

      {!exists ? (
        <div className="note crit">
          <span className="lbl">This vault could not be read</span>
          <p>
            The object did not answer, so no deposit is offered. That is a read failure, not a
            judgement about the vault.
          </p>
        </div>
      ) : isOpen ? (
        <DepositCheckout vaultId={vaultId} />
      ) : (
        <div className="note">
          <p>
            The creator has closed this pool. Nothing already deposited is affected: every
            supporter can still withdraw their own principal in full.
          </p>
        </div>
      )}

      {owner ? (
        <div className="feed-head">
          <h2>You hold this vault</h2>
        </div>
      ) : null}

      {owner && toggle.quote === null ? (
        <button
          type="button"
          className="w-btn w-btn--quiet"
          onClick={() => void ask(!isOpen)}
          disabled={toggle.busy}
        >
          {isOpen ? "Close this pool to new deposits" : "Open this pool to deposits"}
        </button>
      ) : null}

      {toggle.quote === null ? null : (
        <div className="note">
          <p>{isOpen ? "Closing the pool stops new deposits." : "Opening the pool accepts new deposits."} The change is one signed transaction.</p>
          <button type="button" className="w-btn w-btn--primary" onClick={() => void toggle.signAndSubmit()} disabled={toggle.busy}>
            {toggle.busy ? "Waiting for your wallet…" : "Sign and send"}
          </button>
        </div>
      )}

      {toggle.digest === null ? null : (
        <div className="note">
          <p>
            Done. The vault is now {isOpen ? "closed" : "open"} to new deposits.
          </p>
          <button type="button" className="w-btn w-btn--quiet" onClick={() => setIsOpen(!isOpen)}>
            Continue
          </button>
        </div>
      )}

      {toggle.error === null ? null : <p className="note crit">{toggle.error}</p>}
    </div>
  );
}
