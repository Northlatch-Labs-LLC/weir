import { useEffect, useRef, useState } from 'react';
import Shell from '@/components/layout/Shell';
import { useViewer } from '@/lib/viewer-context';
import { suiToMist, fmtMist, shortAddress } from '@/lib/format';
import type { Period } from '@/lib/api';
import SignedOutGate from '@/components/base/SignedOutGate';
import { Loading } from '@/components/base/StateView';
import Icon from '@/components/base/Icon';

const uid = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 9)}`;

export default function CreatorSetup() {
  const { viewer, openVault, addTier, removeTier, addPerk, removePerk } = useViewer();

  const [opening, setOpening] = useState(false);
  const openedTimer = useRef<number | null>(null);

  // tier form
  const [tierPrice, setTierPrice] = useState(1);
  const [tierPeriod, setTierPeriod] = useState<Period>('month');
  const [tierError, setTierError] = useState<string | null>(null);

  // perk form
  const [perkTitle, setPerkTitle] = useState('');
  const [perkDetail, setPerkDetail] = useState('');
  const [perkThreshold, setPerkThreshold] = useState(1);
  const [perkError, setPerkError] = useState<string | null>(null);

  useEffect(() => () => {
    if (openedTimer.current) window.clearTimeout(openedTimer.current);
  }, []);

  if (!viewer.signedIn) {
    return (
      <Shell>
        <div className="mx-auto max-w-3xl px-4 pt-12 md:px-6">
          <SignedOutGate
            what="Becoming a creator requires an account, because a vault is opened by your key. Sign in to start earning."
            next="creator"
          />
        </div>
      </Shell>
    );
  }

  const { creator } = viewer;
  const vault = creator.vault;

  const doOpenVault = () => {
    setOpening(true);
    openedTimer.current = window.setTimeout(() => {
      openVault();
      setOpening(false);
    }, 900);
  };

  const submitTier = () => {
    if (!Number.isFinite(tierPrice) || tierPrice <= 0) {
      setTierError('A tier needs a price above zero.');
      return;
    }
    if (creator.tiers.length >= 16) {
      setTierError('You can set at most 16 tiers.');
      return;
    }
    setTierError(null);
    addTier({ id: uid('tier'), price: suiToMist(tierPrice), period: tierPeriod });
    setTierPrice(1);
  };

  const submitPerk = () => {
    const title = perkTitle.trim();
    const detail = perkDetail.trim();
    if (!title) {
      setPerkError('A perk needs a title.');
      return;
    }
    if (!detail) {
      setPerkError('A perk needs a detail.');
      return;
    }
    if (!Number.isFinite(perkThreshold) || perkThreshold <= 0) {
      setPerkError('A perk needs a threshold above zero.');
      return;
    }
    setPerkError(null);
    addPerk({ id: uid('perk'), title, detail, threshold: suiToMist(perkThreshold) });
    setPerkTitle('');
    setPerkDetail('');
    setPerkThreshold(1);
  };

  return (
    <Shell>
      <div className="mx-auto max-w-3xl px-4 pt-10 md:px-6">
        <header>
          <h1 className="font-serif text-h1 font-medium leading-[1.1] text-ink-10">
            What it takes to start earning here.
          </h1>
          <p className="prose-body mt-5 text-ink-9">
            Three things, each able to stand alone: open a vault, set what subscribers pay, and set
            what supporters get. You can stop after any one of them.
          </p>
        </header>

        {/* 1 — Open a vault */}
        <section className="mt-12">
          <h2 className="font-serif text-h2 font-medium text-ink-10">Open a vault</h2>
          <p className="mt-3 text-body text-ink-8">
            A vault is an object on chain that only your key opens, and the platform never holds
            what lands in it.
          </p>

          {vault ? (
            <div className="mt-5 rounded-lg border border-ink-4 bg-ink-1 p-5">
              <div className="flex items-center gap-2 text-body-sm font-medium text-mint">
                <Icon name="vault" size={16} />
                Vault open
              </div>
              <p className="mt-2 break-all font-mono text-caption text-ink-8">
                vault {shortAddress(vault.address)}
              </p>
              <p className="mt-3 text-body-sm text-ink-8">
                The vault is live and empty. It starts filling the next time a reader pays you.
              </p>
            </div>
          ) : (
            <div className="mt-5 rounded-lg border border-ink-4 bg-ink-1 p-5">
              {opening ? (
                <div role="status" aria-label="Opening vault">
                  <Loading lines={2} />
                </div>
              ) : (
                <>
                  <p className="text-body-sm text-ink-8">
                    You have no vault yet. Opening one creates the on-chain object that receives
                    your earnings. There is no cost to open it.
                  </p>
                  <button
                    type="button"
                    onClick={doOpenVault}
                    className="mt-4 inline-flex min-h-[44px] items-center gap-2 rounded-md bg-mint px-5 py-2 text-body-sm font-semibold text-ink-0 hover:bg-mint-dim whitespace-nowrap cursor-pointer"
                  >
                    <Icon name="vault" size={16} />
                    Open vault
                  </button>
                </>
              )}
            </div>
          )}
        </section>

        {/* 2 — Subscription tiers */}
        <section className="mt-12">
          <h2 className="font-serif text-h2 font-medium text-ink-10">Subscription tiers</h2>
          <p className="mt-3 text-body text-ink-8">
            What a reader pays each period to subscribe to you. Up to 16 tiers, each with a price
            and a period.
          </p>

          {creator.tiers.length > 0 ? (
            <ul className="mt-5 divide-y divide-ink-4 rounded-lg border border-ink-4 bg-ink-1">
              {creator.tiers.map(tier => (
                <li key={tier.id} className="flex items-center justify-between gap-4 p-4">
                  <span className="font-mono tabular-nums text-ink-10">
                    {fmtMist(tier.price)} SUI <span className="text-ink-7">/ {tier.period}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => removeTier(tier.id)}
                    aria-label={`Remove ${fmtMist(tier.price)} SUI per ${tier.period} tier`}
                    className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-ink-5 text-ink-8 hover:text-rose cursor-pointer"
                  >
                    <Icon name="close" size={16} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-5 text-body text-ink-8">No tiers yet.</p>
          )}

          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end">
            <div>
              <label htmlFor="tier-price" className="block text-body-sm text-ink-9">Price, in SUI</label>
              <input
                id="tier-price"
                name="tierPrice"
                type="number"
                min={0.01}
                step={0.01}
                value={tierPrice}
                onChange={e => setTierPrice(Number(e.target.value))}
                aria-invalid={tierError ? true : undefined}
                aria-describedby={tierError ? 'tier-error' : undefined}
                className="mt-1 w-36 rounded-md border border-ink-5 bg-ink-2 px-3 py-2 font-mono text-body text-ink-10 tabular-nums"
              />
            </div>
            <div>
              <label htmlFor="tier-period" className="block text-body-sm text-ink-9">Period</label>
              <select
                id="tier-period"
                name="tierPeriod"
                value={tierPeriod}
                onChange={e => setTierPeriod(e.target.value as Period)}
                className="mt-1 w-36 rounded-md border border-ink-5 bg-ink-2 px-3 py-2 text-body text-ink-10 cursor-pointer"
              >
                <option value="month">month</option>
                <option value="year">year</option>
              </select>
            </div>
            <button
              type="button"
              onClick={submitTier}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-md border border-ink-5 bg-ink-2 px-4 py-2 text-body-sm font-medium text-ink-10 hover:border-ink-6 whitespace-nowrap cursor-pointer"
            >
              <Icon name="plus" size={16} />
              Add tier
            </button>
          </div>
          <p className="mt-3 text-caption text-ink-7">{creator.tiers.length} of 16 tiers.</p>
          {tierError && (
            <p id="tier-error" className="mt-2 text-body-sm text-rose" role="alert">
              {tierError}
            </p>
          )}
        </section>

        {/* 3 — Supporter perks */}
        <section className="mt-12">
          <h2 className="font-serif text-h2 font-medium text-ink-10">Supporter perks</h2>
          <p className="mt-3 text-body text-ink-8">
            What a supporter gets in return for paying past a threshold. Each perk has a title, a
            detail, and the amount that earns it.
          </p>

          {creator.perks.length > 0 ? (
            <ul className="mt-5 divide-y divide-ink-4 rounded-lg border border-ink-4 bg-ink-1">
              {creator.perks.map(perk => (
                <li key={perk.id} className="flex items-start justify-between gap-4 p-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-body font-medium text-ink-10">{perk.title}</span>
                      <span className="font-mono text-caption text-mint">{fmtMist(perk.threshold)} SUI</span>
                    </div>
                    <p className="mt-1 text-body-sm text-ink-8">{perk.detail}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => removePerk(perk.id)}
                    aria-label={`Remove perk ${perk.title}`}
                    className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-ink-5 text-ink-8 hover:text-rose cursor-pointer"
                  >
                    <Icon name="close" size={16} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-5 text-body text-ink-8">No perks yet.</p>
          )}

          <div className="mt-5 flex flex-col gap-3">
            <div>
              <label htmlFor="perk-title" className="block text-body-sm text-ink-9">Title</label>
              <input
                id="perk-title"
                name="perkTitle"
                type="text"
                value={perkTitle}
                onChange={e => setPerkTitle(e.target.value)}
                aria-invalid={perkError ? true : undefined}
                aria-describedby={perkError ? 'perk-error' : undefined}
                className="mt-1 w-full rounded-md border border-ink-5 bg-ink-2 px-3 py-2 text-body text-ink-10 placeholder:text-ink-7"
              />
            </div>
            <div>
              <label htmlFor="perk-detail" className="block text-body-sm text-ink-9">Detail</label>
              <input
                id="perk-detail"
                name="perkDetail"
                type="text"
                value={perkDetail}
                onChange={e => setPerkDetail(e.target.value)}
                aria-invalid={perkError ? true : undefined}
                aria-describedby={perkError ? 'perk-error' : undefined}
                className="mt-1 w-full rounded-md border border-ink-5 bg-ink-2 px-3 py-2 text-body text-ink-10 placeholder:text-ink-7"
              />
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div>
                <label htmlFor="perk-threshold" className="block text-body-sm text-ink-9">Threshold, in SUI</label>
                <input
                  id="perk-threshold"
                  name="perkThreshold"
                  type="number"
                  min={0.01}
                  step={0.01}
                  value={perkThreshold}
                  onChange={e => setPerkThreshold(Number(e.target.value))}
                  aria-invalid={perkError ? true : undefined}
                  aria-describedby={perkError ? 'perk-error' : undefined}
                  className="mt-1 w-36 rounded-md border border-ink-5 bg-ink-2 px-3 py-2 font-mono text-body text-ink-10 tabular-nums"
                />
              </div>
              <button
                type="button"
                onClick={submitPerk}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-md border border-ink-5 bg-ink-2 px-4 py-2 text-body-sm font-medium text-ink-10 hover:border-ink-6 whitespace-nowrap cursor-pointer"
              >
                <Icon name="plus" size={16} />
                Add perk
              </button>
            </div>
          </div>
          {perkError && (
            <p id="perk-error" className="mt-2 text-body-sm text-rose" role="alert">
              {perkError}
            </p>
          )}
        </section>
      </div>
    </Shell>
  );
}