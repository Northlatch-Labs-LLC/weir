// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

export const EPOCH_DAYS = 14;

export type StorageTier = 'ephemeral' | 'durable';

export const TIER_EPOCHS: Readonly<Record<StorageTier, number>> = {
  ephemeral: 1,
  durable: 53,
};

export function retentionDays(tier: StorageTier): number {
  return TIER_EPOCHS[tier] * EPOCH_DAYS;
}

export function tierForAccess(access: 'public' | 'subscribers' | 'paid'): StorageTier {
  return access === 'public' ? 'ephemeral' : 'durable';
}
