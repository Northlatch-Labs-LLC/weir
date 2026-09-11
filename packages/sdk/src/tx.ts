// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { Transaction, type TransactionObjectArgument } from '@mysten/sui/transactions';
import type { ProjectXSocialConfig } from './config.js';

const CLOCK_ID = '0x6';

const SUI_SYSTEM_STATE_ID = '0x5';

export interface BuilderContext {
  config: ProjectXSocialConfig;
  tx?: Transaction;
}

function begin(ctx: BuilderContext): Transaction {
  return ctx.tx ?? new Transaction();
}

export function openAccount(
  ctx: BuilderContext,
  args: { handle: string; referrer?: string | null },
): Transaction {
  const tx = begin(ctx);
  tx.moveCall({
    target: `${ctx.config.latestPackageId}::account::open`,
    arguments: [
      tx.object(ctx.config.platformId),
      tx.object(ctx.config.registryId),
      tx.pure.string(args.handle),
      tx.pure.option('address', args.referrer ?? null),
      tx.object(CLOCK_ID),
    ],
  });
  return tx;
}

export function openCreatorVault(
  ctx: BuilderContext,
  args: { coinType: string; accountId: string; paymentCoin: TransactionObjectArgument; sender: string },
): Transaction {
  const tx = begin(ctx);
  const [cap, change] = tx.moveCall({
    target: `${ctx.config.latestPackageId}::creator::open_vault`,
    typeArguments: [args.coinType],
    arguments: [tx.object(ctx.config.platformId), tx.object(args.accountId), args.paymentCoin],
  });
  tx.transferObjects([cap!, change!], args.sender);
  return tx;
}

export function addTier(
  ctx: BuilderContext,
  args: {
    coinType: string;
    vaultId: string;
    capId: string;
    name: string;
    price: bigint;
    periodMs: bigint;
  },
): Transaction {
  const tx = begin(ctx);
  tx.moveCall({
    target: `${ctx.config.latestPackageId}::creator::add_tier`,
    typeArguments: [args.coinType],
    arguments: [
      tx.object(args.vaultId),
      tx.object(args.capId),
      tx.pure.string(args.name),
      tx.pure.u64(args.price),
      tx.pure.u64(args.periodMs),
    ],
  });
  return tx;
}

export function setContentPrice(
  ctx: BuilderContext,
  args: {
    coinType: string;
    vaultId: string;
    capId: string;
    contentKey: Uint8Array;
    price: bigint;
  },
): Transaction {
  const tx = begin(ctx);
  tx.moveCall({
    target: `${ctx.config.latestPackageId}::creator::set_content_price`,
    typeArguments: [args.coinType],
    arguments: [
      tx.object(args.vaultId),
      tx.object(args.capId),
      tx.pure.vector('u8', Array.from(args.contentKey)),
      tx.pure.u64(args.price),
    ],
  });
  return tx;
}

export function subscribe(
  ctx: BuilderContext,
  args: {
    coinType: string;
    vaultId: string;
    accountId: string;
    tierIndex: bigint;
    paymentCoin: TransactionObjectArgument;
    sender: string;
  },
): Transaction {
  const tx = begin(ctx);
  const [change] = tx.moveCall({
    target: `${ctx.config.latestPackageId}::creator::subscribe`,
    typeArguments: [args.coinType],
    arguments: [
      tx.object(ctx.config.platformId),
      tx.object(args.vaultId),
      tx.object(args.accountId),
      tx.pure.u64(args.tierIndex),
      args.paymentCoin,
      tx.object(CLOCK_ID),
    ],
  });
  tx.transferObjects([change!], args.sender);
  return tx;
}

export function tip(
  ctx: BuilderContext,
  args: {
    coinType: string;
    vaultId: string;
    accountId: string;
    paymentCoin: TransactionObjectArgument;
  },
): Transaction {
  const tx = begin(ctx);
  tx.moveCall({
    target: `${ctx.config.latestPackageId}::creator::tip`,
    typeArguments: [args.coinType],
    arguments: [
      tx.object(ctx.config.platformId),
      tx.object(args.vaultId),
      tx.object(args.accountId),
      args.paymentCoin,
    ],
  });
  return tx;
}

export function unlockContent(
  ctx: BuilderContext,
  args: {
    coinType: string;
    vaultId: string;
    accountId: string;
    contentKey: Uint8Array;
    paymentCoin: TransactionObjectArgument;
    sender: string;
  },
): Transaction {
  const tx = begin(ctx);
  const [change] = tx.moveCall({
    target: `${ctx.config.latestPackageId}::creator::unlock`,
    typeArguments: [args.coinType],
    arguments: [
      tx.object(ctx.config.platformId),
      tx.object(args.vaultId),
      tx.object(args.accountId),
      tx.pure.vector('u8', Array.from(args.contentKey)),
      args.paymentCoin,
      tx.object(CLOCK_ID),
    ],
  });
  tx.transferObjects([change!], args.sender);
  return tx;
}

export function claimEarnings(
  ctx: BuilderContext,
  args: { coinType: string; vaultId: string; capId: string; amount: bigint; recipient: string },
): Transaction {
  const tx = begin(ctx);
  const [coin] = tx.moveCall({
    target: `${ctx.config.latestPackageId}::creator::claim_earnings`,
    typeArguments: [args.coinType],
    arguments: [tx.object(args.vaultId), tx.object(args.capId), tx.pure.u64(args.amount)],
  });
  tx.transferObjects([coin!], args.recipient);
  return tx;
}

export function setAccepting(
  ctx: BuilderContext,
  args: { coinType: string; vaultId: string; capId: string; accepting: boolean },
): Transaction {
  const tx = begin(ctx);
  tx.moveCall({
    target: `${ctx.config.latestPackageId}::creator::set_accepting`,
    typeArguments: [args.coinType],
    arguments: [tx.object(args.vaultId), tx.object(args.capId), tx.pure.bool(args.accepting)],
  });
  return tx;
}

export function claimPlatformFees(
  ctx: BuilderContext,
  args: { coinType: string; vaultId: string; capId: string; amount: bigint; recipient: string },
): Transaction {
  const tx = begin(ctx);
  const [coin] = tx.moveCall({
    target: `${ctx.config.latestPackageId}::creator::claim_platform_fees`,
    typeArguments: [args.coinType],
    arguments: [tx.object(args.vaultId), tx.object(args.capId), tx.pure.u64(args.amount)],
  });
  tx.transferObjects([coin!], args.recipient);
  return tx;
}

export function openStakeVault(
  ctx: BuilderContext,
  args: { accountId: string; validator: string; sender: string },
): Transaction {
  const tx = begin(ctx);
  const [cap] = tx.moveCall({
    target: `${ctx.config.latestPackageId}::stake_vault::open`,
    arguments: [
      tx.object(ctx.config.platformId),
      tx.object(args.accountId),
      tx.pure.address(args.validator),
    ],
  });
  tx.transferObjects([cap!], args.sender);
  return tx;
}

export function depositStake(
  ctx: BuilderContext,
  args: { vaultId: string; accountId: string; paymentCoin: TransactionObjectArgument },
): Transaction {
  const tx = begin(ctx);
  tx.moveCall({
    target: `${ctx.config.latestPackageId}::stake_vault::deposit`,
    arguments: [
      tx.object(ctx.config.platformId),
      tx.object(args.vaultId),
      tx.object(args.accountId),
      args.paymentCoin,
    ],
  });
  return tx;
}

export function withdrawStake(
  ctx: BuilderContext,
  args: { vaultId: string; accountId: string; amount: bigint; recipient: string },
): Transaction {
  const tx = begin(ctx);
  const [coin] = tx.moveCall({
    target: `${ctx.config.latestPackageId}::stake_vault::withdraw`,
    arguments: [
      tx.object(args.vaultId),
      tx.object(args.accountId),
      tx.pure.u64(args.amount),
      tx.object(SUI_SYSTEM_STATE_ID),
    ],
  });
  tx.transferObjects([coin!], args.recipient);
  return tx;
}

export function harvest(ctx: BuilderContext, args: { vaultId: string }): Transaction {
  const tx = begin(ctx);
  tx.moveCall({
    target: `${ctx.config.latestPackageId}::stake_vault::harvest`,
    arguments: [tx.object(args.vaultId), tx.object(SUI_SYSTEM_STATE_ID)],
  });
  return tx;
}

export function claimRebate(
  ctx: BuilderContext,
  args: { vaultId: string; accountId: string; recipient: string },
): Transaction {
  const tx = begin(ctx);
  const [coin] = tx.moveCall({
    target: `${ctx.config.latestPackageId}::stake_vault::claim_rebate`,
    arguments: [tx.object(args.vaultId), tx.object(args.accountId)],
  });
  tx.transferObjects([coin!], args.recipient);
  return tx;
}

export function claimCreatorYield(
  ctx: BuilderContext,
  args: { vaultId: string; capId: string; amount: bigint; recipient: string },
): Transaction {
  const tx = begin(ctx);
  const [coin] = tx.moveCall({
    target: `${ctx.config.latestPackageId}::stake_vault::claim_creator_yield`,
    arguments: [tx.object(args.vaultId), tx.object(args.capId), tx.pure.u64(args.amount)],
  });
  tx.transferObjects([coin!], args.recipient);
  return tx;
}

export function setRebateBps(
  ctx: BuilderContext,
  args: { vaultId: string; capId: string; rebateBps: bigint },
): Transaction {
  const tx = begin(ctx);
  tx.moveCall({
    target: `${ctx.config.latestPackageId}::stake_vault::set_rebate_bps`,
    arguments: [tx.object(args.vaultId), tx.object(args.capId), tx.pure.u64(args.rebateBps)],
  });
  return tx;
}

export function publishEncryptionKey(
  ctx: BuilderContext,
  args: { keyRegistryId: string; x25519Public: Uint8Array },
): Transaction {
  const tx = begin(ctx);
  tx.moveCall({
    target: `${ctx.config.latestPackageId}::key_registry::publish`,
    arguments: [
      tx.object(args.keyRegistryId),
      tx.pure.vector('u8', Array.from(args.x25519Public)),
      tx.object(CLOCK_ID),
    ],
  });
  return tx;
}

export function revokeEncryptionKey(
  ctx: BuilderContext,
  args: { keyRegistryId: string },
): Transaction {
  const tx = begin(ctx);
  tx.moveCall({
    target: `${ctx.config.latestPackageId}::key_registry::revoke`,
    arguments: [tx.object(args.keyRegistryId)],
  });
  return tx;
}

export const FRAMEWORK = { CLOCK_ID, SUI_SYSTEM_STATE_ID } as const;
