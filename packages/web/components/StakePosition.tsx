'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { useCallback, useEffect, useState } from 'react';
import { SignIn } from '@/components/SignIn';
import { DigestLine, MoneyDialog } from '@/components/app/MoneyDialog';
import { useCheckout } from '@/components/app/use-checkout';
import { formatUnits, SUI_DECIMALS } from '@/lib/units';

const sui = (mist: string) => formatUnits(BigInt(mist), SUI_DECIMALS);

interface VaultView {
  vaultId: string; creator: string; handle: string | null; validator: string;
  accepting: boolean; totalPrincipalMist: string; liquidMist: string; stakedMist: string;
  tranches: number; lifetimeYieldMist: string; harvests: string; creatorYieldMist: string;
  rebatePoolMist: string; rebateBps: string; solvent: boolean;
}
interface Position { principalMist: string; pendingRebateMist: string }
interface Quote { bytes: string; gasMist: string }

type Load =
  | { state: 'idle' | 'loading' }
  | { state: 'ready'; vault: VaultView; position: Position | null }
  | { state: 'unmeasured'; detail: string };

function toMist(input: string): bigint | null {
  const text = input.trim();
  if (!/^\d+(\.\d{1,9})?$/.test(text)) return null;
  const [whole = '0', frac = ''] = text.split('.');
  return BigInt(whole + frac.padEnd(9, '0'));
}

/*
  What a member holds in a vault, and the two decisions they can take: withdraw the principal,
  claim their share of the yield. Each is a dialog that shows the chain's answer before the one
  signature. The figures are read from the chain and never invented: an unread vault says so.
*/
export function StakePosition({ vaultId }: { vaultId: string }) {
  const withdraw = useCheckout<Quote>();
  const rebate = useCheckout<Quote>();
  const signer = withdraw.signer;
  const [accountId, setAccountId] = useState<string | null>(null);
  const [load, setLoad] = useState<Load>({ state: 'idle' });
  const [amount, setAmount] = useState('');
  const [shape, setShape] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'withdraw' | 'rebate' | null>(null);
  const [withdrawing, setWithdrawing] = useState<bigint | null>(null);

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
    void fetch(`/api/creator?owner=${encodeURIComponent(signer.address)}`)
      .then((r) => r.json())
      .then((b: { accountId?: string }) => setAccountId(b.accountId ?? null))
      .catch(() => setAccountId(null));
  }, [signer, refresh]);

  if (signer === null) {
    return (
      <div className="w-money">
        <p className="w-dialog__after">Sign in to see what you have deposited here and to take it back.</p>
        <SignIn />
      </div>
    );
  }

  if (load.state === 'unmeasured') {
    return (
      <div className="note crit">
        <span className="lbl">Reading from the chain</span>
        <p>
          The vault is loading ({load.detail}). Your deposit is held on chain and is unaffected
          by this page — the balance and the withdraw control appear once it answers.
        </p>
      </div>
    );
  }

  if (load.state !== 'ready') {
    return <p className="w-dialog__after">Reading the vault…</p>;
  }

  const { vault, position } = load;
  const principal = BigInt(position?.principalMist ?? '0');
  const pending = BigInt(position?.pendingRebateMist ?? '0');

  const startWithdraw = () => {
    if (accountId === null) return;
    const typed = amount.trim();
    const mist = typed === '' ? principal : toMist(typed);
    if (mist === null || mist === 0n) {
      setShape('Enter an amount in SUI, for example 0.5');
      return;
    }
    setShape(null);
    setWithdrawing(mist);
    setDialog('withdraw');
    void withdraw.simulate('/api/stake/withdraw', { vaultId, accountId, amountMist: mist.toString() });
  };

  const startRebate = () => {
    if (accountId === null) return;
    setDialog('rebate');
    void rebate.simulate('/api/stake/rebate', { vaultId, accountId });
  };

  const closeDialog = () => {
    setDialog(null);
    withdraw.reset();
    rebate.reset();
  };

  const landed = async () => {
    setAmount('');
    closeDialog();
    await refresh(signer.address);
  };

  return (
    <div className="w-money">
      {!vault.solvent && (
        <div className="note crit">
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
        <dl className="w-facts w-facts--grid">
          <div>
            <dt>Principal (yours)</dt>
            <dd>{sui(position?.principalMist ?? '0')} SUI</dd>
          </div>
          <div>
            <dt>Your share accrued</dt>
            <dd>{sui(position?.pendingRebateMist ?? '0')} SUI</dd>
          </div>
        </dl>

        {position === null ? (
          <p className="w-card__note">
            You have not deposited here. This is a measured answer — the vault&rsquo;s table was
            read and holds no entry for your address.
          </p>
        ) : (
          <p className="w-card__note">
            Your share is a lower bound: the contract accrues on interaction, so anything earned
            since you last touched this vault is not in that figure yet.
          </p>
        )}
      </div>

      {principal > 0n && (
        <div className="card">
          <span className="k">TAKE IT BACK</span>
          <p className="w-dialog__after">
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
          ) : (
            <div className="w-field">
              <div className="w-field__row w-money__row">
                <input
                  className="w-input"
                  inputMode="decimal"
                  aria-label="Amount of SUI to withdraw"
                  placeholder={`All of it: ${sui(position?.principalMist ?? '0')} SUI`}
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value);
                    setShape(null);
                  }}
                />
                <button type="button" className="w-btn w-btn--primary" onClick={startWithdraw}>
                  Withdraw
                </button>
              </div>
              {shape === null ? null : <p className="w-field__note w-field__note--bad">{shape}</p>}
            </div>
          )}
        </div>
      )}

      {pending > 0n && accountId !== null && (
        <div className="card">
          <span className="k">YOUR GIVE-BACK</span>
          <p className="w-dialog__after">
            This creator hands back {Number(vault.rebateBps) / 100}% of what their vault earns to
            the people who are members. You have{' '}
            <strong>{sui(position?.pendingRebateMist ?? '0')} SUI</strong> accrued.
          </p>
          <button type="button" className="w-btn w-btn--primary" onClick={startRebate}>
            Claim my share
          </button>
        </div>
      )}

      {dialog === 'withdraw' && withdrawing !== null ? (
        <MoneyDialog
          title="Withdraw your principal"
          stage={withdraw.stage}
          error={withdraw.error}
          blocked={withdraw.blocked}
          signed={withdraw.signed}
          facts={[
            { label: 'Returns to this address', value: `${formatUnits(withdrawing, SUI_DECIMALS)} SUI`, strong: true },
            { label: 'Gas', value: withdraw.quote === null ? 'being read from the chain' : `${sui(withdraw.quote.gasMist)} SUI` },
          ]}
          factsNote="No waiting period and no approval. If the vault's liquid balance is short, the contract unwinds delegated stake in this same transaction."
          stageNote={{ simulating: 'Checking the withdrawal against the vault.' }}
          primaryLabel={withdraw.stage === 'submitting' ? 'Waiting for your signature…' : 'Sign and withdraw'}
          primaryDisabled={withdraw.quote === null}
          onPrimary={() => void withdraw.signAndSubmit()}
          onCancel={closeDialog}
          onClose={closeDialog}
          done={
            withdraw.digest === null ? null : (
              <>
                <div className="w-dialog__done">
                  <p>Withdrawn. The principal is back at this address.</p>
                  <DigestLine digest={withdraw.digest} />
                </div>
                <div className="w-dialog__actions">
                  <button type="button" className="w-btn w-btn--primary" onClick={() => void landed()}>
                    Done
                  </button>
                </div>
              </>
            )
          }
        />
      ) : null}

      {dialog === 'rebate' ? (
        <MoneyDialog
          title="Claim your share"
          stage={rebate.stage}
          error={rebate.error}
          blocked={rebate.blocked}
          signed={rebate.signed}
          facts={[
            { label: 'Your share accrued', value: `${sui(position?.pendingRebateMist ?? '0')} SUI`, strong: true },
            { label: 'Gas', value: rebate.quote === null ? 'being read from the chain' : `${sui(rebate.quote.gasMist)} SUI` },
          ]}
          factsNote="A lower bound: the contract accrues on interaction, so the amount that lands can be higher than shown."
          stageNote={{ simulating: 'Checking the claim against the vault.' }}
          primaryLabel={rebate.stage === 'submitting' ? 'Waiting for your signature…' : 'Sign and claim'}
          primaryDisabled={rebate.quote === null}
          onPrimary={() => void rebate.signAndSubmit()}
          onCancel={closeDialog}
          onClose={closeDialog}
          done={
            rebate.digest === null ? null : (
              <>
                <div className="w-dialog__done">
                  <p>Claimed.</p>
                  <DigestLine digest={rebate.digest} />
                </div>
                <div className="w-dialog__actions">
                  <button type="button" className="w-btn w-btn--primary" onClick={() => void landed()}>
                    Done
                  </button>
                </div>
              </>
            )
          }
        />
      ) : null}
    </div>
  );
}
