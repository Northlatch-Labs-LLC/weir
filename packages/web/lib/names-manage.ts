// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import 'server-only';
import { opaqueDetail } from './opaque';
import { Transaction } from '@mysten/sui/transactions';
import { SuinsClient, SuinsTransaction } from '@mysten/suins';
import {
  createClient,
  fail,
  ok,
  simulationEnvelope,
  simulationStatus,
  type Reading,
} from '@projectx-social/sdk';
import { siteConfig } from './chain';
import { readOwnedNames } from './names-owned';

export type NameAction =
  | { kind: 'point-here'; nftId: string }
  /** Stop this name resolving anywhere. */
  | { kind: 'point-nowhere'; nftId: string }
  /** Show the sender's address as this name. */
  | { kind: 'display'; name: string }
  /** Stop showing any name for the sender's address. */
  | { kind: 'stop-displaying' };

export interface PreparedNameAction {
  bytes: string;
  gasMist: bigint;
  summary: string;
}

interface SimulatedTransaction {
  effects?: { status?: { success?: boolean; error?: string }; gasUsed?: Record<string, unknown> };
  status?: { success?: boolean; error?: string };
}

function totalGas(gasUsed: Record<string, unknown>): bigint {
  const read = (key: string): bigint => {
    const value = gasUsed[key];
    return typeof value === 'string' || typeof value === 'number' ? BigInt(value) : 0n;
  };
  const gross = read('computationCost') + read('storageCost');
  const rebate = read('storageRebate');
  return gross > rebate ? gross - rebate : 0n;
}

export async function prepareNameAction(input: {
  sender: string;
  action: NameAction;
}): Promise<Reading<PreparedNameAction>> {
  const config = siteConfig();
  if (!config.ok) return config;
  const source = `name action for ${input.sender}`;

  try {
    const client = createClient(config.value);

    const action = input.action;
    if (action.kind !== 'stop-displaying') {
      const owned = await readOwnedNames(input.sender);
      if (!owned.ok) return owned;
      const held =
        action.kind === 'display'
          ? owned.value.names.some((n) => n.name === action.name)
          : owned.value.names.some((n) => n.nftId.toLowerCase() === action.nftId.toLowerCase());
      if (!held) {
        return fail(
          'malformed',
          source,
          owned.value.unconfirmed > 0
            ? 'that name is not among the ones we could confirm this address holds'
            : 'this address does not hold that name',
        );
      }
    }

    const tx = new Transaction();
    tx.setSender(input.sender);
    const suinsTx = new SuinsTransaction(new SuinsClient({ client, network: 'mainnet' }), tx);

    let summary: string;
    switch (action.kind) {
      case 'point-here':
        suinsTx.setTargetAddress({ nft: tx.object(action.nftId), address: input.sender });
        summary = 'point this name at your address';
        break;
      case 'point-nowhere':
        suinsTx.setTargetAddress({ nft: tx.object(action.nftId) });
        summary = 'stop this name resolving anywhere';
        break;
      case 'display':
        suinsTx.setDefault(action.name);
        summary = `show your address as ${action.name}`;
        break;
      case 'stop-displaying':
        suinsTx.setDefault('');
        summary = 'stop showing a name for your address';
        break;
    }

    const bytes = await tx.build({ client });
    const sim = await client.simulateTransaction({
      transaction: bytes,
      include: { effects: true },
    });
    const { grpc } = simulationEnvelope(sim);
    const result = grpc as SimulatedTransaction | undefined;
    const status = simulationStatus(sim);
    if (status?.success !== true) {
      return fail('malformed', source, status?.error ?? 'the simulation did not succeed');
    }
    const gasUsed = result?.effects?.gasUsed;
    if (gasUsed === undefined) {
      return fail('malformed', source, 'the simulation returned no gas figure');
    }

    return ok({ bytes: Buffer.from(bytes).toString('base64'), gasMist: totalGas(gasUsed), summary });
  } catch (error) {
    return fail('transport', source, opaqueDetail(source, error));
  }
}
