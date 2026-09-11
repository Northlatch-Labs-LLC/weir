// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import 'server-only';

/**
 * Account status and handle availability, read from chain.
 *
 * # Why this exists at all
 *
 * A `SocialAccount` is the login. Every paying call in the protocol takes one, so an address
 * without one cannot subscribe, tip, unlock or deposit. Until now the only way to get one was the
 * command line, which means the application had a front door nobody could walk through.
 *
 * # Both refusals are checked before anyone signs
 *
 * `account::open` aborts on `EHandleTaken` and `EAlreadyRegistered`. Discovering either after
 * signing costs gas and delivers the news as an abort code. So both are read here first and shown
 * while the user types.
 *
 * This does not replace the contract's guard and must not be described as if it did — someone can
 * take a handle between the check and the transaction. The check exists to stop the ordinary case
 * from costing money, and the contract remains the thing that decides.
 */

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

/**
 * Table ids, cached for the process lifetime.
 *
 * Fixed when the registry object is created, and nothing changes them. Cached because otherwise
 * every keystroke in the handle field would cost two round trips instead of one.
 */
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
  /** Free, as of this read. Not a promise — see the module note about the race. */
  | { state: 'available' }
  | { state: 'taken'; owner: string }
  /** Rejected by the rules the contract enforces, before any lookup happened. */
  | { state: 'invalid'; problem: HandleProblem };

/**
 * Whether this handle can be claimed.
 *
 * Shape and charset are checked first, locally, so a malformed handle never becomes a chain read.
 * The rules are mirrored from `account.move` and asserted against it by a drift test.
 */
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

/**
 * The handle this address already holds, or `null`.
 *
 * `null` inside an `ok` means "we looked and there is none" — the state that prompts someone to
 * register. A failure means we could not look, and the page must not render that as a prompt to
 * register: the transaction would abort on `EAlreadyRegistered` and cost them gas to find out.
 */
/* Once per request per address — the shell and the page both ask. */
export const accountHandle = cache(async (address: string): Promise<Reading<string | null>> => {
  const t = await registryTables();
  if (!t.ok) return t;

  const config = siteConfig();
  if (!config.ok) return config;

  return handleOf(createClient(config.value), t.value.byAddress, address);
});
