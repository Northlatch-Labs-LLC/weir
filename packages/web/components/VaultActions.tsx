'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { useSigner } from '@/components/SignerProvider';
import { SignIn } from '@/components/SignIn';
import { StakePosition } from '@/components/StakePosition';
import { DepositCheckout } from '@/components/DepositCheckout';

export function VaultActions({ vaultId, known }: { vaultId: string; known: boolean }) {
  const { signer } = useSigner();

  if (signer === null) {
    return (
      <div className="card">
        <span className="k">SUPPORT THIS VAULT</span>
        <p style={{ color: 'var(--text-secondary)', marginTop: 'var(--space-12)' }}>
          Sign in to deposit, see your position and withdraw it. Your deposit stays yours; this is
          the one place on the platform where the money comes back.
        </p>
        <SignIn />
      </div>
    );
  }

  return (
    <div className="card">
      <span className="k">YOUR POSITION</span>
      <StakePosition vaultId={vaultId} />

      <div className="feed-head" style={{ marginTop: 'var(--space-24)' }}>
        <h2>Deposit</h2>
      </div>
      {/*
        Withheld for a vault this site did not open. The page above says why; repeating the
        explanation next to a form that cannot work would be two notices for one situation.
      */}
      {known ? (
        <DepositCheckout vaultId={vaultId} />
      ) : (
        <div className="note crit">
          <span className="lbl">Unknown vault</span>
          <p>
            No <span className="mono">StakeVaultOpened</span> event names this object, so it was not
            created by this site and no deposit form is offered for it.
          </p>
        </div>
      )}
    </div>
  );
}
