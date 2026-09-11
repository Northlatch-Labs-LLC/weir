// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import type { Transaction, TransactionObjectArgument } from '@mysten/sui/transactions';

export interface BoundedPaymentArgs {
  readonly source: TransactionObjectArgument;
  readonly ceiling: bigint;
}

export function boundedPayment(
  tx: Transaction,
  args: BoundedPaymentArgs,
): TransactionObjectArgument {
  if (typeof args.ceiling !== 'bigint') {
    throw new Error(
      `boundedPayment needs a bigint ceiling in the coin's smallest unit; got ` +
        `${typeof args.ceiling} (${String(args.ceiling)}). A number loses precision above 2^53 ` +
        `and a missing value would reach splitCoins as an error naming neither this function nor ` +
        `the ceiling.`,
    );
  }
  if (args.ceiling <= 0n) {
    throw new Error(
      `boundedPayment needs a positive ceiling; got ${args.ceiling.toString()}. A zero-funded ` +
        `payment coin aborts every priced call on EInsufficientPayment, which is a failure that ` +
        `looks like a pricing bug rather than a configuration one.`,
    );
  }
  if (args.ceiling > MAX_U64) {
    throw new Error(
      `boundedPayment ceiling ${args.ceiling.toString()} exceeds u64. It cannot be represented ` +
        `on chain, so the split would be built from a value the contract could never hold.`,
    );
  }

  const [payment] = tx.splitCoins(args.source, [args.ceiling]);
  return payment!;
}

export const MAX_U64 = 18_446_744_073_709_551_615n;
