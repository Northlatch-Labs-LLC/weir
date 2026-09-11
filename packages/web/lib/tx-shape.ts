// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { Transaction } from '@mysten/sui/transactions';

export function moveTargets(bytes: string): string[] {
  const data = Transaction.from(bytes).getData() as {
    commands: Array<{ MoveCall?: { package: string; module: string; function: string } }>;
  };
  return data.commands
    .map((c) => c.MoveCall)
    .filter((c): c is { package: string; module: string; function: string } => c !== undefined)
    .map((c) => `${c.package}::${c.module}::${c.function}`);
}

export const PURCHASE_CALLS: ReadonlySet<string> = new Set([
  'creator::unlock',
  'creator::subscribe',
  'creator::tip',
  'creator::renew',
]);

export function isPurchase(targets: readonly string[]): boolean {
  return targets.some((t) => PURCHASE_CALLS.has(t.split('::').slice(1).join('::')));
}
