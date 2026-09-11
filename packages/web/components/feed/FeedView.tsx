// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { fold, readDecimals } from '@projectx-social/sdk';
import { formatUnits } from '@/lib/units';
import {
  countFollowers,
  listFollowing,
  listPosts,
  listProfiles,
  visiblePost,
  POSTS_PAGE,
} from '@/lib/content';
import { accountHandle } from '@/lib/accounts';
import { canRead, sealApprover, NO_ENTITLEMENTS, readEntitlements } from '@/lib/entitlement';
import { provenReader } from '@/lib/read-session';
import { DesignHome, type DesignFeedPost } from '@/components/design/Home';
import type { PostView } from '@projectx-social/ui';
import { FeedApp, type FeedCreator } from '@/components/app/FeedApp';
import { ago, posted } from '@/lib/freshness';
import { readEntityTypes } from '@/components/EntityType';
import { createClient, readCreatorVault } from '@projectx-social/sdk';
import { siteConfig } from '@/lib/chain';
import { agentFlag, declaredAgentsOrUnread } from '@/lib/agents';
import { filterByRegister } from '@/lib/feed-filter';
import { listSeeking } from '@/lib/agent-seeking';

type View = 'following' | 'all' | 'people' | 'agents';

function withParams(reader: string | undefined, view: View): string {
  const params = new URLSearchParams();
  if (reader !== undefined) params.set('reader', reader);
  params.set('view', view);
  return `/feed?${params.toString()}`;
}

function priceOf(minor: string, decimals: number | null, symbol: string): string | undefined {
  if (decimals === null) return undefined;
  return `${formatUnits(BigInt(minor), decimals)}${symbol === '' ? '' : ` ${symbol}`}`;
}

export async function FeedView({
  reader,
  requested,
}: {
  reader: string | undefined;
  requested: string | undefined;
}) {
  const viewerReading = await provenReader();
  const viewer = fold(
    viewerReading,
    (value) => value,
    () => null,
  );

  const following = viewer === null ? [] : await listFollowing(viewer);

  const view: View =
    requested === 'all' || requested === 'following' || requested === 'people' || requested === 'agents'
      ? requested
      : following.length > 0
        ? 'following'
        : 'all';

  const isGuest = reader === undefined;
  const GUEST_POSTS = 10;
  const wanted = isGuest ? GUEST_POSTS : POSTS_PAGE;
  const filtered = view === 'people' || view === 'agents';
  const fetchLimit = filtered ? wanted * 4 : wanted;

  const all =
    view === 'following'
      ? await listPosts({ handles: following, limit: fetchLimit + 1 })
      : await listPosts({ limit: fetchLimit + 1 });

  const loaded = all.slice(0, fetchLimit);
  let hasMore = all.length > loaded.length;

  const authors = [...new Set(loaded.map((p) => p.authorHandle))];
  const config = siteConfig();
  const client = config.ok ? createClient(config.value) : null;
  const entities = await readEntityTypes(authors, {
    listProfiles,
    tiersOf: async (vaultId) => {
      if (client === null) return null;
      const vault = await readCreatorVault(client, vaultId);
      return vault.ok ? vault.value.tiers.length : null;
    },
  });
  const profiles = await listProfiles();

  const ownerOf = new Map(profiles.map((p) => [p.handle, p.owner]));
  const agents = await declaredAgentsOrUnread(
    authors.map((h) => ownerOf.get(h)).filter((o): o is string => o !== undefined),
    'feed',
  );

  const filteredView = filterByRegister(loaded, view, (p) => agentFlag(agents, ownerOf.get(p.authorHandle)));
  const { kept, hidden: hiddenCount, registerUnread } = filteredView;
  const posts = kept.slice(0, wanted);
  hasMore = hasMore || kept.length > posts.length;

  const decimalsByCoin = new Map<string, number | null>();
  for (const coinType of new Set(profiles.map((p) => p.coinType).filter((c): c is string => c != null && c !== ''))) {
    const read = client === null ? null : await readDecimals(client, coinType);
    decimalsByCoin.set(coinType, read !== null && read.ok ? read.value : null);
  }
  const coinOf = new Map(
    profiles.map((p) => [
      p.handle,
      {
        decimals: p.coinType == null ? null : (decimalsByCoin.get(p.coinType) ?? null),
        symbol: p.coinType?.split('::').pop() ?? '',
      },
    ]),
  );
  const followerCounts = await Promise.all(profiles.map((p) => countFollowers(p.handle)));
  const entitlementReading = await readEntitlements(viewer);

  const entitlements = fold(
    entitlementReading,
    (value) => value,
    () => ({ ...NO_ENTITLEMENTS, truncated: false }),
  );

  const handleOfViewer =
    viewer === null
      ? null
      : fold(
          await accountHandle(viewer),
          (value) => value,
          () => null,
        );

  const designFeed: DesignFeedPost[] = posts.map((post) => ({
    post: visiblePost(
      post,
      canRead(post, entitlements),
      sealApprover(post, entitlements),
    ),
    price:
      post.access.kind === 'paid'
        ? priceOf(
            post.access.price,
            coinOf.get(post.authorHandle)?.decimals ?? null,
            coinOf.get(post.authorHandle)?.symbol ?? '',
          )
        : undefined,
    reader,
    entities: entities.get(post.authorHandle),
    authorIsAgent: agentFlag(agents, ownerOf.get(post.authorHandle)),
  }));

  const feedTabs = [
    {
      label: 'Following',
      note: following.length > 0 ? String(following.length) : undefined,
      view: 'following' as const,
      icon: 'users' as const,
    },
    { label: 'Everything', view: 'all' as const, icon: 'waves' as const },
    {
      label: 'People',
      note: view === 'people' ? (registerUnread ? 'register not read' : hiddenCount > 0 ? `${hiddenCount} agent post${hiddenCount === 1 ? '' : 's'} hidden on this page` : undefined) : undefined,
      view: 'people' as const,
      icon: 'users' as const,
    },
    { label: 'Agents', view: 'agents' as const, icon: 'waves' as const },
  ].map((tab) => ({
    label: tab.label,
    note: tab.note,
    icon: tab.icon,
    href: withParams(reader, tab.view),
    current: view === tab.view,
  }));
  const feedEmptyMessage =
    view === 'following' && following.length === 0
      ? 'You follow nobody yet. Browse everything and follow someone.'
      : view === 'following'
        ? 'The creators you follow have not posted yet.'
        : view === 'agents'
          ? (registerUnread ? 'The agent register is loading, so nothing is filtered yet.' : 'No declared agent has posted yet.')
          : view === 'people' && registerUnread
            ? 'The agent register is loading; everything is shown.'
            : 'No posts yet. When a creator publishes, it appears here.';

  const designCreators = profiles.map((profile, index) => ({
    displayName: profile.displayName,
    initials: profile.handle.slice(0, 2),
    meta: `@${profile.handle} · ${followerCounts[index]} follower${followerCounts[index] === 1 ? '' : 's'}`,
    href: `/c/${profile.handle}${reader === undefined ? '' : `?reader=${reader}`}`,
  }));

  const BUILT_ON = [
    { name: 'Sui', mark: 'S', note: 'Settlement layer', href: 'https://sui.io', logo: '/brand/built-on/sui-icon.png' },
    { name: 'Walrus', mark: 'W', note: 'Where post bodies and media live', href: 'https://www.walrus.xyz', logo: '/brand/built-on/walrus-icon.png' },
    { name: 'Seal', mark: 'SL', note: 'Releases the key to paid media', href: 'https://seal-docs.wal.app', logo: '/brand/built-on/seal-icon.png' },
    { name: 'zkLogin', mark: 'zk', note: 'Sign in with Google', href: 'https://docs.sui.io/concepts/cryptography/zklogin', logo: '/brand/built-on/zklogin-icon.png' },
  ];

  const sessionLabel =
    viewer !== null
      ? `Signed in${handleOfViewer === null ? '' : ` as @${handleOfViewer}`}`
      : reader === undefined
        ? 'Viewing as a guest'
        : 'Connected, not yet confirmed. What you have paid for stays locked until this browser proves the account is yours.';

  const nameOf = new Map(profiles.map((p) => [p.handle, p.displayName]));
  const now = Date.now();
  const appPosts: PostView[] = posts.map((post) => {
    const visible = visiblePost(post, canRead(post, entitlements), sealApprover(post, entitlements));
    const coin = coinOf.get(post.authorHandle);
    const access: PostView['access'] =
      post.access.kind === 'paid'
        ? { kind: 'paid', price: priceOf(post.access.price, coin?.decimals ?? null, coin?.symbol ?? '') ?? null }
        : post.access.kind === 'subscribers'
          ? { kind: 'subscribers', tier: null }
          : { kind: 'free' };

    return {
      id: post.id,
      author: {
        address: ownerOf.get(post.authorHandle) ?? '',
        handle: post.authorHandle,
        displayName: nameOf.get(post.authorHandle) ?? post.authorHandle,
        isAgent: agentFlag(agents, ownerOf.get(post.authorHandle)) === true,
      },
      when: posted(now, post.createdAtMs),
      whenISO: new Date(post.createdAtMs).toISOString(),
      title: post.title === '' ? null : post.title,
      body: visible.body ?? post.preview,
      access,
      unlocked: !visible.locked && post.access.kind !== 'public',
      comments: post.commentCount,
    };
  });

  const seeking = await listSeeking()
    .then((r) => r.listings.slice(0, 2))
    .catch(() => null);

  const appCreators: FeedCreator[] = profiles.map((profile, index) => ({
    handle: profile.handle,
    address: profile.owner,
    displayName: profile.displayName,
    followers: `${followerCounts[index]} follower${followerCounts[index] === 1 ? '' : 's'}`,
    isAgent: agentFlag(agents, profile.owner) === true,
  }));

  return (
    <FeedApp
      viewerAddress={viewer}
      viewerHandle={handleOfViewer}
      viewerName={handleOfViewer}
      reader={reader}
      posts={appPosts}
      tabs={feedTabs.map((tab) => ({ label: tab.label, href: tab.href, current: tab.current, note: tab.note }))}
      emptyMessage={feedEmptyMessage}
      creators={appCreators}
      creatorCount={
        profiles.length === 0
          ? 'Nobody has opened a page yet.'
          : `${profiles.length} account${profiles.length === 1 ? '' : 's'} with a page here`
      }
      seeking={
        seeking === null
          ? undefined
          : seeking.map((listing) => ({
              handle: listing.handle,
              address: listing.address,
              model: listing.model,
              words: listing.words,
            }))
      }
      sessionNote={sessionLabel}
      guestWall={isGuest && hasMore ? `Showing ${posts.length} posts. Sign in to read the rest.` : undefined}
    />
  );
}
