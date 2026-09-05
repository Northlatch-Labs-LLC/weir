// Built-by: @projectx.sui · Co-authored-by: Claude
import type { Metadata } from 'next';
import { fold } from '@projectx-social/sdk';
import { titleFor } from '@/lib/site-map';
import { PageHead } from '@/components/design/PageHead';
import { MIN_STAKE_MIST, RUNGS, ladderHealth } from '@/lib/ladder';
import { VaultActions } from '@/components/VaultActions';
import { explorerUrl, readVaults, shortId } from '@/lib/chain';
import { reverseName } from '@/lib/names';
import { readVault } from '@/lib/stake';
import { EntityType } from '@/components/EntityType';

import { formatSui as sui } from '@/lib/units';

export const dynamic = 'force-dynamic';

/** "Vault 0x1234…abcd", as the trail names it. An id the map does not recognise keeps the site's default. */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params;
  return {
    title: titleFor(`/vault/${id}`),
    description: 'One support vault on Sui: what is pooled, what is delegated, what it has earned, and the solvency check, read live.',
  };
}

/**
 * One support vault.
 *
 * The vault's own figures are read on the server and rendered into the page; the visitor's position
 * is read in the browser, because it depends on which wallet they connect. Splitting it that way
 * means the public numbers are visible without connecting anything at all — somebody deciding
 * whether to support a creator should not have to hand over an address first.
 */
export default async function VaultPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [known, vault] = await Promise.all([readVaults(), readVault(id)]);
  /*
    The creator's default .sui name when this site has no profile for them — a fact about the
    address rather than about this deployment — and the vault's own short id when the chain has no
    name either. "Unnamed vault" over "??" told the reader nothing the object did not already say.
  */
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
      {/*
        A vault is a public object, so this route is guest-reachable and renders in the guest frame.
      */}
      <PageHead
        kicker="Support vault"
        title="Support without"
        accent="spending."
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
                    {/*
                      What this object is, beside who it belongs to.

                      The page showed a handle, an id and whether it was accepting deposits, and
                      never said which kind of thing they described — so a vault read as another
                      creator page that happened to have a status pill. The marker names it.
                    */}
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
                  {/*
                    Solvency is the invariant the contract asserts on every path that moves money.
                    Shown as a measured fact rather than a promise, because the whole no-loss claim
                    reduces to this one comparison.
                  */}
                  {v.solvent
                    ? `Backing covers principal: ${sui(v.liquidMist)} SUI liquid plus ${sui(v.stakedMist)} SUI delegated across ${v.tranches} tranche${v.tranches === 1 ? '' : 's'}.`
                    : 'Backing does NOT cover principal. Do not deposit here.'}{' '}
                  {v.harvests === 0n
                    ? 'Nothing harvested yet.'
                    : `${v.harvests} harvest${v.harvests === 1n ? '' : 's'} so far.`}
                </p>

                {/*
                  Whether this balance can actually earn.

                  Both states below are silent everywhere else: Sui refuses to stake under one SUI,
                  so a smaller vault sits liquid for ever while nothing errors and the daemon
                  correctly declines to act. This page showed a solvent vault with a healthy backing
                  line and never mentioned that none of it was working.
                */}
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

              {/*
                One prompt for the page. Position and deposit are the same activity with the same
                requirement, and asking to connect once per component asked twice for one thing.
              */}
              <div style={{ marginTop: 'var(--space-24)' }}>
                {fold(
                  known,
                  ({ vaults: list }) => (
                    <VaultActions vaultId={id} known={list.some((k) => k.vaultId === id)} />
                  ),
                  (failure) => (
                    <div data-reveal className="note crit">
                      <span className="lbl">Could not read this: {failure.kind}</span>
                      <p>
                        The vault list could not be read, so this page cannot confirm the object was
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
              <span className="lbl">Could not read this: {failure.kind}</span>
              <p>This vault could not be read. {failure.detail}</p>
            </div>
          ),
        )}

        <div data-reveal className="note" style={{ marginTop: 'var(--space-28)' }}>
          <span className="lbl">What you are agreeing to</span>
          <p>
            Your SUI is delegated to a validator and the rewards go to the creator. You are lending
            your money&rsquo;s <em>earning power</em>, not the money. There is no lock-up, no notice
            period and no approval step. <span className="mono">withdraw</span> unwinds delegated
            stake in the same transaction if it has to.
          </p>
          <p>
            This is a way to support someone at no cost to you, not a substitute for paying them.
          </p>
        </div>
          </>
  );
}
