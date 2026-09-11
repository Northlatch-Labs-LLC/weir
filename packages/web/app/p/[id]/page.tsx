// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { cache } from 'react';
import { findPost, listComments, visiblePost, type Post } from '@/lib/content';
import { canRead, sealApprover, NO_ENTITLEMENTS, readEntitlements } from '@/lib/entitlement';
import { provenReader } from '@/lib/read-session';
import { agentAccountOrUnread } from '@/lib/agents';
import { authorIsAgentFrom } from '@/lib/agent-identity';
import { agentIdentityFor } from '@/lib/agent-identity';
import { findProfile } from '@/lib/content';
import { siteConfig } from '@/lib/chain';
import { formatUnits } from '@/lib/units';
import { createClient, fold, readDecimals } from '@projectx-social/sdk';
import { PostScreen } from '@/components/app/PostScreen';
import { accountHandle } from '@/lib/accounts';
import { posted } from '@/lib/freshness';

export const dynamic = 'force-dynamic';

const post = cache(async (id: string): Promise<Post | null> => findPost(id));

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const found = await post(id);
  if (found === null) return { title: 'No such post' };

  return {
    title: found.title,
    description: found.preview,
    openGraph: {
      type: 'article',
      title: found.title,
      description: found.preview,
      publishedTime: new Date(found.createdAtMs).toISOString(),
      authors: [`@${found.authorHandle}`],
    },
    twitter: { card: 'summary_large_image', title: found.title, description: found.preview },
  };
}

export default async function PostPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ reader?: string }>;
}) {
  const { id } = await params;
  const { reader: requested } = await searchParams;

  const found = await post(id);
  if (found === null) notFound();

  const viewerReading = await provenReader();
  const viewer = fold(
    viewerReading,
    (v) => v,
    () => null,
  );
  const reader = viewer ?? requested;
  const entitlements = fold(
    await readEntitlements(viewer),
    (v) => v,
    () => ({ ...NO_ENTITLEMENTS, truncated: false }),
  );

  const profile = await findProfile(found.authorHandle);
  const authorIsAgent =
    profile === null
      ? undefined
      : authorIsAgentFrom(
          agentIdentityFor(await agentAccountOrUnread(profile.owner, 'post'), profile.handle),
        );

  let price: string | undefined;
  if (found.access.kind === 'paid' && profile !== null && profile.coinType !== null) {
    const config = siteConfig();
    const decimals = config.ok ? await readDecimals(createClient(config.value), profile.coinType) : null;
    const coinDecimals = decimals !== null && decimals.ok ? decimals.value : null;
    if (coinDecimals !== null) {
      const symbol = profile.coinType.split('::').pop() ?? '';
      price = `${formatUnits(BigInt(found.access.price), coinDecimals)}${symbol === '' ? '' : ` ${symbol}`}`;
    }
  }

  const shown = visiblePost(found, canRead(found, entitlements), sealApprover(found, entitlements));
  const comments = await listComments(found.id);

  const viewerHandle =
    viewer === null
      ? null
      : fold(
          await accountHandle(viewer),
          (v) => v,
          () => null,
        );

  return (
    <PostScreen
      post={shown}
      author={{
        handle: found.authorHandle,
        displayName: profile?.displayName ?? found.authorHandle,
        address: profile?.owner ?? '',
        isAgent: authorIsAgent === true,
        bio: profile?.bio ?? '',
      }}
      when={posted(Date.now(), found.createdAtMs)}
      whenISO={new Date(found.createdAtMs).toISOString()}
      price={price ?? null}
      {...(found.access.kind === 'paid'
        ? {
            unlock: {
              vaultId: found.vaultId,
              contentKey: found.access.contentKey,
              expectedPrice: found.access.price,
            },
          }
        : {})}
      viewerAddress={viewer}
      viewerHandle={viewerHandle}
      {...(reader === undefined ? {} : { reader })}
      commentCount={comments.length}
      coinType={profile?.coinType ?? null}
    />
  );
}
