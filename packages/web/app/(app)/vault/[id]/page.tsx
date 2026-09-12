// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import type { Metadata } from 'next';
import { fold } from '@projectx-social/sdk';
import { titleFor } from '@/lib/site-map';
import { PageHead } from '@/components/app/PageHead';
import { MIN_STAKE_MIST, RUNGS, ladderHealth } from '@/lib/ladder';
import { VaultActions } from '@/components/VaultActions';
import { VaultDisclosure } from '@/components/VaultDisclosure';
import { explorerUrl, readVaults, shortId } from '@/lib/chain';
import { reverseName } from '@/lib/names';
import { readVault } from '@/lib/stake';
import { EntityType } from '@/components/EntityType';

import { formatSui as sui } from '@/lib/units';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return {
    title: titleFor(`/vault/${id}`),
    description: 'One support vault on Sui: what is pooled, what is delegated, what it has earned, and the solvency check, read live.',
  };
}

export default async function VaultPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [known, vault] = await Promise.all([readVaults(), readVault(id)]);
  const creatorName =
    vault.ok && vault.value.handle === null
      ? fold(
          await reverseName(vault.value.creator),
          (name) => name,
          () => null,
        )
      : null;

  return (
    <>
      <PageHead
        kicker="Support vault"
        title="Vault"
        lede="Your deposit stays yours and is withdrawable in full at any time. Only the staking yield it earns goes to the creator, never the principal."
      />

        {fold(
          vault,
          (v) => (
            <>
              <div data-reveal className="card" style={{ marginTop: 'var(--space-24)' }}>
                <div className="byline">
                  <span className="avatar" aria-hidden>{(v.handle ?? creatorName ?? v.vaultId.slice(2)).slice(0, 2)}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span className="byline-name">
                      {v.handle !== null ? `@${v.handle}` : (creatorName ?? `Vault ${shortId(v.vaultId)}`)}
                    </span>
                    <div
                      className="byline-meta"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--space-8)',
                        flexWrap: 'wrap',
                      }}
                    >
                      <EntityType entity="stake-vault" />
                      <a className="mono" href={explorerUrl(id)} rel="noreferrer" target="_blank">
                        {shortId(id)}
                      </a>
                    </div>
                  </div>
                  <span className={v.accepting ? 'pill subs' : 'pill'}>
                    {v.accepting ? 'Accepting' : 'Closed to new deposits'}
                  </span>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gap: 'var(--space-20)',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
                  }}
                >
                  <div className="stat">
                    <span className="k">Supporting</span>
                    <span className="v">{sui(v.totalPrincipalMist)} SUI</span>
                  </div>
                  <div className="stat">
                    <span className="k">Delegated</span>
                    <span className="v">{sui(v.stakedMist)} SUI</span>
                  </div>
                  <div className="stat">
                    <span className="k">Yield realised</span>
                    <span className="v">{sui(v.lifetimeYieldMist)} SUI</span>
                  </div>
                  <div className="stat">
                    <span className="k">Supporters&rsquo; share</span>
                    <span className="v">{Number(v.rebateBps) / 100}%</span>
                  </div>
                </div>

                <p className="locked-why">
                  {v.solvent
                    ? `Backing covers principal: ${sui(v.liquidMist)} SUI liquid plus ${sui(v.stakedMist)} SUI delegated across ${v.tranches} tranche${v.tranches === 1 ? '' : 's'}.`
                    : 'Backing does NOT cover principal. Do not deposit here.'}{' '}
                  {v.harvests === 0n
                    ? 'Nothing harvested yet.'
                    : `${v.harvests} harvest${v.harvests === 1n ? '' : 's'} so far.`}
                </p>

                {(() => {
                  const health = ladderHealth(v.totalPrincipalMist);
                  if (health.kind === 'full') return null;

                  return health.kind === 'idle' ? (
                    <div data-reveal className="note warn" style={{ marginTop: 'var(--space-16)' }}>
                      <span className="lbl">This vault cannot earn yet</span>
                      <p>
                        Sui will not delegate less than {sui(MIN_STAKE_MIST)} SUI, and this vault
                        holds {sui(v.totalPrincipalMist)}. The balance sits liquid and earns nothing
                        until it reaches the minimum. Another{' '}
                        <strong>{sui(health.shortfallMist)} SUI</strong> deposited here starts it
                        working. Principal is untouched either way and stays withdrawable in full.
                      </p>
                    </div>
                  ) : (
                    <div data-reveal className="note" style={{ marginTop: 'var(--space-16)' }}>
                      <span className="lbl">Earning, on a partial ladder</span>
                      <p>
                        The vault stakes in {RUNGS.toString()} rungs so one matures every epoch and
                        yield arrives continuously. At {sui(v.totalPrincipalMist)} SUI it can fund{' '}
                        {health.rungs.toString()} of them, so yield arrives in bursts instead. A
                        further <strong>{sui(health.shortfallMist)} SUI</strong> would fill the
                        ladder. Nothing is wrong or at risk; it earns less evenly.
                      </p>
                    </div>
                  );
                })()}
              </div>

              <div style={{ marginTop: 'var(--space-24)' }}>
                {fold(
                  known,
                  ({ vaults: list }) => (
                    <VaultActions vaultId={id} known={list.some((k) => k.vaultId === id)} />
                  ),
                  (failure) => (
                    <div data-reveal className="note crit">
                      <span className="lbl">This did not load</span>
                      <p>
                        The vault list is being read from the chain, so this page has not yet confirmed the object was
                        created here. No deposit form is offered on an unverified vault.
                      </p>
                    </div>
                  ),
                )}
              </div>

            </>
          ),
          (failure) => (
            <div data-reveal className="note crit" style={{ marginTop: 'var(--space-24)' }}>
              <span className="lbl">This did not load</span>
              <p>This vault is being read from the chain. {failure.detail}</p>
            </div>
          ),
        )}

        <VaultDisclosure />
          </>
  );
}
