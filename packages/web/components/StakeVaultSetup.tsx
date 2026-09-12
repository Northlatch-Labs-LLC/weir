'use client';
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { useCallback, useEffect, useState } from 'react';
import { MIN_STAKE_MIST, RUNGS, ladderHealth, sui as suiOf } from '@/lib/ladder';
import { SignIn } from '@/components/SignIn';
import { DigestLine, MoneyDialog } from '@/components/app/MoneyDialog';
import { useCheckout } from '@/components/app/use-checkout';
import { formatUnits, SUI_DECIMALS } from '@/lib/units';

const sui = (mist: string) => formatUnits(BigInt(mist), SUI_DECIMALS);

interface VaultView {
  vaultId: string; validator: string; accepting: boolean;
  totalPrincipalMist: string; stakedMist: string; lifetimeYieldMist: string;
  creatorYieldMist: string; rebatePoolMist: string; rebateBps: string;
  harvests: string; tranches: number; solvent: boolean;
}
interface Quote { bytes: string; gasMist: string }

type Decision =
  | { kind: 'open'; validator: string }
  | { kind: 'yield'; amountMist: string }
  | { kind: 'rebate'; bps: bigint };

function toMist(input: string): bigint | null {
  const text = input.trim();
  if (!/^\d+(\.\d{1,9})?$/.test(text)) return null;
  const [whole = '0', frac = ''] = text.split('.');
  return BigInt(whole + frac.padEnd(9, '0'));
}

/*
  A creator's support vault and its three decisions: open it, claim the yield, set the members'
  share. Each is a dialog that shows the chain's answer, the gas above all, before the one
  signature. Principal shown here is never the creator's; only the yield column is revenue.
*/
export function StakeVaultSetup({ accountId }: { accountId: string }) {
  const checkout = useCheckout<Quote>();
  const signer = checkout.signer;
  const [caps, setCaps] = useState<Array<{ capId: string; vaultId: string }> | 'unknown'>('unknown');
  const [selected, setSelected] = useState<string | null>(null);
  const [vault, setVault] = useState<VaultView | null>(null);
  const [validator, setValidator] = useState('');
  const [suggested, setSuggested] = useState<{ address: string; name: string } | null>(null);
  const [rebate, setRebate] = useState('');
  const [claim, setClaim] = useState('');
  const [decision, setDecision] = useState<Decision | null>(null);
  const [shape, setShape] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cap: { capId: string; vaultId: string } | null | 'unknown' =
    caps === 'unknown' ? 'unknown' : (caps.find((c) => c.vaultId === selected) ?? null);

  useEffect(() => {
    let cancelled = false;
    void fetch('/api/stake/suggested')
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { validator?: { address: string; name: string } | null } | null) => {
        if (!cancelled && b?.validator != null) {
          setSuggested(b.validator);
          setValidator((current) => (current === '' ? b.validator!.address : current));
        }
      })
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

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

  const decide = (next: Decision, url: string, payload: Record<string, string>) => {
    setShape(null);
    setDecision(next);
    void checkout.simulate(url, payload);
  };

  const closeDialog = () => {
    setDecision(null);
    checkout.reset();
  };

  const landed = async () => {
    closeDialog();
    setRebate('');
    setClaim('');
    if (signer !== null) await refresh(signer.address);
  };

  if (signer === null) {
    return (
      <div className="w-money">
        <p className="w-dialog__after">
          A support vault lets people back you without spending anything: they deposit, you earn the
          staking yield, and their principal stays theirs.
        </p>
        <SignIn />
        {error !== null && <p className="w-field__note w-field__note--bad">{error}</p>}
      </div>
    );
  }

  if (cap === 'unknown') {
    return (
      <div className="w-money">
        {error === null ? (
          <p className="w-dialog__after">Reading the chain…</p>
        ) : (
          <p className="w-field__note w-field__note--bad">{error}</p>
        )}
      </div>
    );
  }

  const dialog =
    decision === null ? null : (
      <MoneyDialog
        title={
          decision.kind === 'open'
            ? 'Open your support vault'
            : decision.kind === 'yield'
              ? 'Claim your yield'
              : "Set the members' share"
        }
        stage={checkout.stage}
        error={checkout.error}
        blocked={checkout.blocked}
        signed={checkout.signed}
        facts={[
          decision.kind === 'open'
            ? { label: 'Validator, permanent', value: `${decision.validator.slice(0, 10)}…${decision.validator.slice(-6)}` }
            : decision.kind === 'yield'
              ? { label: 'Yield to you', value: `${sui(decision.amountMist)} SUI`, strong: true }
              : { label: "Members' share of the yield", value: `${Number(decision.bps) / 100}%`, strong: true },
          { label: 'Gas', value: checkout.quote === null ? 'being read from the chain' : `${sui(checkout.quote.gasMist)} SUI` },
        ]}
        factsNote={
          decision.kind === 'open'
            ? 'The validator cannot be changed later. Their commission comes off the yield before the vault sees it.'
            : decision.kind === 'yield'
              ? 'Realised yield only; a tranche must mature before its yield exists.'
              : 'Out of your share of the yield, never the principal and never the platform’s.'
        }
        stageNote={{ simulating: 'Checking against the chain.' }}
        primaryLabel={
          checkout.stage === 'submitting'
            ? 'Waiting for your signature…'
            : decision.kind === 'open'
              ? 'Sign and open'
              : decision.kind === 'yield'
                ? 'Sign and claim'
                : 'Sign and set'
        }
        primaryDisabled={checkout.quote === null}
        onPrimary={() => void checkout.signAndSubmit()}
        onCancel={closeDialog}
        onClose={closeDialog}
        done={
          checkout.digest === null ? null : (
            <>
              <div className="w-dialog__done">
                <p>{decision.kind === 'open' ? 'Your support vault is open.' : decision.kind === 'yield' ? 'Claimed.' : 'Set.'}</p>
                <DigestLine digest={checkout.digest} />
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
    );

  if (cap === null) {
    return (
      <div className="w-money">
        <h2>Open a support vault</h2>
        <p className="w-dialog__after">
          Members deposit SUI, it is delegated to a validator, and the yield comes to you. They
          keep their principal and can withdraw all of it whenever they like — support that costs
          them nothing but the yield.
        </p>

        <div className="w-field">
          <label htmlFor="validator">VALIDATOR · PERMANENT, CANNOT BE CHANGED LATER</label>
          <input id="validator" className="w-input" value={validator} onChange={(e) => setValidator(e.target.value)} />
          <p className="w-field__note">
            Their commission is taken from the yield before your vault sees it, and they can change it
            at any epoch boundary. No figure is shown here because it would be stale within days. Check
            it live with <span className="w-mono">sui validator display-metadata</span> or on an
            explorer before you commit.{' '}
            {suggested !== null
              ? `${suggested.name} is prefilled because it is what Weir's own vault uses.`
              : 'No validator is suggested here, so this is entirely your choice.'}
          </p>
        </div>

        <div>
          <button
            type="button"
            className="w-btn w-btn--primary"
            disabled={validator.trim() === ''}
            onClick={() => decide({ kind: 'open', validator: validator.trim() }, '/api/stake/vault', { accountId, validator: validator.trim() })}
          >
            Open the vault
          </button>
        </div>
        {error !== null && <p className="w-field__note w-field__note--bad">{error}</p>}
        {dialog}
      </div>
    );
  }

  const yieldMist = BigInt(vault?.creatorYieldMist ?? '0');
  const health = ladderHealth(BigInt(vault?.totalPrincipalMist ?? '0'));

  return (
    <div className="w-money">
      {caps !== 'unknown' && caps.length > 1 && (
        <div className="w-field">
          <label htmlFor="sv">YOU HOLD {caps.length} SUPPORT VAULTS · SHOWING</label>
          <select
            id="sv"
            className="w-select"
            value={selected ?? ''}
            onChange={(e) => {
              setSelected(e.target.value);
              closeDialog();
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

      <div className="card">
        <div className="w-list__row">
          <span className="byline-name">Your support vault</span>
          <a className="w-mono" href={`/vault/${cap.vaultId}`}>{cap.vaultId.slice(0, 16)}…</a>
          <span className={vault?.accepting ? 'pill subs' : 'pill'}>
            {vault?.accepting ? 'Accepting' : 'Closed'}
          </span>
        </div>

        {health.kind === 'full' ? null : health.kind === 'idle' ? (
          <div className="note warn">
            <span className="lbl">Nothing here is earning yet</span>
            <p>
              Sui will not delegate less than {suiOf(MIN_STAKE_MIST)} SUI. Until this vault holds
              that much, deposits sit liquid and produce no yield for you. It is{' '}
              {suiOf(health.shortfallMist)} SUI short. Nobody&rsquo;s principal is at risk; it
              simply is not working.
            </p>
          </div>
        ) : (
          <div className="note">
            <span className="lbl">Earning on a partial ladder</span>
            <p>
              {health.rungs.toString()} of {RUNGS.toString()} rungs funded, so yield arrives in
              bursts rather than every epoch. Another {suiOf(health.shortfallMist)} SUI deposited
              would fill it.
            </p>
          </div>
        )}

        <dl className="w-facts w-facts--grid">
          <div>
            <dt>Supporting you</dt>
            <dd>{sui(vault?.totalPrincipalMist ?? '0')} SUI</dd>
          </div>
          <div>
            <dt>Yield realised</dt>
            <dd>{sui(vault?.lifetimeYieldMist ?? '0')} SUI</dd>
          </div>
          <div>
            <dt>Yours to claim</dt>
            <dd>{sui(vault?.creatorYieldMist ?? '0')} SUI</dd>
          </div>
          <div>
            <dt>Members&rsquo; share</dt>
            <dd>{Number(vault?.rebateBps ?? '0') / 100}%</dd>
          </div>
        </dl>

        <p className="w-card__note">
          Principal shown here is <strong>not yours</strong>: it belongs to the people who deposited
          it and they can take it back at any moment. Only the yield column is your revenue.
        </p>
      </div>

      <div className="card">
        <span className="k">CLAIM YOUR YIELD</span>
        {yieldMist === 0n ? (
          <p className="w-card__note">
            Nothing realised yet. A tranche must mature before its yield exists: this is a measured
            zero, not a failed read.
          </p>
        ) : (
          <div className="w-field">
            <div className="w-field__row w-money__row">
              <input
                className="w-input"
                inputMode="decimal"
                aria-label="Amount of yield to claim"
                placeholder={`All of it: ${sui(vault?.creatorYieldMist ?? '0')}`}
                value={claim}
                onChange={(e) => { setClaim(e.target.value); setShape(null); }}
              />
              <button
                type="button"
                className="w-btn w-btn--primary"
                onClick={() => {
                  const typed = claim.trim();
                  let amountMist = vault?.creatorYieldMist ?? '0';
                  if (typed !== '') {
                    const mist = toMist(typed);
                    if (mist === null) { setShape('Enter an amount in SUI'); return; }
                    amountMist = mist.toString();
                  }
                  decide({ kind: 'yield', amountMist }, '/api/stake/yield', { vaultId: cap.vaultId, capId: cap.capId, amountMist });
                }}
              >
                Claim
              </button>
            </div>
            {shape === null ? null : <p className="w-field__note w-field__note--bad">{shape}</p>}
          </div>
        )}
      </div>

      <div className="card">
        <span className="k">GIVE SUPPORTERS A SHARE</span>
        <p className="w-dialog__after">
          A percentage of the yield handed back to the people funding it, out of{' '}
          <strong>your</strong> share rather than the platform&rsquo;s. It starts at zero, because a
          share nobody chose should not quietly redirect your revenue. Setting it to 100% is
          allowed. Some creators run the vault purely as a give-back to their audience.
        </p>
        <div className="w-field">
          <div className="w-field__row w-money__row">
            <input
              className="w-input"
              inputMode="decimal"
              aria-label="Members' share, percent"
              placeholder={`${Number(vault?.rebateBps ?? '0') / 100}%`}
              value={rebate}
              onChange={(e) => { setRebate(e.target.value); setShape(null); }}
            />
            <button
              type="button"
              className="w-btn w-btn--primary"
              onClick={() => {
                const typed = rebate.trim();
                if (!/^\d+(\.\d{1,2})?$/.test(typed)) { setShape('Enter a percentage, for example 20'); return; }
                const [whole = '0', frac = ''] = typed.split('.');
                const bps = BigInt(whole + frac.padEnd(2, '0'));
                if (bps > 10_000n) { setShape('The share cannot exceed 100%'); return; }
                decide({ kind: 'rebate', bps }, '/api/stake/settings', { vaultId: cap.vaultId, capId: cap.capId, rebateBps: bps.toString() });
              }}
            >
              Set share
            </button>
          </div>
        </div>
      </div>

      {error !== null && <p className="w-field__note w-field__note--bad">{error}</p>}
      {dialog}
    </div>
  );
}
