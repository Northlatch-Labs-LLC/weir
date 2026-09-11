// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import 'server-only';

import { cache } from 'react';
import {
  createClient,
  handleOf,
  handleProblem,
  readRegistryTables,
  resolveHandle,
  type HandleProblem,
  type Reading,
} from '@projectx-social/sdk';
import { siteConfig } from './chain';

const tables = new Map<string, { byHandle: string; byAddress: string }>();

async function registryTables(): Promise<Reading<{ byHandle: string; byAddress: string }>> {
  const config = siteConfig();
  if (!config.ok) return config;

  const cached = tables.get(config.value.registryId);
  if (cached !== undefined) return { ok: true, value: cached, observedAtMs: Date.now() };

  const client = createClient(config.value);
  const read = await readRegistryTables(client, config.value);
  if (!read.ok) return read;

  const value = { byHandle: read.value.byHandle, byAddress: read.value.byAddress };
  tables.set(config.value.registryId, value);
  return { ok: true, value, observedAtMs: read.observedAtMs };
}

export type HandleStatus =
  | { state: 'available' }
  | { state: 'taken'; owner: string }
  /** Rejected by the rules the contract enforces, before any lookup happened. */
  | { state: 'invalid'; problem: HandleProblem };

export async function checkHandle(handle: string): Promise<Reading<HandleStatus>> {
  const problem = handleProblem(handle);
  if (problem !== null) {
    return { ok: true, value: { state: 'invalid', problem }, observedAtMs: Date.now() };
  }

  const t = await registryTables();
  if (!t.ok) return t;

  const config = siteConfig();
  if (!config.ok) return config;

  const found = await resolveHandle(createClient(config.value), t.value.byHandle, handle);
  if (!found.ok) return found;

  return {
    ok: true,
    value: found.value === null ? { state: 'available' } : { state: 'taken', owner: found.value },
    observedAtMs: found.observedAtMs,
  };
}

export const accountHandle = cache(async (address: string): Promise<Reading<string | null>> => {
  const t = await registryTables();
  if (!t.ok) return t;

  const config = siteConfig();
  if (!config.ok) return config;

  return handleOf(createClient(config.value), t.value.byAddress, address);
});
