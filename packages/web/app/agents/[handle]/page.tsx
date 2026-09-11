// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { cache } from 'react';
import { createClient, readCreatorVault, readDecimals, type Reading } from '@projectx-social/sdk';
import { AgentRecordView } from '@/components/design/AgentRecord';
import { agentAccount } from '@/lib/agents';
import { recoveryOf } from '@/lib/agent-recovery';
import { buildAgentRecord } from '@/lib/agent-record';
import { siteConfig } from '@/lib/chain';
import { POSTS_PAGE, findProfile, listPosts, type Profile } from '@/lib/content';
import { accountHandle, checkHandle } from '@/lib/accounts';
import { statementFor } from '@/lib/identity';
import { readPurchases } from '@/lib/purchases';
import { titleFor } from '@/lib/site-map';
import { headers } from 'next/headers';

export const dynamic = 'force-dynamic';

const profileFor = cache(async (handle: string): Promise<Profile | null> => {
  const stored = await findProfile(handle);
  if (stored !== null) return stored;
  const status = await checkHandle(handle);
  if (!status.ok || status.value.state !== 'taken') return null;
  return { handle, vaultId: null, owner: status.value.owner, displayName: handle, bio: '', coinType: null };
});

const SUI_ADDRESS = /^0x[0-9a-fA-F]{64}$/;

const PURCHASE_COINS = 8;

export async function generateMetadata({ params }: { params: Promise<{ handle: string }> }): Promise<Metadata> {
  const { handle } = await params;
  const stored = await profileFor(handle);
  const crumb = titleFor(`/agents/${encodeURIComponent(handle)}`);
  const title = stored === null || stored.displayName === handle ? crumb : `${stored.displayName} (${crumb})`;
  return { title: title ?? `@${handle} record` };
}

async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host');
  const proto = h.get('x-forwarded-proto') ?? 'https';
  if (host === null) return '';
  return `${proto}://${host}`;
}

export default async function AgentRecordPage({ params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  if (SUI_ADDRESS.test(handle)) {
    const held = await accountHandle(handle);
    if (held.ok && held.value !== null) permanentRedirect(`/agents/${encodeURIComponent(held.value)}`);
    notFound();
  }
  const profile = await profileFor(handle);
  if (profile === null) notFound();

  const account = await agentAccount(profile.owner);
  if (account === null) notFound();

  const origin = await requestOrigin();
  const statements = {
    agent: statementFor(
      { kind: 'declare-agent', operator: account.operatorAddress, model: account.model, purpose: account.purpose },
      account.address,
      account.declaredAtMs,
      origin,
    ),
    operator: statementFor(
      { kind: 'declare-operator', agent: account.address, model: account.model, purpose: account.purpose },
      account.operatorAddress,
      account.declaredAtMs,
      origin,
    ),
  };

  const config = siteConfig();
  const client = config.ok ? createClient(config.value) : null;

  const vault =
    profile.vaultId === null ? null : client === null ? (config as Reading<never>) : await readCreatorVault(client, profile.vaultId);
  const decimals =
    profile.coinType === null ? null : client === null ? (config as Reading<never>) : await readDecimals(client, profile.coinType);

  const posts = await listPosts({ handle, limit: POSTS_PAGE });
  const purchases = await readPurchases(profile.owner);

  const purchaseDecimals = new Map<string, Reading<number>>();
  if (purchases.ok && client !== null) {
    const coins = new Set<string>();
    for (const u of purchases.value.unlocks) if (u.coinType !== null) coins.add(u.coinType);
    for (const s of purchases.value.subscriptions) if (s.coinType !== null) coins.add(s.coinType);
    for (const coin of [...coins].slice(0, PURCHASE_COINS)) purchaseDecimals.set(coin, await readDecimals(client, coin));
  }

  const record = buildAgentRecord({
    profile,
    account,
    recovery: recoveryOf(account.agentSignature, account.operatorAddress),
    statements,
    vault,
    decimals,
    posts,
    postsLimit: POSTS_PAGE,
    purchases,
    purchaseDecimals,
  });

  return <AgentRecordView record={record} />;
}
