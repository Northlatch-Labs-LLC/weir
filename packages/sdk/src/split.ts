// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

export const BPS_DENOMINATOR = 10_000n;

export const MAX_PLATFORM_FEE_BPS = 3_000n;

export const MAX_REFERRAL_SHARE_BPS = 5_000n;

export interface PaymentSplit {
  creator: bigint;
  platform: bigint;
  referrer: bigint;
}

export function computeSplit(
  gross: bigint,
  feeBps: bigint,
  referralShareBps: bigint,
  hasReferrer: boolean,
): PaymentSplit {
  assertNonNegative(gross, 'gross');
  assertNonNegative(feeBps, 'feeBps');
  assertNonNegative(referralShareBps, 'referralShareBps');

  const platformFee = (gross * feeBps) / BPS_DENOMINATOR;
  const referrer = hasReferrer ? (platformFee * referralShareBps) / BPS_DENOMINATOR : 0n;

  return {
    creator: gross - platformFee,
    platform: platformFee - referrer,
    referrer,
  };
}

export interface YieldSplit {
  creator: bigint;
  platform: bigint;
  rebate: bigint;
}

export function computeYieldSplit(gross: bigint, feeBps: bigint, rebateBps: bigint): YieldSplit {
  assertNonNegative(gross, 'gross');
  assertNonNegative(feeBps, 'feeBps');
  assertNonNegative(rebateBps, 'rebateBps');

  const platform = (gross * feeBps) / BPS_DENOMINATOR;
  const afterFee = gross - platform;
  const rebate = (afterFee * rebateBps) / BPS_DENOMINATOR;

  return { creator: afterFee - rebate, platform, rebate };
}

function assertNonNegative(value: bigint, name: string): void {
  if (value < 0n) throw new RangeError(`${name} must not be negative, got ${value}`);
}
