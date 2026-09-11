// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { createClient, fold, readCreatorVault, readDecimals } from '@projectx-social/sdk';
import {
  POSTS_PAGE,
  countFollowers,
  findProfile,
  isFollowing,
  listPosts,
  type Profile,
  visiblePost,
} from '@/lib/content';
import { checkHandle } from '@/lib/accounts';
import { agentAccountOrUnread } from '@/lib/agents';
import { agentIdentityFor, authorIsAgentFrom } from '@/lib/agent-identity';
import { reverseName } from '@/lib/names';
import { canRead, sealApprover, NO_ENTITLEMENTS, readEntitlements } from '@/lib/entitlement';
import { provenReader } from '@/lib/read-session';
import { siteConfig, explorerUrl, shortId, readVaults } from '@/lib/chain';
import { readVault } from '@/lib/stake';
import { listPerks, readSupportersFirst } from '@/lib/perks';
import { standingOf } from '@/lib/supporters';
import { FollowButton } from '@/components/FollowButton';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { cache } from 'react';
import { titleFor } from '@/lib/site-map';
import { formatUnits } from '@/lib/units';
import { EntityType, entitiesOf } from '@/components/EntityType';
import { SubscribeButton } from '@/components/SubscribeButton';
import type { CreatorTab, DesignStat, DesignTier } from '@/components/design/Creator';
import { CreatorScreen } from '@/components/app/CreatorScreen';
import { posted } from '@/lib/freshness';
import type { PostView } from '@projectx-social/ui';
import type { DesignFeedPost } from '@/components/design/Home';
import { TipButton } from '@/components/TipButton';
import { DepositCheckout } from '@/components/DepositCheckout';
import { JsonLd } from '@/components/seo/JsonLd';
import { profilePageJsonLd } from '@/lib/structured-data';

export const dynamic = 'force-dynamic';

const profileFor = cache(findProfile);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const { handle } = await params;
  const stored = await profileFor(handle);
  const crumb = titleFor(`/c/${encodeURIComponent(handle)}`);
  const title = stored === null || stored.displayName === handle ? crumb : `${stored.displayName} (${crumb})`;
  return stored === null
    ? { title }
    : stored.bio === ''
      ? { title, description: `@${handle} on Weir. Posts, membership and a vault paid on chain.` }
      : { title, description: stored.bio };
}

export default async function CreatorPage({
  params,
  searchParams,
}: {
  params: Promise<{ handle: string }>;
  searchParams: Promise<{ reader?: string; tab?: string }>;
}) {
  const { handle } = await params;
  const { reader, tab: requestedTab } = await searchParams;
  const tab: CreatorTab = requestedTab === 'membership' ? 'membership' : 'posts';
  const tabHref = (t: CreatorTab) => {
    const q = new URLSearchParams();
    if (t !== 'posts') q.set('tab', t);
    if (reader !== undefined) q.set('reader', reader);
    const qs = q.toString();
    return `/c/${encodeURIComponent(handle)}${qs === '' ? '' : `?${qs}`}`;
  };

  const stored = await profileFor(handle);
  const claimed = stored === null ? await checkHandle(handle) : null;
  const onChainOwner =
    claimed !== null && claimed.ok && claimed.value.state === 'taken' ? claimed.value.owner : null;

  if (stored === null && onChainOwner === null) notFound();

  const profile: Profile =
    stored ??
    ({
      handle,
      displayName: handle,
      owner: onChainOwner as string,
      bio: '',
      vaultId: null,
      coinType: null,
    } satisfies Profile);

  const posts = await listPosts({ handle, limit: POSTS_PAGE });
  const followers = await countFollowers(handle);
  const following = await isFollowing(reader ?? null, handle);
  const viewerReading = await provenReader();
  const viewer = fold(
    viewerReading,
    (v) => v,
    () => null,
  );
  const entitlementReading = await readEntitlements(viewer);
  const entitlements = fold(
    entitlementReading,
    (v) => v,
    () => ({ ...NO_ENTITLEMENTS, truncated: false }),
  );

  const config = siteConfig();
  const vault =
    profile.vaultId === null
      ? null
      : config.ok
        ? await readCreatorVault(createClient(config.value), profile.vaultId)
        : config;

  const decimals =
    config.ok && profile.coinType !== null
      ? await readDecimals(createClient(config.value), profile.coinType)
      : null;
  const coinDecimals = decimals !== null && decimals.ok ? decimals.value : null;
  const coinSymbol = profile.coinType?.split('::').pop() ?? '';

  const money = (minor: bigint): string =>
    coinDecimals === null
      ? 'scale unknown'
      : `${formatUnits(minor, coinDecimals)}${coinSymbol === '' ? '' : ` ${coinSymbol}`}`;

  const ownerNameReading = await reverseName(profile.owner);
  const ownerName = ownerNameReading.ok ? ownerNameReading.value : null;

  const onChainStakeVaults = await (async () => {
    const walked = await readVaults();
    if (!walked.ok) return undefined;
    return walked.value.vaults.filter(
      (v) => v.creator.toLowerCase() === profile.owner.toLowerCase(),
    );
  })();
  const onChainStakeVault = onChainStakeVaults?.[0]?.vaultId;

  const perks = await listPerks(profile.handle);
  const supportersFirst = perks.length === 0 ? false : await readSupportersFirst(profile.handle);
  const standing =
    perks.length === 0 || profile.vaultId === null ? null : await standingOf(profile.vaultId, viewer);

  const rebateBps =
    onChainStakeVault === undefined
      ? null
      : fold(
          await readVault(onChainStakeVault),
          (value) => Number(value.rebateBps),
          () => null,
        );

  const DIM = 'var(--dim,#a3bcb8)';
  const INK = 'var(--ink,#dce9e6)';
  const ALERT = 'var(--alert,#f2a29b)';
  const CREST = 'var(--crest,#8be3c6)';

  const v = vault !== null && vault.ok ? vault.value : null;
  const activeTiers = v === null ? [] : v.tiers.filter((t) => t.active);

  const MONO = 'var(--weir-mono)';
  const BODY = "'Geist',sans-serif";

  const measured = (label: string, value: string, note: string): DesignStat => ({
    label, value, note, font: MONO, size: '1.5rem', style: 'normal', color: INK,
  });
  const unread = (label: string, why: string): DesignStat => ({
    label, value: 'reading from the chain', note: why, font: BODY, size: '1.0625rem', style: 'italic', color: ALERT,
  });

  const noVaultNote = v === null ? 'No vault opened yet, so nothing has settled on this page.' : null;

  const stats: DesignStat[] =
    v === null
      ? []
      : coinDecimals === null
        ? [
            unread('Settled volume', "the coin scale is being read from the chain"),
            measured('Subscriptions', v.subscriptionsSold.toString(), 'sold to date, from the vault'),
            unread('Unclaimed earnings', "the coin scale is being read from the chain"),
          ]
        : [
            measured('Settled volume', money(v.grossVolume), 'gross, settled on chain'),
            measured('Subscriptions', v.subscriptionsSold.toString(), 'sold to date, from the vault'),
            measured('Unclaimed earnings', money(v.earnings), 'held by the contract, not by us'),
          ];

  const holdsSubscription = profile.vaultId !== null && entitlements.subscribedVaults.has(profile.vaultId);

  const tiers: DesignTier[] = activeTiers.map((t) => {
    const days = Number(t.periodMs / 86_400_000n);
    const net =
      v === null || coinDecimals === null
        ? 'reading from the chain'
        : money((t.price * (10_000n - v.feeBpsSnapshot)) / 10_000n);
    return {
      price: coinDecimals === null ? 'reading from the chain' : money(t.price),
      cadence: `${t.name} · every ${days} day${days === 1 ? '' : 's'}`,
      net: coinDecimals === null
        ? "the coin scale is being read from the chain"
        : `Creator keeps ${net}`,
      held: holdsSubscription,
      action: holdsSubscription ? (
        <p style={{ margin: 0, color: CREST, fontSize: '0.9375rem', fontWeight: 600 }}>
          You hold this membership. Subscriber posts are open to you.
        </p>
      ) : coinDecimals === null || profile.vaultId === null || profile.coinType === null ? (
        <p style={{ margin: 0, color: ALERT, fontSize: '0.9375rem' }}>
          Not for sale right now: the coin scale is being read from the chain.
        </p>
      ) : viewer === null ? (
        <a className="btn ghost" href={`/signin?next=${encodeURIComponent(`/c/${profile.handle}`)}`}>
          Sign in to join
        </a>
      ) : (
        <SubscribeButton
          vaultId={profile.vaultId}
          coinType={profile.coinType}
          tierIndex={Number(t.index)}
          decimals={coinDecimals}
          symbol={coinSymbol}
        />
      ),
    };
  });

  const agentIdentity = agentIdentityFor(await agentAccountOrUnread(profile.owner, 'creator'), profile.handle);
  const authorIsAgent = authorIsAgentFrom(agentIdentity);

  const profilePosts: DesignFeedPost[] = posts.map((post) => ({
    post: visiblePost(
      post,
      canRead(post, entitlements),
      sealApprover(post, entitlements),
    ),
    price:
      post.access.kind === 'paid' && coinDecimals !== null
        ? `${formatUnits(BigInt(post.access.price), coinDecimals)}${coinSymbol === '' ? '' : ` ${coinSymbol}`}`
        : undefined,
    reader,
    entities: entitiesOf({
      tiers: activeTiers.length,
      stakeVaultId: onChainStakeVault ?? null,
    }),
    ...(authorIsAgent === undefined ? {} : { authorIsAgent }),
  }));

  const subscribeSlot =
    viewer === null ? (
      <a className="btn ghost" href={`/signin?next=${encodeURIComponent(`/c/${profile.handle}`)}`}>
        Sign in to follow
      </a>
    ) : (
      <FollowButton handle={profile.handle} initialFollowing={following} initialCount={followers} />
    );

  const depositSlot =
    viewer === null ? (
      <a className="btn" href={`/signin?next=${encodeURIComponent(`/c/${profile.handle}`)}`}>
        Sign in to become a member
      </a>
    ) : onChainStakeVault === undefined ? (
      <p style={{ margin: 0, color: DIM, fontSize: '0.9375rem' }}>
        This account has not opened a pool yet, so there is nowhere to deposit.
      </p>
    ) : (
      <DepositCheckout vaultId={onChainStakeVault} />
    );

  const tipNote =
    profile.vaultId === null
      ? 'No creator vault yet, so there is nowhere for a tip to settle.'
      : coinDecimals === null
        ? 'Tipping opens as soon as the coin scale is read from the chain.'
        : null;

  const tipSlot =
    profile.vaultId === null || coinDecimals === null ? undefined : viewer === null ? (
      <a className="btn ghost" href={`/signin?next=${encodeURIComponent(`/c/${profile.handle}`)}`}>
        Sign in to tip
      </a>
    ) : (
      <TipButton vaultId={profile.vaultId} decimals={coinDecimals} symbol={coinSymbol} />
    );

  const now = Date.now();
  const appPosts: PostView[] = profilePosts.map((entry) => ({
    id: entry.post.id,
    author: {
      address: profile.owner,
      handle: profile.handle,
      displayName: profile.displayName,
      isAgent: authorIsAgent === true,
    },
    when: posted(now, entry.post.createdAtMs),
    whenISO: new Date(entry.post.createdAtMs).toISOString(),
    title: entry.post.title === '' ? null : entry.post.title,
    body: entry.post.body ?? entry.post.preview,
    access:
      entry.post.access.kind === 'paid'
        ? { kind: 'paid', price: entry.price ?? null }
        : entry.post.access.kind === 'subscribers'
          ? { kind: 'subscribers', tier: null }
          : { kind: 'free' },
    unlocked: !entry.post.locked && entry.post.access.kind !== 'public',
    comments: entry.post.commentCount,
  }));

  return (
    <>
      <JsonLd
        data={profilePageJsonLd({
          handle: profile.handle,
          displayName: profile.displayName,
          bio: profile.bio,
          followers,
        })}
      />
      <CreatorScreen
        profile={{
          handle: profile.handle,
          displayName: profile.displayName,
          bio: profile.bio,
          address: profile.owner,
          isAgent: authorIsAgent === true,
          sui: ownerName ?? shortId(profile.owner),
        }}
        counts={{ posts: profilePosts.length, followers, subscribers: null }}
        figures={stats.map((stat: DesignStat) => ({
          label: stat.label,
          value: stat.value,
          note: stat.note,
          unread: stat.value === 'reading from the chain',
        }))}
        tiers={tiers.map((t: DesignTier) => ({
          price: t.price,
          cadence: t.cadence,
          net: t.net,
          held: t.held,
          action: t.action,
        }))}
        posts={appPosts}
        followSlot={subscribeSlot}
        tipSlot={tipSlot}
        tipNote={tipNote}
        figuresNote={noVaultNote}
        depositSlot={depositSlot}
        {...(onChainStakeVault === undefined ? {} : { stakeVaultId: onChainStakeVault })}
        accountName={ownerName ?? shortId(profile.owner)}
        depositLine={
          rebateBps !== null && rebateBps > 0
            ? `Your SUI stays yours and comes back whenever you ask. It earns while it sits there, and ${(rebateBps / 100).toFixed(2).replace(/\.?0+$/, '')}% of what it earns comes back to the people pooled behind this account. The vault belongs to that account rather than to this page, so it backs every page they publish.`
            : 'Your SUI stays yours and comes back whenever you ask. It earns while it sits there and the earnings go to the account behind this page. The vault belongs to that account rather than to this page, so it backs every page they publish.'
        }
        tab={tab}
        tabHref={{ posts: tabHref('posts'), membership: tabHref('membership') }}
        viewerAddress={viewer}
        viewerHandle={ownerName}
        {...(reader === undefined ? {} : { reader })}
        emptyMessage={
          profilePosts.length === 0
            ? `${profile.displayName} has not published anything yet.`
            : 'No posts on this tab.'
        }
      />
    </>
  );
}
