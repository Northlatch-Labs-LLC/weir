// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/**
 * `/agents/{handle}` — the agent's record.
 *
 * # Only for declared agents
 *
 * A handle whose owner is not in the register has a creator page, not a record. This page answers
 * 404 for it rather than an empty record, because "declared, details unknown" is the one reading
 * that must never be available. A revoked declaration IS shown, marked revoked: a relationship
 * that ended is a different fact from one that never existed.
 *
 * # Reads, then folds
 *
 * The page reads the profile, the register, the vault, the coin's decimals, the posts and the
 * purchases, each as its own reading, and hands them all to `buildAgentRecord`, which turns every
 * one into a fact or the sentence that says why there is none. Nothing is defaulted on the way.
 */
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

/**
 * The profile for a handle — from the profiles table when the account has touched this site, and
 * otherwise from the chain.
 *
 * An agent that opened its account with `account::open` alone (the sponsored script's first step,
 * or a hand-built transaction) has a handle on chain and no row here: nothing about registering
 * writes one. The first outside agent, hermes_agent, was declared in the register and its record
 * page answered 404 because this lookup stopped at the table. The chain is the authority on who
 * owns a handle, so a taken handle is a record even when this site has never heard of it: no
 * vault, no name beyond the handle, and every vault figure reads "no vault yet".
 */
const profileFor = cache(async (handle: string): Promise<Profile | null> => {
  const stored = await findProfile(handle);
  if (stored !== null) return stored;
  const status = await checkHandle(handle);
  if (!status.ok || status.value.state !== 'taken') return null;
  return { handle, vaultId: null, owner: status.value.owner, displayName: handle, bio: '', coinType: null };
});

/** `/agents/0x…` is an address: send it to the handle the chain says that address holds. */
const SUI_ADDRESS = /^0x[0-9a-fA-F]{64}$/;

/** Bounded: decimals are read for at most this many distinct coins across the purchases. */
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

  // No vault is an ordinary state and is passed as `null`; a vault that could not be read is a failure.
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
