// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import 'server-only';

import { createClient, classify, fail, ok, type Reading } from '@projectx-social/sdk';
import { siteConfig } from './chain';

const KIND_TIP = 3;

const MAX_PAGES = 20;

export interface ChestPot {
  vaultId: string;
  totalMinor: bigint;
  gifts: number;
  givers: number;
}

export interface ChestIndex {
  byVault: Map<string, ChestPot>;
  truncated: boolean;
}

export async function readChestPots(): Promise<Reading<ChestIndex>> {
  const config = siteConfig();
  if (!config.ok) return config;

  const source = 'PaymentSettled events';
  const client = createClient(config.value);
  const eventType = `${config.value.packageId}::creator::PaymentSettled`;

  const byVault = new Map<string, ChestPot>();
  const payers = new Map<string, Set<string>>();
  let truncated = false;
  let cursor: string | null = null;

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
        if (e === undefined) continue;

        if (Number(e['kind']) !== KIND_TIP) continue;

        const vault = e['vault'];
        const payer = e['payer'];
        if (typeof vault !== 'string' || typeof payer !== 'string') {
          return fail('malformed', source, 'a settled payment did not name its vault and payer');
        }

        const gross = BigInt(String(e['gross'] ?? '0'));

        const held = byVault.get(vault);
        if (held === undefined) {
          byVault.set(vault, { vaultId: vault, totalMinor: gross, gifts: 1, givers: 0 });
          payers.set(vault, new Set([payer]));
        } else {
          held.totalMinor += gross;
          held.gifts += 1;
          payers.get(vault)?.add(payer);
        }
      }

      if (result.hasNextPage !== true) break;
      cursor = result.endCursor ?? null;
      if (cursor === null || page === MAX_PAGES - 1) {
        truncated = true;
        break;
      }
    }
  } catch (error) {
    const failure = classify(error, source);
    return fail(failure.kind, source, failure.detail);
  }

  for (const [vault, set] of payers) {
    const pot = byVault.get(vault);
    if (pot !== undefined) pot.givers = set.size;
  }

  return ok({ byVault, truncated });
}
