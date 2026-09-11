// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import 'server-only';

/**
 * Chain reads. Server-side, over gRPC.
 *
 * # Why this file is `server-only`
 *
 * Every read happens on the server and is rendered into HTML. The browser never holds a chain
 * client, never picks an RPC endpoint, and cannot be pointed at a different one by a query
 * parameter. The import above is a build-time guarantee of that: pulling this into a client
 * component fails the build rather than shipping a second, browser-side transport.
 *
 * # Reads are gRPC; the wallet is the only thing the browser talks to
 *
 * Sui public fullnodes answer JSON-RPC with `-32601 "JSON-RPC on public fullnodes has been
 * deprecated"`. A client built on that transport does not degrade, it stops. So there is no
 * JSON-RPC anywhere in this application — not in a provider, not in a hook, not transitively.
 *
 * That is also why this app does not use a wallet-adapter kit: the popular one types its client as
 * `SuiJsonRpcClient` throughout. Wallet connection here goes straight to the Wallet Standard, which
 * has no client dependency at all.
 */

import { createClient, loadConfig, readPlatform, type PlatformState, type ProjectXSocialConfig, type Reading } from '@projectx-social/sdk';
import { classify, fail, ok } from '@projectx-social/sdk';

export type { PlatformState, Reading };

/**
 * Configuration, read once per request from the environment.
 *
 * No defaults. An unset variable renders a configuration failure on the page rather than silently
 * pointing the site at a deployment nobody chose — on a chain that is not a broken page, it is a
 * page showing someone else's numbers as if they were ours.
 */
export function siteConfig(): Reading<ProjectXSocialConfig> {
  return loadConfig(process.env as Record<string, string | undefined>);
}

/**
 * The coins a creator may denominate a new vault in.
 *
 * Configuration, because a coin type is a deployment fact: it differs between mainnet and testnet,
 * and it is the vault's type parameter — fixed at creation and unchangeable afterwards. It was a
 * literal in `CreatorSetup.tsx`, which meant the interface would silently offer a mainnet coin on
 * any other network.
 *
 * # Why this is a list now
 *
 * This governs what *this interface* will build and simulate, which is not the same as what the
 * chain permits. `open_vault<T>` is generic with no on-chain allowlist, so a vault can be opened in
 * any coin by calling the contract directly. That is deliberate: a creator who denominates in a
 * coin nobody wants has harmed only themselves, and an on-chain allowlist would be a permanent
 * governance burden for a risk borne entirely by the person taking it.
 *
 * Empty when unset, and the vault form is then withheld rather than defaulted. There is no safe
 * guess for the denomination of somebody's business, and a default here would be a permanent
 * financial decision made by whoever wrote the configuration.
 */
export function vaultCoinTypes(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): string[] {
  const raw = (env['PROJECTX_SOCIAL_VAULT_COIN_TYPES'] ?? '').trim();
  if (raw === '') return [];

  const seen = new Set<string>();
  for (const entry of raw.split(',')) {
    const coinType = entry.trim();
    /*
      `0x…::module::TYPE`, checked here so a malformed value fails at configuration rather than
      inside a transaction builder that would report it as an unrelated abort.

      Malformed entries are dropped rather than failing the whole list. One typo in a
      comma-separated variable should not withhold the vault form for the coins that are spelled
      correctly — and a coin missing from a choice is visible, where a form that silently vanished
      is not.
    */
    if (/^0x[0-9a-fA-F]{1,64}::[A-Za-z_][\w]*::[A-Za-z_][\w]*$/.test(coinType)) seen.add(coinType);
  }
  // Order preserved, duplicates dropped: this is rendered as a choice, and a choice listing the
  // same coin twice reads as a bug in the money.
  return [...seen];
}

export interface ProtocolSnapshot {
  platform: PlatformState;
  config: ProjectXSocialConfig;
}

/** Read the platform's live economic terms. */
export async function readProtocol(): Promise<Reading<ProtocolSnapshot>> {
  const config = siteConfig();
  if (!config.ok) return config;

  const client = createClient(config.value);
  const platform = await readPlatform(client, config.value);
  if (!platform.ok) return platform;

  return ok({ platform: platform.value, config: config.value }, platform.observedAtMs);
}

export interface VaultSummary {
  vaultId: string;
  creator: string;
  validator: string;
  feeBpsSnapshot: bigint;
}

/**
 * Every stake vault the package has opened, from its events.
 *
 * Bounded at ten pages. When the ceiling stops the walk the result is flagged `truncated`, and the
 * page says so — a list silently presented as complete is how the newest vaults stop appearing
 * with nothing looking wrong.
 */
export async function readVaults(): Promise<Reading<{ vaults: VaultSummary[]; truncated: boolean }>> {
  const config = siteConfig();
  if (!config.ok) return config;

  const source = 'StakeVaultOpened events';
  const client = createClient(config.value);
  const eventType = `${config.value.packageId}::stake_vault::StakeVaultOpened`;

  const vaults: VaultSummary[] = [];
  let cursor: string | null = null;
  const MAX_PAGES = 10;

  try {
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const result: {
        events?: Array<{ json?: unknown }>;
        hasNextPage?: boolean;
        endCursor?: string | null;
      } = await client.listEvents({
        filter: { eventType },
        limit: 50,
        ...(cursor === null ? {} : { cursor }),
      });

      for (const event of result.events ?? []) {
        const e = event.json as Record<string, unknown> | undefined;
        if (
          typeof e?.['vault'] !== 'string' ||
          typeof e['creator'] !== 'string' ||
          typeof e['validator'] !== 'string'
        ) {
          return fail('malformed', source, 'an event did not carry the expected fields');
        }
        vaults.push({
          vaultId: e['vault'],
          creator: e['creator'],
          validator: e['validator'],
          feeBpsSnapshot: BigInt(String(e['fee_bps_snapshot'] ?? '0')),
        });
      }

      if (result.hasNextPage !== true) return ok({ vaults, truncated: false });
      cursor = result.endCursor ?? null;
      if (cursor === null) return ok({ vaults, truncated: true });
    }
    return ok({ vaults, truncated: true });
  } catch (error) {
    const failure = classify(error, source);
    return fail(failure.kind, source, failure.detail);
  }
}

/** Suiscan link for an object, so every figure on the page can be checked independently. */
export function explorerUrl(id: string): string {
  return `https://suiscan.xyz/mainnet/object/${id}`;
}

export function shortId(id: string, lead = 6, tail = 4): string {
  return id.length <= lead + tail + 2 ? id : `${id.slice(0, lead)}…${id.slice(-tail)}`;
}
