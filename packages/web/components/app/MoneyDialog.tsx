'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import type { ReactNode } from 'react';
import { Avatar, Dialog, Icon } from '@projectx-social/ui';
import { SignIn } from '@/components/SignIn';
import type { Blocker, CheckoutStage } from '@/components/app/use-checkout';

export interface Fact {
  label: string;
  value: ReactNode;
  strong?: boolean;
}

const STAGE_NOTE: Record<CheckoutStage, string> = {
  idle: 'Nothing has been sent yet.',
  'signing-in': 'Sign in to continue.',
  simulating: 'Checking against the chain.',
  'awaiting-signature': 'Checked against the chain. Nothing signed yet.',
  submitting: 'Waiting for your wallet, then sending it.',
  submitted: 'Sent. The chain has it.',
  refused: 'This cannot go ahead.',
  failed: 'It did not go through.',
};

function refusal(blocked: Blocker): ReactNode {
  switch (blocked.kind) {
    case 'no-account':
      return (
        <>
          This needs an account. It is free apart from gas. <a href="/join">Create account</a>.
        </>
      );
    case 'self-payment':
      return 'This is your own vault, so there is nothing to pay.';
    case 'insufficient-balance':
      return (
        <>
          Your wallet holds {blocked.have}, and this needs {blocked.need}.{' '}
          <a href="/add-funds">Add funds</a>, then try again.
        </>
      );
    case 'price-moved':
      return 'The price changed after this page loaded. Reload to see the current price first.';
    case 'tier-inactive':
      return 'The creator has turned this tier off, so it cannot be bought.';
    case 'not-for-sale':
      return 'This is not currently for sale.';
  }
}

/*
  Every decision that moves money looks the same: who it concerns, what you get and what it
  costs as rows read from the chain, one stage line, Cancel and the one button that advances.
  A refusal names its reason and says nothing was spent; a landed transaction shows its digest.
  The flow owns the words and the quote; this owns the shape.
*/
export function MoneyDialog({
  title,
  who,
  lede,
  stage,
  error,
  blocked,
  facts,
  factsNote,
  stageNote,
  fields,
  primaryLabel,
  primaryDisabled = false,
  onPrimary,
  onCancel,
  onClose,
  done,
  foot,
  signInLine,
  refusalNote,
  refusals,
  signed,
  width = 440,
}: {
  title: string;
  who?: { address: string; handle: string; isAgent?: boolean; meta?: string } | undefined;
  lede?: string | undefined;
  stage: CheckoutStage;
  error: string | null;
  blocked: Blocker | null;
  facts: readonly Fact[];
  factsNote?: ReactNode;
  stageNote?: Partial<Record<CheckoutStage, string>> | undefined;
  /* Inputs the decision needs before it can be simulated (an amount, a percentage). */
  fields?: ReactNode;
  primaryLabel: string;
  primaryDisabled?: boolean;
  onPrimary: () => void;
  onCancel: () => void;
  onClose: () => void;
  /* What replaces the body once the chain has it. */
  done?: ReactNode;
  foot?: ReactNode;
  signInLine?: string | undefined;
  refusalNote?: string | undefined;
  /* A flow's own words for a refusal, where the generic sentence would be wrong for it. */
  refusals?: Partial<Record<Blocker['kind'], ReactNode>> | undefined;
  /* Whether the wallet has already signed. Only a flow that knows may say "nothing was signed". */
  signed?: boolean | undefined;
  width?: number;
}) {
  const inFlight = stage === 'submitting';
  const failed = stage === 'failed';
  const note = error ?? stageNote?.[stage] ?? STAGE_NOTE[stage];

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !inFlight) onClose();
      }}
      title={title}
      description={lede}
      busy={inFlight}
      width={width}
    >
      {who === undefined ? null : (
        <div className="w-dialog__who">
          <Avatar address={who.address} isAgent={who.isAgent === true} size={44} />
          <span className="w-handle">
            @{who.handle}
            {who.meta === undefined ? '' : ` · ${who.meta}`}
          </span>
        </div>
      )}

      {stage === 'signing-in' ? (
        <div className="w-dialog__body">
          {signInLine === undefined ? null : <p className="w-dialog__note">{signInLine}</p>}
          <SignIn compact />
        </div>
      ) : stage === 'submitted' ? (
        <div className="w-dialog__body">{done}</div>
      ) : stage === 'refused' && blocked !== null ? (
        <div className="w-dialog__body">
          <p className="w-dialog__lede">{refusals?.[blocked.kind] ?? refusal(blocked)}</p>
          <p className="w-state__money">{refusalNote ?? 'Nothing was spent.'}</p>
          <div className="w-dialog__actions">
            <button type="button" className="w-btn w-btn--quiet" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      ) : (
        <div className="w-dialog__body">
          {fields}
          <dl className="w-dialog__facts">
            {facts.map((fact) => (
              <div key={fact.label} className={fact.strong === true ? 'w-dialog__row w-dialog__row--strong' : 'w-dialog__row'}>
                <dt>{fact.label}</dt>
                <dd>{fact.value}</dd>
              </div>
            ))}
            {factsNote === undefined ? null : <p className="w-dialog__note">{factsNote}</p>}
          </dl>

          <p className={failed ? 'w-stage w-stage--failed w-dialog__stage' : 'w-stage w-dialog__stage'} role="status">
            {note}
          </p>
          {failed && signed === false ? <p className="w-state__money">Nothing was signed.</p> : null}

          <div className="w-dialog__actions">
            <button type="button" className="w-btn w-btn--quiet" onClick={onCancel} disabled={inFlight}>
              Cancel
            </button>
            <button type="button" className="w-btn w-btn--primary" disabled={primaryDisabled || inFlight} onClick={onPrimary}>
              {primaryLabel}
            </button>
          </div>

          {foot === undefined ? null : <p className="w-dialog__foot">{foot}</p>}
        </div>
      )}
    </Dialog>
  );
}

export function DigestLine({ digest }: { digest: string }) {
  return (
    <a href={`https://suiscan.xyz/mainnet/tx/${digest}`} target="_blank" rel="noreferrer" className="w-mono w-dialog__digest">
      {digest.slice(0, 18)}… <Icon name="external" size={16} />
    </a>
  );
}
