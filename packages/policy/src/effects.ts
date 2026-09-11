// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

export interface BalanceChange {
  readonly coinType: string;
  readonly address: string;
  readonly amount: string;
}

export interface MoveCallEffect {
  readonly index: number;
  readonly target: string;
  readonly typeArguments: readonly string[];
}

export interface TransferEffect {
  readonly index: number;
  readonly recipient: string;
}

export type CommandKind =
  | 'MoveCall'
  | 'TransferObjects'
  | 'SplitCoins'
  | 'MergeCoins'
  | 'MakeMoveVec'
  | 'Publish'
  | 'Upgrade'
  | 'Unknown';

export interface SimulatedEffects {
  readonly sender: string;
  readonly gasBudgetMist: string;
  readonly balanceChanges: readonly BalanceChange[];
  readonly balanceChangesObserved: boolean;
  readonly moveCalls: readonly MoveCallEffect[];
  readonly transfers: readonly TransferEffect[];
  readonly commandKinds: readonly CommandKind[];
  readonly objectInputs: readonly ObjectInput[];
  readonly observedAtMs: number;
}

export type ObjectOwnership = 'shared' | 'imm-or-owned' | 'receiving' | 'unclassified';

export interface ObjectInput {
  readonly index: number;
  readonly objectId: string;
  readonly ownership: ObjectOwnership;
  readonly commandIndexes: readonly number[];
}
