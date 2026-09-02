// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
/**
 * The feed.
 *
 * Posts come from the content store; whether their bodies are released comes from chain objects
 * the reader holds. Those two never mix — see `lib/entitlement.ts`.
 *
 * The reader is identified by a `?reader=0x…` query parameter. That is deliberately not a login:
 * nothing is granted by claiming an address, because entitlement is decided by objects that
 * address owns, which cannot be forged by naming it. A wrong address simply sees less.
 */

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
import { readEntityTypes } from '@/components/EntityType';
import { createClient, readCreatorVault } from '@projectx-social/sdk';
import { siteConfig } from '@/lib/chain';
import { agentFlag, declaredAgentsOrUnread } from '@/lib/agents';
import { filterByRegister } from '@/lib/feed-filter';


/**
 * `people` hides declared agents and counts them on the tab; `agents` shows only declared agents.
 * Default stays `all` with the mark — the register proves a declaration was made, never that one
 * was not, so hiding is a reader's choice and never the default (spec D-3, the desk's reading).
 */
type View = 'following' | 'all' | 'people' | 'agents';

function withParams(reader: string | undefined, view: View): string {
  const params = new URLSearchParams();
  if (reader !== undefined) params.set('reader', reader);
  params.set('view', view);
  return `/feed?${params.toString()}`;
}

/*
  A post's price, against the scale of the coin its creator's vault actually holds.

  This divided by 1e6 for every post regardless of denomination and appended "USDC" to all of them,
  so a post priced in a nine-decimal coin advertised a thousand times its real cost under the wrong
  name. An unread scale shows nothing rather than a confident wrong figure.
*/
function priceOf(minor: string, decimals: number | null, symbol: string): string | undefined {
  if (decimals === null) return undefined;
  return `${formatUnits(BigInt(minor), decimals)}${symbol === '' ? '' : ` ${symbol}`}`;
}

/**
 * The feed, as a component.
 */
export async function FeedView({
  reader,
  requested,
}: {
  reader: string | undefined;
  requested: string | undefined;
}) {

  /*
    Which of the two things this route is.

    `/` is the front door and the feed, and until now it was only the feed: a visitor who had never
    heard of Weir got a list of posts inside an application shell, with the argument for the product
    reduced to a paragraph above it. That is a page for somebody who already stayed.

    The test is deliberately generous in the *guest* direction. `viewer` is a proved session;
    `reader` is the address the frame threads through links, which is set the moment a wallet
    connects. Either one means "this person is here to use the product", so the feed wins. Only
    somebody with neither sees the landing.

    It therefore also fails in the safe direction: if the session read fails, `viewer` is null, and a
    visitor with no `?reader=` gets marketing rather than a feed. Marketing leaks nothing.
  */
  const viewerReading = await provenReader();
  const viewer = fold(
    viewerReading,
    (value) => value,
    () => null,
  );


  const following = reader === undefined ? [] : await listFollowing(reader);

  /*
    Which feed to show when nothing was asked for.

    A reader who follows nobody gets discovery, because a following feed with no follows is an
    empty page that reads as broken. Once they follow someone, following is the default — and an
    empty following feed after that is a real state, not a reason to widen the filter. Silently
    falling back to everything is how a following feed stops filtering and nobody notices.
  */
  const view: View =
    requested === 'all' || requested === 'following' || requested === 'people' || requested === 'agents'
      ? requested
      : following.length > 0
        ? 'following'
        : 'all';

  /*
    Bounded at the database, not in JavaScript.

    A guest is shown ten posts. This used to fetch EVERY post in the table — every body, every asset
    row — and slice ten off the front, so the cost of showing a stranger ten posts grew with the
    whole archive. One extra row is asked for beyond what will be shown, which is all that is needed
    to say truthfully whether there is more without counting what there is.
  */
  const isGuest = reader === undefined;
  const GUEST_POSTS = 10;
  const wanted = isGuest ? GUEST_POSTS : POSTS_PAGE;
  /*
    A filtered view reads a bounded multiple of the page rather than the whole table: the register
    is consulted after the read, so rows that will be hidden cannot be excluded in SQL without
    joining the register into every feed query. Four pages is the ceiling; a view that would need
    more says "more" rather than reading on.
  */
  const filtered = view === 'people' || view === 'agents';
  const fetchLimit = filtered ? wanted * 4 : wanted;

  const all =
    view === 'following'
      ? await listPosts({ handles: following, limit: fetchLimit + 1 })
      : await listPosts({ limit: fetchLimit + 1 });

  /*
    What a visitor sees before signing in.

    The feed was public and unlimited, so there was no reason to ever sign in and no way to show
    somebody the product without an account. A guest now gets a real sample — actual posts, not a
    blurred mock — and is told plainly where the wall is and why.

    `reader` is the whole test. It is not authentication and does not pretend to be: entitlement is
    decided by objects an address owns, so a guest is simply somebody who has not said who they are.
    Locked bodies stay locked either way. This caps how much of the *public* feed is shown, nothing
    more.
  */
  const loaded = all.slice(0, fetchLimit);
  /*
    Whether more exists, not how much. The extra row asked for above answers that exactly; an exact
    total would need a second query counting rows nobody is going to read, which is the cost this
    change exists to remove.
  */
  let hasMore = all.length > loaded.length;


  /*
   * Entity markers for the authors on this page.
   *
   * `tiersOf` returns `null` when the vault could not be read, which entitiesOf treats as "no
   * tiers" rather than as a membership — a marker inviting a reader to buy from a vault nobody
   * could read is worse than no marker.
   */
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

  /*
    Who on this page is a declared agent — one register query for every author, keyed by the owner
    each handle's profile names. A handle with no profile row is not looked up and gets no marker;
    a register that could not be read marks nobody and says so in the log, because "we could not
    look" must never render as "not an agent".
  */
  const ownerOf = new Map(profiles.map((p) => [p.handle, p.owner]));
  const agents = await declaredAgentsOrUnread(
    authors.map((h) => ownerOf.get(h)).filter((o): o is string => o !== undefined),
    'feed',
  );

  /*
    The filter, applied only once the register has answered. When it could not be read, nothing is
    hidden and the tab says so: "we could not look" must never render as "there are no agents".
  */
  const filteredView = filterByRegister(loaded, view, (p) => agentFlag(agents, ownerOf.get(p.authorHandle)));
  const { kept, hidden: hiddenCount, registerUnread } = filteredView;
  const posts = kept.slice(0, wanted);
  hasMore = hasMore || kept.length > posts.length;

  /*
    Decimals once per distinct coin, not once per post. Creators on a deployment usually share a
    denomination, so this is normally a single metadata read for the whole feed.
  */
  const decimalsByCoin = new Map<string, number | null>();
  for (const coinType of new Set(profiles.map((p) => p.coinType).filter((c): c is string => c != null && c !== ''))) {
    const read = client === null ? null : await readDecimals(client, coinType);
    decimalsByCoin.set(coinType, read !== null && read.ok ? read.value : null);
  }
  /** Handle to the scale and symbol its prices should be shown in. */
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
  /*
    Whose entitlements to read — proved, not named.

    `reader` is a query parameter. It still decides what the frame *shows* (which links carry the
    account onward, whose name is in "Viewing as"), and it no longer decides what anybody may
    *read*: this resolved entitlements for whatever address the URL contained, so naming a buyer —
    trivially enumerable from public chain events — returned their paid bodies and their asset ids.

    `viewer` is the address that proved control of itself, and it is the only thing entitlement is
    resolved for. The two are usually the same person; when they differ, the page locks.
  */
  const entitlementReading = await readEntitlements(viewer);


  // A failed read locks everything. Never fail open — a node timeout must not release paid content.
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
      note: view === 'people' ? (registerUnread ? 'register unread' : hiddenCount > 0 ? `${hiddenCount} agent post${hiddenCount === 1 ? '' : 's'} hidden on this page` : undefined) : undefined,
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
  /*
    Why the feed is empty, said exactly. "You follow nobody" and "the people you follow have not
    posted" are different facts, and only one of them is fixed by following somebody.
  */
  const feedEmptyMessage =
    view === 'following' && following.length === 0
      ? 'You follow nobody yet. Browse everything and follow someone.'
      : view === 'following'
        ? 'The creators you follow have not posted yet.'
        : view === 'agents'
          ? (registerUnread ? 'The agent register could not be read just now, so nothing can be filtered.' : 'No declared agent has posted yet.')
          : view === 'people' && registerUnread
            ? 'The agent register could not be read just now; everything is shown, nothing hidden.'
            : 'No posts yet. When a creator publishes, it appears here.';

  const designCreators = profiles.map((profile, index) => ({
    displayName: profile.displayName,
    initials: profile.handle.slice(0, 2),
    meta: `@${profile.handle} · ${followerCounts[index]} follower${followerCounts[index] === 1 ? '' : 's'}`,
    href: `/c/${profile.handle}${reader === undefined ? '' : `?reader=${reader}`}`,
  }));

  // The icons are the partners' own marks, supplied by the owner and served from public/brand.
  // `test/built-on-logos.test.ts` asserts every path here is a file on disk.
  const BUILT_ON = [
    { name: 'Sui', mark: 'S', note: 'Settlement layer', href: 'https://sui.io', logo: '/brand/built-on/sui-icon.png' },
    { name: 'Walrus', mark: 'W', note: 'Where post bodies and media live', href: 'https://www.walrus.xyz', logo: '/brand/built-on/walrus-icon.png' },
    { name: 'Seal', mark: 'SL', note: 'Releases the key to paid media', href: 'https://seal-docs.wal.app', logo: '/brand/built-on/seal-icon.png' },
    { name: 'zkLogin', mark: 'zk', note: 'Sign in with Google', href: 'https://docs.sui.io/concepts/cryptography/zklogin', logo: '/brand/built-on/zklogin-icon.png' },
  ];

  /*
    What the frame says about who is reading. `viewer` is proved; `reader` is only claimed, so when
    they disagree the label says the session is unconfirmed rather than naming an address we have not
    verified.
  */
  const sessionLabel =
    viewer !== null
      ? `Signed in${handleOfViewer === null ? '' : ` as @${handleOfViewer}`}`
      : reader === undefined
        ? 'Viewing as a guest'
        : 'Connected, but not confirmed — anything you have paid for stays locked until this browser proves the account is yours.';

  return (
    <DesignHome
      signedIn={viewer !== null}
      myHandle={handleOfViewer}
      feed={designFeed}
      feedTabs={feedTabs}
      feedEmptyMessage={feedEmptyMessage}
      creators={designCreators}
      creatorCount={
        profiles.length === 0
          ? 'No creators yet.'
          : `${profiles.length} creator${profiles.length === 1 ? '' : 's'} with a vault on chain`
      }
      sessionLabel={sessionLabel}
      guestWall={
        isGuest && hasMore
          ? `Showing ${posts.length} posts. Sign in to read the rest.`
          : undefined
      }
      builtOn={BUILT_ON}
    />
  );
}
