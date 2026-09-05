// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/**
 * What a signed transaction is about to do, read from its bytes.
 *
 * The submit route quotas a caller by what the bytes CALL, not by what the body says: a request
 * can claim anything, but the bytes name the Move functions the node will execute. The same
 * reading `lib/sponsor.ts` makes before it signs gas, kept separate here so the sponsor's own
 * invariant ("exactly one open, nothing beside it") is not loosened by sharing code with a reader
 * that only classifies.
 */
import { Transaction } from '@mysten/sui/transactions';

/** `package::module::function` for every MoveCall in the transaction, in order. */
export function moveTargets(bytes: string): string[] {
  const data = Transaction.from(bytes).getData() as {
    commands: Array<{ MoveCall?: { package: string; module: string; function: string } }>;
  };
  return data.commands
    .map((c) => c.MoveCall)
    .filter((c): c is { package: string; module: string; function: string } => c !== undefined)
    .map((c) => `${c.package}::${c.module}::${c.function}`);
}

/**
 * The calls that move a buyer's money to a creator. `QUOTAS.purchase` — ten at once, then one
 * every six minutes — exists for these and nothing else; a `write` is every other signed call.
 * Matched on module and function only: the quoted-bytes check in `submitSigned` already binds
 * the package to this deployment, and a purchase on a version this deployment did not quote is
 * refused there.
 */
export const PURCHASE_CALLS: ReadonlySet<string> = new Set([
  'creator::unlock',
  'creator::subscribe',
  'creator::tip',
  'creator::renew',
]);

export function isPurchase(targets: readonly string[]): boolean {
  return targets.some((t) => PURCHASE_CALLS.has(t.split('::').slice(1).join('::')));
}
