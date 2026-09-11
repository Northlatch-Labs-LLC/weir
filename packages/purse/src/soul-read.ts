// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { allow, refuse, type Outcome } from './outcome.js';
import type { SoulReading } from './ledger.js';

const READ_TIMEOUT_MS = 30_000;

async function graphql(endpoint: string, query: string): Promise<Outcome<unknown>> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, READ_TIMEOUT_MS);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query }),
      signal: controller.signal,
    });
    if (!response.ok) {
      return refuse('chain-unreadable', `${endpoint} answered ${String(response.status)}.`);
    }
    const body = (await response.json()) as { data?: unknown; errors?: readonly { message: string }[] };
    if (body.errors && body.errors.length > 0) {
      return refuse('chain-unreadable', `${endpoint}: ${body.errors.map((e) => e.message).join('; ')}`);
    }
    if (body.data === undefined || body.data === null) {
      return refuse('chain-unreadable', `${endpoint} answered with no data.`);
    }
    return allow(body.data);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return refuse('chain-unreadable', `${endpoint} could not be read: ${detail}.`);
  } finally {
    clearTimeout(timer);
  }
}

function u64(value: unknown, field: string): Outcome<bigint> {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,19})$/.test(value)) {
    return refuse('chain-unreadable', `${field} was not a u64 decimal string: ${JSON.stringify(value)}`);
  }
  return allow(BigInt(value));
}

export async function readCurrentEpoch(endpoint: string): Promise<Outcome<bigint>> {
  const read = await graphql(endpoint, 'query { epoch { epochId } }');
  if (!read.ok) return read;
  const id = (read.value as { epoch?: { epochId?: unknown } }).epoch?.epochId;
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 0) {
    return refuse('chain-unreadable', `epochId was not a whole number: ${JSON.stringify(id)}`);
  }
  return allow(BigInt(id));
}

export async function readSoul(endpoint: string, soulId: string): Promise<Outcome<SoulReading>> {
  const read = await graphql(
    endpoint,
    `query { object(address: "${soulId}") { asMoveObject { contents { json } } } }`,
  );
  if (!read.ok) return read;
  const json = (
    read.value as { object?: { asMoveObject?: { contents?: { json?: Record<string, unknown> } } } }
  ).object?.asMoveObject?.contents?.json;
  if (!json) return refuse('chain-unreadable', `${soulId} is not a Move object with contents.`);

  const opened = u64(json.epoch_opened_at, 'epoch_opened_at');
  if (!opened.ok) return opened;
  const allowance = u64(json.allowance_per_epoch, 'allowance_per_epoch');
  if (!allowance.ok) return allowance;
  const earned = u64(json.epoch_earned, 'epoch_earned');
  if (!earned.ok) return earned;
  const burned = u64(json.epoch_burned, 'epoch_burned');
  if (!burned.ok) return burned;
  if (typeof json.state !== 'number') return refuse('chain-unreadable', 'state was not a number.');
  if (typeof json.paused !== 'boolean') return refuse('chain-unreadable', 'paused was not a boolean.');
  if (typeof json.critical_epochs !== 'number') {
    return refuse('chain-unreadable', 'critical_epochs was not a number.');
  }

  return allow({
    epochOpenedAt: opened.value,
    allowancePerEpoch: allowance.value,
    epochEarned: earned.value,
    epochBurned: burned.value,
    state: json.state,
    paused: json.paused,
    criticalEpochs: json.critical_epochs,
  });
}

export async function readVaultEarnings(endpoint: string, vaultId: string): Promise<Outcome<bigint>> {
  const read = await graphql(
    endpoint,
    `query { object(address: "${vaultId}") { asMoveObject { contents { json } } } }`,
  );
  if (!read.ok) return read;
  const json = (
    read.value as { object?: { asMoveObject?: { contents?: { json?: Record<string, unknown> } } } }
  ).object?.asMoveObject?.contents?.json;
  if (!json) return refuse('chain-unreadable', `${vaultId} is not a Move object with contents.`);
  return u64(json.earnings, 'earnings');
}
