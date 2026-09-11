// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import 'server-only';

import { classify, createClient, fail, ok, type Reading } from '@projectx-social/sdk';
import { siteConfig } from './chain';
import { commentsOnPostsBy, followsOf, listProfiles, messagesTo } from './content';
import { readScales, UNKNOWN_SCALE, type Scale } from './scale';

export interface PaymentNotification {
  checkpoint: bigint;
  what: string;
  gross: string;
  creatorNet: string;
  payer: string;
  vaultId: string;
  digest: string;
  decimals: number | null;
  symbol: string;
}

export type ActivityNotification =
  | { kind: 'comment'; at: number; postId: string; author: string; text: string }
  | { kind: 'follow'; at: number; follower: string; handle: string }
  | { kind: 'message'; at: number; from: string; preview: string; encrypted: boolean };

const PAYMENT_KIND: Readonly<Record<string, string>> = {
  '1': 'subscription',
  '2': 'renewal',
  '3': 'tip',
  '4': 'unlock',
};

const MAX_PAGES = 5;

export interface NotificationFeed {
  payments: PaymentNotification[];
  activity: ActivityNotification[];
  truncated: boolean;
}

export async function readNotifications(
  address: string,
): Promise<Reading<NotificationFeed>> {
  const config = siteConfig();
  if (!config.ok) return config;

  const me = address.toLowerCase();
  const profiles = await listProfiles();

  const myVaults = new Set(
    profiles
      .filter((p) => p.owner.toLowerCase() === me && p.vaultId !== null)
      .map((p) => `0x${BigInt(p.vaultId as string).toString(16).padStart(64, '0')}`),
  );
  const myHandles = new Set(profiles.filter((p) => p.owner.toLowerCase() === me).map((p) => p.handle));

  const coinByVault = new Map<string, string | null>(
    profiles
      .filter((p) => p.owner.toLowerCase() === me && p.vaultId !== null)
      .map((p) => [
        `0x${BigInt(p.vaultId as string).toString(16).padStart(64, '0')}`,
        p.coinType ?? null,
      ]),
  );
  const scales = await readScales(coinByVault.values());
  const scaleOf = (vault: string): Scale => {
    const coinType = coinByVault.get(vault) ?? null;
    return coinType === null ? UNKNOWN_SCALE : scales.get(coinType) ?? UNKNOWN_SCALE;
  };

  const payments: PaymentNotification[] = [];
  const activity: ActivityNotification[] = [];
  let truncated = false;

  if (myVaults.size > 0) {
    const source = 'PaymentSettled events';
    try {
      const client = createClient(config.value);
      let cursor: string | null = null;

      for (let page = 0; page < MAX_PAGES; page += 1) {
        const result: {
          events?: Array<{ json?: unknown; transactionDigest?: unknown; checkpoint?: unknown }>;
          hasNextPage?: boolean;
          endCursor?: string | null;
        } = await client.listEvents({
          filter: { eventType: `${config.value.packageId}::creator::PaymentSettled` },
          limit: 50,
          ...(cursor === null ? {} : { cursor }),
        });

        for (const event of result.events ?? []) {
          const e = event.json as Record<string, unknown> | undefined;
          if (typeof e?.['vault'] !== 'string') continue;

          const vault = `0x${BigInt(e['vault']).toString(16).padStart(64, '0')}`;
          if (!myVaults.has(vault)) continue;

          payments.push({
            checkpoint: BigInt(String(event.checkpoint ?? '0')),
            what: PAYMENT_KIND[String(e['kind'])] ?? `kind ${String(e['kind'])}`,
            gross: String(e['gross'] ?? '0'),
            creatorNet: String(e['creator_net'] ?? '0'),
            payer: String(e['payer'] ?? ''),
            vaultId: vault,
            digest: String(event.transactionDigest ?? ''),
            ...scaleOf(vault),
          });
        }

        if (result.hasNextPage !== true) break;
        cursor = result.endCursor ?? null;
        if (cursor === null) {
          truncated = true;
          break;
        }
        if (page === MAX_PAGES - 1) truncated = true;
      }
    } catch (error) {
      const failure = classify(error, source);
      return fail(failure.kind, source, failure.detail);
    }
  }

  const handles = [...myHandles];

  for (const c of await commentsOnPostsBy(handles, address)) {
    activity.push({
      kind: 'comment',
      at: c.createdAtMs,
      postId: c.postId,
      author: c.author,
      text: c.text,
    });
  }

  for (const f of await followsOf(handles)) {
    activity.push({ kind: 'follow', at: f.createdAtMs, follower: f.follower, handle: f.handle });
  }

  for (const m of await messagesTo(address)) {
    activity.push({
      kind: 'message',
      at: m.createdAtMs,
      from: m.from,
      preview: m.preview,
      encrypted: m.encryption !== null,
    });
  }

  payments.sort((a, b) => (b.checkpoint > a.checkpoint ? 1 : b.checkpoint < a.checkpoint ? -1 : 0));
  activity.sort((a, b) => b.at - a.at);

  return ok({ payments, activity, truncated });
}
