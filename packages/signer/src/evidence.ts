// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import type { SuiGrpcClient } from '@mysten/sui/grpc';
import type { Transaction } from '@mysten/sui/transactions';
import { classify, decodeAbort, fail, ok, type DecodedAbort, type Reading } from '@projectx-social/sdk';
import type { BalanceChange, CommandKind, MoveCallEffect, ObjectInput, ObjectOwnership, SimulatedEffects, TransferEffect } from '@projectx-social/policy';

export interface SimulationEvidence {
  readonly wouldSucceed: boolean;
  readonly status: string;
  readonly abort?: DecodedAbort;
  readonly txDigest: string;
  readonly effects: SimulatedEffects;
}

export interface SimulationPort {
  readonly observe: (args: {
    readonly transactionBytes: Uint8Array;
    readonly sender: string;
  }) => Promise<Reading<SimulationEvidence>>;
}

export const UNRESOLVED_RECIPIENT = 'unresolved-at-build-time';

const MAX_ARGUMENT_DEPTH = 8;

export function grpcSimulation(client: SuiGrpcClient): SimulationPort {
  return {
    observe: async ({ transactionBytes, sender }) => {
      const source = 'simulateTransaction';
      let response: unknown;
      try {
        response = await client.simulateTransaction({
          transaction: transactionBytes,
          include: { balanceChanges: true, effects: true, transaction: true },
        });
      } catch (error) {
        return fail('transport', source, classify(error, source).detail);
      }
      return readSimulation(response, sender);
    },
  };
}

export function readSimulation(response: unknown, sender: string): Reading<SimulationEvidence> {
  const source = 'simulateTransaction';
  const envelope = asObject(response);
  if (envelope === null) {
    return fail('malformed', source, 'the simulation response was not an object.');
  }

  const succeeded = asObject(envelope['Transaction']);
  const failed = asObject(envelope['FailedTransaction']);
  const payload = succeeded ?? failed;

  if (payload === null) {
    return fail(
      'malformed',
      source,
      'the response carried neither a Transaction nor a FailedTransaction, so it could not be ' +
        'shown to have succeeded. Nothing was signed. This is a client/server shape mismatch.',
    );
  }

  const status = asObject(payload['status']);
  if (status === null) {
    return fail(
      'malformed',
      source,
      'the simulation carried no status field, so it could not be shown to have succeeded. ' +
        'Treating an unrecognised shape as permission to sign is how a library rename turns ' +
        'into money moving with no simulation behind it.',
    );
  }

  const wouldSucceed = status['success'] === true;
  if (wouldSucceed !== (succeeded !== null)) {
    return fail(
      'malformed',
      source,
      `the response is a ${succeeded !== null ? 'Transaction' : 'FailedTransaction'} but its ` +
        `status reports success=${String(status['success'])}. Refusing on a contradiction.`,
    );
  }

  const rawStatus = wouldSucceed ? 'success' : stringifyError(status['error']);
  const effectsObject = asObject(payload['effects']);
  const txDigest = typeof effectsObject?.['transactionDigest'] === 'string'
    ? (effectsObject['transactionDigest'] as string)
    : '';

  const effects = readEffects(payload, sender);
  if (!effects.ok) return effects;

  const evidence: SimulationEvidence = wouldSucceed
    ? { wouldSucceed: true, status: rawStatus, txDigest, effects: effects.value }
    : {
        wouldSucceed: false,
        status: rawStatus,
        abort: decodeAbort(rawStatus),
        txDigest,
        effects: effects.value,
      };

  return ok(evidence, effects.observedAtMs);
}

function readEffects(
  payload: Record<string, unknown>,
  sender: string,
): Reading<SimulatedEffects> {
  const source = 'simulateTransaction effects';
  const observedAtMs = Date.now();

  const rawChanges = payload['balanceChanges'];
  const balanceChangesObserved = Array.isArray(rawChanges);
  const balanceChanges: BalanceChange[] = [];
  if (balanceChangesObserved) {
    for (const item of rawChanges as unknown[]) {
      const change = asObject(item);
      if (change === null) {
        return fail('malformed', source, 'a balance change was not an object.');
      }
      const { coinType, address, amount } = change;
      if (
        typeof coinType !== 'string' ||
        typeof address !== 'string' ||
        typeof amount !== 'string'
      ) {
        return fail(
          'malformed',
          source,
          'a balance change did not carry string coinType, address and amount. Amounts are not ' +
            'coerced from numbers: above 2^53 a number has already lost the value.',
        );
      }
      balanceChanges.push({ coinType, address, amount });
    }
  }

  const transactionData = asObject(payload['transaction']);
  if (transactionData === null) {
    return fail(
      'malformed',
      source,
      'the response carried no parsed transaction data, so the commands, the gas budget and the ' +
        'transfer recipients could not be read. Request it with include: { transaction: true }.',
    );
  }

  const gasData = asObject(transactionData['gasData']);
  const gasBudgetMist =
    typeof gasData?.['budget'] === 'string'
      ? (gasData['budget'] as string)
      :
        'unreadable';

  const reportedSender =
    typeof transactionData['sender'] === 'string' ? (transactionData['sender'] as string) : sender;

  const inputs = Array.isArray(transactionData['inputs']) ? (transactionData['inputs'] as unknown[]) : [];
  const commands = Array.isArray(transactionData['commands'])
    ? (transactionData['commands'] as unknown[])
    : [];

  const commandKinds: CommandKind[] = [];
  const moveCalls: MoveCallEffect[] = [];
  const transfers: TransferEffect[] = [];
  const references = new Map<number, number[]>();

  for (let index = 0; index < commands.length; index += 1) {
    const command = asObject(commands[index]);
    if (command === null) {
      return fail('malformed', source, `command ${index} was not an object.`);
    }
    const kind = typeof command['$kind'] === 'string' ? (command['$kind'] as string) : 'Unknown';
    commandKinds.push(asCommandKind(kind));

    if (kind === 'MoveCall') {
      const call = asObject(command['MoveCall']);
      if (call === null) {
        return fail('malformed', source, `command ${index} is a MoveCall with no payload.`);
      }
      const packageId = call['package'];
      const moduleName = call['module'];
      const functionName = call['function'];
      if (
        typeof packageId !== 'string' ||
        typeof moduleName !== 'string' ||
        typeof functionName !== 'string'
      ) {
        return fail('malformed', source, `command ${index} has an unreadable MoveCall target.`);
      }
      const typeArguments = Array.isArray(call['typeArguments'])
        ? (call['typeArguments'] as unknown[]).map((t) => (typeof t === 'string' ? t : 'unreadable'))
        : [];
      moveCalls.push({
        index,
        target: `${packageId}::${moduleName}::${functionName}`,
        typeArguments,
      });
    }

    if (kind === 'TransferObjects') {
      const transfer = asObject(command['TransferObjects']);
      if (transfer === null) {
        return fail('malformed', source, `command ${index} is a TransferObjects with no payload.`);
      }
      transfers.push({ index, recipient: resolveAddressArgument(transfer['address'], inputs) });
    }

    collectInputReferences(command, index, references);
  }

  return ok(
    {
      sender: reportedSender,
      gasBudgetMist,
      balanceChanges,
      balanceChangesObserved,
      moveCalls,
      transfers,
      commandKinds,
      objectInputs: readObjectInputs(inputs, references),
      observedAtMs,
    },
    observedAtMs,
  );
}

function collectInputReferences(
  value: unknown,
  commandIndex: number,
  into: Map<number, number[]>,
  depth = 0,
): void {
  if (depth > MAX_ARGUMENT_DEPTH) return;

  if (Array.isArray(value)) {
    for (const item of value) collectInputReferences(item, commandIndex, into, depth + 1);
    return;
  }

  const object = asObject(value);
  if (object === null) return;

  if (object['$kind'] === 'Input' && typeof object['Input'] === 'number') {
    const index = object['Input'];
    if (Number.isInteger(index)) {
      const seen = into.get(index);
      if (seen === undefined) into.set(index, [commandIndex]);
      else if (!seen.includes(commandIndex)) seen.push(commandIndex);
    }
    return;
  }

  for (const nested of Object.values(object)) {
    collectInputReferences(nested, commandIndex, into, depth + 1);
  }
}

function readObjectInputs(
  inputs: readonly unknown[],
  references: Map<number, number[]>,
): ObjectInput[] {
  const out: ObjectInput[] = [];

  for (let index = 0; index < inputs.length; index += 1) {
    const commandIndexes = references.get(index) ?? [];
    const classified = classifyInput(index, inputs[index], commandIndexes);
    if (classified !== null) out.push(classified);
  }

  for (const [index, commandIndexes] of references) {
    if (index >= 0 && index < inputs.length) continue;
    out.push({ index, objectId: '', ownership: 'unclassified', commandIndexes: [...commandIndexes] });
  }

  return out;
}

function classifyInput(
  index: number,
  raw: unknown,
  commandIndexes: readonly number[],
): ObjectInput | null {
  const unclassified = (objectId: string): ObjectInput => ({
    index,
    objectId,
    ownership: 'unclassified',
    commandIndexes: [...commandIndexes],
  });

  const input = asObject(raw);
  if (input === null) return unclassified('');

  const kind = input['$kind'];
  if (kind === 'Pure' || kind === 'UnresolvedPure') return null;

  if (kind !== 'Object') {
    const objectId = input['UnresolvedObject'];
    const nested = asObject(objectId);
    return unclassified(typeof nested?.['objectId'] === 'string' ? nested['objectId'] : '');
  }

  const arg = asObject(input['Object']);
  if (arg === null) return unclassified('');

  const ownership = OBJECT_ARG_KINDS[String(arg['$kind'])];
  if (ownership === undefined) {
    return unclassified('');
  }

  const payload = asObject(arg[String(arg['$kind'])]);
  const objectId = payload?.['objectId'];
  if (typeof objectId !== 'string') return unclassified('');

  return { index, objectId, ownership, commandIndexes: [...commandIndexes] };
}

const OBJECT_ARG_KINDS: Readonly<Record<string, ObjectOwnership | undefined>> = {
  SharedObject: 'shared',
  ImmOrOwnedObject: 'imm-or-owned',
  Receiving: 'receiving',
};

function resolveAddressArgument(argument: unknown, inputs: readonly unknown[]): string {
  const arg = asObject(argument);
  if (arg === null) return UNRESOLVED_RECIPIENT;

  if (arg['$kind'] !== 'Input' || typeof arg['Input'] !== 'number') {
    return UNRESOLVED_RECIPIENT;
  }

  const input = asObject(inputs[arg['Input'] as number]);
  if (input === null || input['$kind'] !== 'Pure') return UNRESOLVED_RECIPIENT;

  const pure = asObject(input['Pure']);
  const bytes = pure?.['bytes'];

  let raw: Uint8Array;
  if (typeof bytes === 'string') {
    try {
      raw = Uint8Array.from(Buffer.from(bytes, 'base64'));
    } catch {
      return UNRESOLVED_RECIPIENT;
    }
  } else if (bytes instanceof Uint8Array) {
    raw = bytes;
  } else {
    return UNRESOLVED_RECIPIENT;
  }

  if (raw.length !== 32) return UNRESOLVED_RECIPIENT;

  let hex = '';
  for (const byte of raw) hex += byte.toString(16).padStart(2, '0');
  return `0x${hex}`;
}

function asCommandKind(kind: string): CommandKind {
  switch (kind) {
    case 'MoveCall':
    case 'TransferObjects':
    case 'SplitCoins':
    case 'MergeCoins':
    case 'MakeMoveVec':
    case 'Publish':
    case 'Upgrade':
      return kind;
    default:
      return 'Unknown';
  }
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function stringifyError(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error === null || error === undefined) return 'failed with no error detail';
  const object = asObject(error);
  if (object !== null && typeof object['message'] === 'string') return object['message'] as string;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export async function buildBytes(
  client: SuiGrpcClient,
  transaction: Transaction,
  sender: string,
): Promise<Reading<Uint8Array>> {
  const source = 'transaction build';
  try {
    transaction.setSenderIfNotSet(sender);
    return ok(await transaction.build({ client }));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (/MoveAbort|abort code:/i.test(detail)) {
      const abort = decodeAbort(detail);
      return fail(
        'malformed',
        source,
        `the transaction aborts and could not even be built: ${detail}` +
          (abort.explanation === null ? '' : ` — ${abort.explanation}`),
      );
    }
    return fail('transport', source, classify(error, source).detail);
  }
}
