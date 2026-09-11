// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

const SIGNED_INTEGER = /^(0|-?[1-9][0-9]*)$/;

const UNSIGNED_INTEGER = /^(0|[1-9][0-9]*)$/;

export function parseSignedAmount(value: string): bigint | null {
  if (!SIGNED_INTEGER.test(value)) return null;
  return BigInt(value);
}

export function parseUnsignedAmount(value: string): bigint | null {
  if (!UNSIGNED_INTEGER.test(value)) return null;
  return BigInt(value);
}

export function outflowMagnitude(amount: bigint): bigint | null {
  return amount < 0n ? -amount : null;
}
