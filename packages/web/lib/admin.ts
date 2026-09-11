// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import 'server-only';
import { rememberQuote } from './checkout';

import {
  createClient,
  fail,
  ok,
  readCreatorVault,
  simulationEnvelope,
  simulationStatus,
  type Reading,
} from '@projectx-social/sdk';
import { Transaction } from '@mysten/sui/transactions';
import { bcs } from '@mysten/sui/bcs';
import { siteConfig, readProtocol, type ProtocolSnapshot } from '@/lib/chain';

const PlatformCapBcs = bcs.struct('PlatformCap', {
  id: bcs.fixedArray(32, bcs.u8()),
  platform: bcs.fixedArray(32, bcs.u8()),
});

function toHex(bytes: number[] | Uint8Array): string {
  return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

export interface AdminStatus {
  isAdmin: boolean;
  capId: string | null;
  platform: ProtocolSnapshot['platform'] | null;
}

export async function readAdminStatus(address: string): Promise<Reading<AdminStatus>> {
  const config = siteConfig();
  if (!config.ok) return config;

  const source = `PlatformCap owned by ${address}`;
  const snapshot = await readProtocol();
  if (!snapshot.ok) return snapshot;

  try {
    const client = createClient(config.value);
    const response = await client.listOwnedObjects({
      owner: address,
      type: `${config.value.packageId}::platform::PlatformCap`,
      limit: 10,
      include: { content: true },
    });

    const objects =
      (response as { objects?: Array<{ objectId?: unknown; content?: unknown }> }).objects ?? [];

    for (const object of objects) {
      if (typeof object.objectId !== 'string') continue;

      const raw = (object.content as { value?: unknown } | undefined)?.value ?? object.content;
      const bytes =
        raw instanceof Uint8Array
          ? raw
          : typeof raw === 'string'
            ? Uint8Array.from(Buffer.from(raw, 'base64'))
            : null;
      if (bytes === null) continue;

      const decoded = PlatformCapBcs.parse(bytes);

      if (toHex(decoded.platform).toLowerCase() !== config.value.platformId.toLowerCase()) continue;

      return ok(
        { isAdmin: true, capId: object.objectId, platform: snapshot.value.platform },
        snapshot.observedAtMs,
      );
    }

    return ok(
      { isAdmin: false, capId: null, platform: snapshot.value.platform },
      snapshot.observedAtMs,
    );
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return fail('transport', source, `could not read platform capabilities: ${detail}`);
  }
}

export const MAX_PLATFORM_FEE_BPS = 3_000n;
export const MAX_REFERRAL_SHARE_BPS = 5_000n;

export type AdminAction =
  | { kind: 'set-fees'; feeBps: string; referralShareBps: string; creationFeeMist: string }
  | { kind: 'set-creation-paused'; paused: boolean }
  | { kind: 'set-payments-paused'; paused: boolean }
  | { kind: 'sweep-treasury'; amountMist: string }
  /*
    Collect the platform's commission from one vault.

    One vault at a time because the contract stores it that way: commission accrues in the vault
    that charged it, in that vault's coin, never pooled — so a creator's earnings and the platform's
    cut can never be paid out of the same balance. There is no batching call to reach for.

    `coinType` is the vault's type parameter and must be supplied: the call is generic and `T`
    cannot be inferred from an object id.
  */
  | { kind: 'claim-platform-fees'; vaultId: string; coinType: string; amount: string };

export interface AdminQuote {
  bytes: string;
  gasMist: string;
  summary: string;
}

export function checkAction(action: AdminAction, treasuryMist: bigint): string | null {
  if (action.kind === 'set-fees') {
    let fee: bigint;
    let share: bigint;
    let creation: bigint;
    try {
      fee = BigInt(action.feeBps);
      share = BigInt(action.referralShareBps);
      creation = BigInt(action.creationFeeMist);
    } catch {
      return 'fees must be whole numbers';
    }
    if (fee < 0n || share < 0n || creation < 0n) return 'fees cannot be negative';
    if (fee > MAX_PLATFORM_FEE_BPS) {
      return `the platform fee ceiling is ${MAX_PLATFORM_FEE_BPS} bps (${Number(MAX_PLATFORM_FEE_BPS) / 100}%)`;
    }
    if (share > MAX_REFERRAL_SHARE_BPS) {
      return `the referral share ceiling is ${MAX_REFERRAL_SHARE_BPS} bps of the platform fee`;
    }
    return null;
  }

  if (action.kind === 'sweep-treasury') {
    let amount: bigint;
    try {
      amount = BigInt(action.amountMist);
    } catch {
      return 'the amount must be a whole number of mist';
    }
    if (amount <= 0n) return 'the amount must be greater than zero';
    if (amount > treasuryMist) {
      return `the treasury holds ${treasuryMist} mist, which is less than ${amount}`;
    }
    return null;
  }

  if (action.kind === 'claim-platform-fees') {
    let amount: bigint;
    try {
      amount = BigInt(action.amount);
    } catch {
      return 'the amount must be a whole number in the coin’s smallest unit';
    }
    if (amount <= 0n) return 'the amount must be greater than zero';
    if (!/^0x[0-9a-fA-F]{1,64}$/.test(action.vaultId)) return 'the vault id must be an object id';
    if (!/^0x[0-9a-fA-F]{1,64}::[A-Za-z_][\w]*::[A-Za-z_][\w]*$/.test(action.coinType)) {
      return `"${action.coinType}" is not a coin type`;
    }
    return null;
  }

  return null;
}

function describe(action: AdminAction): string {
  switch (action.kind) {
    case 'set-fees':
      return (
        `Set the platform fee to ${action.feeBps} bps, the referral share to ` +
        `${action.referralShareBps} bps of that fee, and the vault creation fee to ` +
        `${action.creationFeeMist} mist. Vaults that already exist keep the fee stamped into them.`
      );
    case 'set-creation-paused':
      return action.paused
        ? 'Pause vault creation. Existing vaults and payments are unaffected.'
        : 'Allow vault creation again.';
    case 'set-payments-paused':
      return action.paused
        ? 'Pause payments. Subscriptions, tips and unlocks all stop settling.'
        : 'Allow payments again.';
    case 'sweep-treasury':
      return `Move ${action.amountMist} mist out of the platform treasury to the signing address.`;
    case 'claim-platform-fees':
      return (
        `Collect ${action.amount} of ${action.coinType.split('::').pop() ?? action.coinType} ` +
        `commission from vault ${action.vaultId} to the signing address. ` +
        `The creator's earnings in that vault are a separate balance and are not touched.`
      );
  }
}

export async function prepareAdminAction(input: {
  sender: string;
  action: AdminAction;
}): Promise<Reading<AdminQuote>> {
  const source = 'platform administration simulation';

  const config = siteConfig();
  if (!config.ok) return config;

  const status = await readAdminStatus(input.sender);
  if (!status.ok) return status;
  if (status.value.capId === null) {
    return fail(
      'malformed',
      source,
      'this address holds no PlatformCap for this platform, so it cannot sign this',
    );
  }
  if (status.value.platform === null) {
    return fail('transport', source, 'the platform could not be read, so nothing was prepared');
  }

  const problem = checkAction(input.action, status.value.platform.treasuryMist);
  if (problem !== null) return fail('malformed', source, problem);

  try {
    const client = createClient(config.value);
    const tx = new Transaction();
    tx.setSender(input.sender);

    const platform = tx.object(config.value.platformId);
    const cap = tx.object(status.value.capId);
    const target = (fn: string) => `${config.value.latestPackageId}::platform::${fn}` as const;

    switch (input.action.kind) {
      case 'set-fees':
        tx.moveCall({
          target: target('set_fees'),
          arguments: [
            platform,
            cap,
            tx.pure.u64(BigInt(input.action.feeBps)),
            tx.pure.u64(BigInt(input.action.referralShareBps)),
            tx.pure.u64(BigInt(input.action.creationFeeMist)),
          ],
        });
        break;

      case 'set-creation-paused':
        tx.moveCall({
          target: target('set_creation_paused'),
          arguments: [platform, cap, tx.pure.bool(input.action.paused)],
        });
        break;

      case 'set-payments-paused':
        tx.moveCall({
          target: target('set_payments_paused'),
          arguments: [platform, cap, tx.pure.bool(input.action.paused)],
        });
        break;

      case 'sweep-treasury': {
        const coin = tx.moveCall({
          target: target('sweep_treasury'),
          arguments: [platform, cap, tx.pure.u64(BigInt(input.action.amountMist))],
        });
        tx.transferObjects([coin], input.sender);
        break;
      }

      case 'claim-platform-fees': {
        const state = await readCreatorVault(client, input.action.vaultId);
        if (!state.ok) return state;
        const wanted = BigInt(input.action.amount);
        if (state.value.platformFees < wanted) {
          return fail(
            'malformed',
            source,
            `that vault holds ${state.value.platformFees} of accrued commission, which is less than ${wanted}`,
          );
        }

        const coin = tx.moveCall({
          target: `${config.value.latestPackageId}::creator::claim_platform_fees`,
          typeArguments: [input.action.coinType],
          arguments: [tx.object(input.action.vaultId), cap, tx.pure.u64(wanted)],
        });
        tx.transferObjects([coin], input.sender);
        break;
      }
    }

    const bytes = await tx.build({ client });
    const sim = await client.simulateTransaction({
      transaction: bytes,
      include: { effects: true },
    });

    const { grpc } = simulationEnvelope(sim);
    const result = grpc as SimulatedAdminTx | undefined;
    const status2 = simulationStatus(sim);
    if (status2?.success !== true) {
      return fail('malformed', source, describeAdminAbort(status2?.error ?? 'no status returned'));
    }

    const gasUsed = result?.effects?.gasUsed;
    if (gasUsed === undefined) {
      return fail('malformed', source, 'the simulation returned no gas figure');
    }
    const at = (key: string) => BigInt(gasUsed[key] ?? 0);

    return ok(
      {
        bytes: await rememberQuote(Buffer.from(bytes).toString('base64')),
        gasMist: (at('computationCost') + at('storageCost') - at('storageRebate')).toString(),
        summary: describe(input.action),
      },
      Date.now(),
    );
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return fail('transport', source, `the transaction could not be prepared: ${detail}`);
  }
}

function describeAdminAbort(raw: string): string {
  if (/ENotAuthorised|assert_cap|EWrongCap/i.test(raw)) {
    return 'that capability does not govern this platform, so the call was refused';
  }
  if (/EFeeAboveCeiling/i.test(raw)) return 'the fee is above the ceiling the contract enforces';
  if (/EInsufficientTreasury/i.test(raw)) return 'the treasury holds less than the amount requested';
  if (/EWrongVersion/i.test(raw)) {
    return 'the platform is on an older schema version — it needs migrate() before anything else';
  }
  return raw;
}

interface SimulatedAdminTx {
  status?: { success?: boolean; error?: string };
  effects?: {
    status?: { success?: boolean; error?: string };
    gasUsed?: Record<string, string | number>;
  };
}
