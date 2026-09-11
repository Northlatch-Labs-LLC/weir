// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

export interface LedgerEntry {
  readonly coinType: string;
  readonly amountOut: string;
  readonly atMs: number;
}

export interface OperatorApproval {
  readonly coinType: string;
  readonly maxAmount: string;
  readonly expiresAtMs: number;
}

export interface LedgerState {
  readonly nowMs: number;
  readonly approvals?: readonly OperatorApproval[];
  readonly spend: readonly LedgerEntry[];
}

export const EMPTY_LEDGER: LedgerState = { nowMs: 0, spend: [] };
