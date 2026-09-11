// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import 'server-only';
import { opaqueDetail } from './opaque';

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
  version: bigint;
  creator: string;
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
    solvent: v.liquidMist + staked >= v.totalPrincipalMist,
    positionsTableId: v.positionsTableId,
  };
}

export async function readVault(vaultId: string): Promise<Reading<StakeVaultView>> {
  const config = siteConfig();
  if (!config.ok) return config;

  const vault = await readStakeVault(createClient(config.value), vaultId);
  if (!vault.ok) return vault;

  const profiles = await listProfiles();
  const owner = profiles.find(
    (p) => normaliseAddress(p.owner) === normaliseAddress(vault.value.creator),
  );

  return ok(toView(vault.value, owner?.handle ?? null));
}

export async function readMembers(vault: StakeVaultView): Promise<Reading<MembersView>> {
  const config = siteConfig();
  if (!config.ok) return config;

  const walked = await listStakePositions(createClient(config.value), vault.positionsTableId);
  if (!walked.ok) return walked;

  return ok(summariseMembers(walked.value.members, vault, walked.value.truncated));
}

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

      if (bytes === null || bytes.length < 64) {
        return fail('malformed', source, `a StakeCap decoded to ${bytes?.length ?? 0} bytes`);
      }

      caps.push({
        capId: object.objectId,
        vaultId: `0x${Buffer.from(bytes.subarray(32, 64)).toString('hex')}`,
      });
    }

    return ok(caps);
  } catch (error) {
    return fail('transport', source, opaqueDetail(source, error));
  }
}

export function isValidatorAddress(text: string): boolean {
  return /^0x[0-9a-fA-F]{1,64}$/.test(text.trim());
}

export function suggestedValidator(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): { address: string; name: string } | null {
  const address = (env['PROJECTX_SOCIAL_SUGGESTED_VALIDATOR'] ?? '').trim();
  if (address === '') return null;
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(address)) return null;
  const name = (env['PROJECTX_SOCIAL_SUGGESTED_VALIDATOR_NAME'] ?? '').trim();
  return { address, name: name === '' ? address : name };
}
