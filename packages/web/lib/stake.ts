// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import 'server-only';
import { opaqueDetail } from './opaque';

/**
 * The stake leg.
 *
 * # What this is for
 *
 * A supporter deposits SUI. The vault delegates it to a validator. The creator receives the
 * *staking yield*; the depositor's principal is untouched and withdrawable in full at any time.
 * The contract and the harvest daemon were both live before this module existed, with no path to
 * either from the application — a creator could not open a vault without a command line.
 *
 * # The magnitudes, stated here so nobody has to discover them later
 *
 * At Sui's current staking rate, a given monthly amount of yield needs roughly eight hundred times
 * that amount delegated. Anything rendered from these reads should be written against that scale
 * rather than against a figure that looks like a subscription.
 *
 * # Solvency is a property of the contract, not a claim of this module
 *
 * `backing = liquid + staked_principal >= total_principal` is asserted on every path that moves
 * money, and an emergency unwind takes tranches newest-first so a withdrawal is met in the same
 * transaction. Forgone yield on an unwound tranche is the creator's loss, never the depositor's.
 * This module reads those numbers and shows them; it cannot enforce anything, and it does not
 * pretend to.
 */

import {
  createClient,
  fail,
  ok,
  listStakePositions,
  readStakePosition,
  readStakeVault,
  type Reading,
  type StakePosition,
  type StakeVaultState,
} from '@projectx-social/sdk';
import { siteConfig } from './chain';
import { summariseMembers, type MembersView } from './stake-members';
import { listProfiles } from './content';
import { normaliseAddress } from './db';

export interface StakeVaultView {
  vaultId: string;
  /** The struct's `version` field, as the object carries it. */
  version: bigint;
  creator: string;
  /** The creator's handle when this deployment knows the vault. `null` otherwise. */
  handle: string | null;
  validator: string;
  accepting: boolean;
  totalPrincipalMist: bigint;
  liquidMist: bigint;
  stakedMist: bigint;
  tranches: number;
  lifetimeYieldMist: bigint;
  harvests: bigint;
  creatorYieldMist: bigint;
  rebatePoolMist: bigint;
  rebateBps: bigint;
  feeBpsSnapshot: bigint;
  accRebatePerUnit: bigint;
  /** `liquid + staked >= principal`. False here would mean the invariant had been violated. */
  solvent: boolean;
  positionsTableId: string;
}

function toView(v: StakeVaultState, handle: string | null): StakeVaultView {
  const staked = v.tranches.reduce((total, t) => total + t.principalMist, 0n);
  return {
    vaultId: v.vaultId,
    version: v.version,
    creator: v.creator,
    handle,
    validator: v.validator,
    accepting: v.accepting,
    totalPrincipalMist: v.totalPrincipalMist,
    liquidMist: v.liquidMist,
    stakedMist: staked,
    tranches: v.tranches.length,
    lifetimeYieldMist: v.lifetimeYieldMist,
    harvests: v.harvests,
    creatorYieldMist: v.creatorYieldMist,
    rebatePoolMist: v.rebatePoolMist,
    rebateBps: v.rebateBps,
    feeBpsSnapshot: v.feeBpsSnapshot,
    accRebatePerUnit: v.accRebatePerUnit,
    // Computed from the same two numbers the contract asserts on, so a violated invariant would
    // show here rather than being taken on trust.
    solvent: v.liquidMist + staked >= v.totalPrincipalMist,
    positionsTableId: v.positionsTableId,
  };
}

/** One vault, with the creator's handle attached when the store knows it. */
export async function readVault(vaultId: string): Promise<Reading<StakeVaultView>> {
  const config = siteConfig();
  if (!config.ok) return config;

  const vault = await readStakeVault(createClient(config.value), vaultId);
  if (!vault.ok) return vault;

  /*
    Named by its creator, not by a column.

    This matched `profiles.stake_vault_id` alone — and nothing in the application ever writes that
    column. Opening a stake vault goes through `stake_vault::open` and touches the store not at all,
    so the lookup found nothing for every creator, and every one of these pages rendered "Unnamed
    vault" while the chain knew perfectly well whose it was.

    The vault carries its creator's address, so that is what identifies it. The column has now been
    dropped rather than left as a second, emptier answer to a question the chain already settles.
  */
  const profiles = await listProfiles();
  const owner = profiles.find(
    (p) => normaliseAddress(p.owner) === normaliseAddress(vault.value.creator),
  );

  return ok(toView(vault.value, owner?.handle ?? null));
}

/**
 * Everyone pooled behind a vault, read live from its `positions` table.
 *
 * The creator's view of their community. Each row's claimable rebate is computed with the vault's
 * current accumulator — the same arithmetic as `stake_vault::claimable_rebate` — so a harvest that
 * landed a minute ago is already in the figure. The rows are checked against `total_principal`,
 * and a mismatch is reported rather than smoothed over.
 */
export async function readMembers(vault: StakeVaultView): Promise<Reading<MembersView>> {
  const config = siteConfig();
  if (!config.ok) return config;

  const walked = await listStakePositions(createClient(config.value), vault.positionsTableId);
  if (!walked.ok) return walked;

  return ok(summariseMembers(walked.value.members, vault, walked.value.truncated));
}

/**
 * A supporter's position in a vault.
 *
 * `null` inside an `ok` is "you have not deposited here" — an invitation. A failure is "we could
 * not read the vault", which must never render as a zero principal: telling somebody their money
 * is not there because a node timed out is the worst thing this page could do.
 */
export async function readPosition(
  vaultId: string,
  depositor: string,
): Promise<Reading<{ vault: StakeVaultView; position: StakePosition | null }>> {
  const vault = await readVault(vaultId);
  if (!vault.ok) return vault;

  const config = siteConfig();
  if (!config.ok) return config;

  const position = await readStakePosition(
    createClient(config.value),
    vault.value.positionsTableId,
    depositor,
  );
  if (!position.ok) return position;

  return ok({ vault: vault.value, position: position.value });
}

/**
 * The stake vault a creator owns, if any.
 *
 * Found through the `StakeCap` they hold rather than through the store, because the cap is what the
 * contract checks. A profile row saying somebody owns a vault is this application's opinion; the
 * capability is the chain's.
 */
export async function findStakeCaps(
  owner: string,
): Promise<Reading<Array<{ capId: string; vaultId: string }>>> {
  const config = siteConfig();
  if (!config.ok) return config;

  const source = `StakeCap owned by ${owner}`;
  try {
    const client = createClient(config.value);
    const response = await client.listOwnedObjects({
      owner,
      type: `${config.value.packageId}::stake_vault::StakeCap`,
      limit: 10,
      include: { content: true },
    });

    const objects =
      (response as { objects?: Array<{ objectId?: unknown; content?: unknown }> }).objects ?? [];

    /*
      Every cap, not the first one.

      This returned as soon as it decoded one, so a creator holding two support vaults was shown
      one and told that was all they had — while `/c/<handle>` listed both, because that page reads
      the vaults from events rather than from here. Two surfaces disagreeing about how many vaults
      somebody owns is worse than either answer alone.
    */
    const caps: Array<{ capId: string; vaultId: string }> = [];

    for (const object of objects) {
      if (typeof object.objectId !== 'string') continue;

      const raw = (object.content as { value?: unknown } | undefined)?.value ?? object.content;
      const bytes =
        raw instanceof Uint8Array
          ? raw
          : typeof raw === 'string'
            ? Uint8Array.from(Buffer.from(raw, 'base64'))
            : null;

      // `StakeCap { id: UID, vault: ID }` — 32 bytes each. Anything shorter is a different struct
      // that matched the type filter, and decoding it yields a plausible id pointing nowhere.
      if (bytes === null || bytes.length < 64) {
        return fail('malformed', source, `a StakeCap decoded to ${bytes?.length ?? 0} bytes`);
      }

      caps.push({
        capId: object.objectId,
        vaultId: `0x${Buffer.from(bytes.subarray(32, 64)).toString('hex')}`,
      });
    }

    // An empty array inside an ok: they hold no cap, which is the ordinary state of everybody who
    // has not opened a support vault. Distinct from the failure branch above.
    return ok(caps);
  } catch (error) {
    return fail('transport', source, opaqueDetail(source, error));
  }
}

/**
 * A validator address, checked for shape only.
 *
 * **Its commission is not read here, and that is deliberate.** Commission comes off yield before
 * the vault ever sees it, and it is a value the validator can change at any epoch boundary. A
 * figure displayed at vault-creation time would be right for a day and wrong afterwards, with
 * nothing to correct it — worse than showing none, because a stale number gets believed. The UI
 * says what commission does and names where to check it live instead.
 *
 * The validator is stamped into the vault and cannot be changed afterwards, which is why this is
 * worth being careful about at all.
 */
export function isValidatorAddress(text: string): boolean {
  return /^0x[0-9a-fA-F]{1,64}$/.test(text.trim());
}

/**
 * A suggested validator, when the deployment names one.
 *
 * Configuration, not a literal. The address was written into this file *and* into
 * `StakeVaultSetup.tsx`, so two copies of a deployment value could drift — and it is stamped
 * permanently into every vault opened with it, which is the worst kind of value to get wrong twice.
 */
export function suggestedValidator(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): { address: string; name: string } | null {
  const address = (env['PROJECTX_SOCIAL_SUGGESTED_VALIDATOR'] ?? '').trim();
  if (address === '') return null;
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(address)) return null;
  const name = (env['PROJECTX_SOCIAL_SUGGESTED_VALIDATOR_NAME'] ?? '').trim();
  return { address, name: name === '' ? address : name };
}
