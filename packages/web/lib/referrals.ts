// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import 'server-only';

import { classify, createClient, fail, ok, type Reading } from '@projectx-social/sdk';
import { siteConfig } from './chain';

export interface ReferredAccount {
  handle: string;
  owner: string;
  createdAtMs: number;
}

export interface ReferralEarnings {
  referred: ReferredAccount[];
  earnedByVault: Map<string, bigint>;
  payments: number;
  truncated: boolean;
}

const MAX_PAGES = 5;

const sameAddress = (a: unknown, b: string): boolean =>
  typeof a === 'string' && BigInt(a) === BigInt(b);

export async function readReferrals(address: string): Promise<Reading<ReferralEarnings>> {
  const config = siteConfig();
  if (!config.ok) return config;

  const source = `referrals of ${address}`;
  try {
    const client = createClient(config.value);
    let truncated = false;

    const walk = async (eventType: string, visit: (json: Record<string, unknown>) => void) => {
      let cursor: string | null = null;
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
          const json = event.json as Record<string, unknown> | undefined;
          if (json !== undefined) visit(json);
        }

        if (result.hasNextPage !== true) return;
        cursor = result.endCursor ?? null;
        if (cursor === null || page === MAX_PAGES - 1) {
          truncated = true;
          return;
        }
      }
    };

    const referred: ReferredAccount[] = [];
    await walk(`${config.value.packageId}::account::AccountOpened`, (e) => {
      if (!sameAddress(e['referrer'], address)) return;
      if (typeof e['handle'] !== 'string' || typeof e['owner'] !== 'string') return;
      const createdAtMs = Number(e['created_at_ms']);
      if (!Number.isFinite(createdAtMs) || createdAtMs <= 0) return;
      referred.push({ handle: e['handle'], owner: e['owner'], createdAtMs });
    });

    const earnedByVault = new Map<string, bigint>();
    let payments = 0;
    await walk(`${config.value.packageId}::creator::PaymentSettled`, (e) => {
      if (!sameAddress(e['referrer'], address)) return;
      if (typeof e['vault'] !== 'string') return;
      const cut = BigInt(String(e['referral_cut'] ?? '0'));
      const priorMist = earnedByVault.get(e['vault']);
      earnedByVault.set(e['vault'], priorMist === undefined ? cut : priorMist + cut);
      payments += 1;
    });

    referred.sort((a, b) => b.createdAtMs - a.createdAtMs);
    return ok({ referred, earnedByVault, payments, truncated });
  } catch (error) {
    const failure = classify(error, source);
    return fail(failure.kind, source, failure.detail);
  }
}
