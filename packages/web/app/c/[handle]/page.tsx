// Built-by: @projectx.sui · Co-authored-by: Claude
/**
 * A creator profile.
 *
 * Tiers and vault balances are read from chain at request time — never from the content store,
 * which knows nothing about money. The store supplies only the name, the bio and the posts.
 */

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
import { DesignCreator, type CreatorTab, type DesignStat, type DesignTier } from '@/components/design/Creator';
import type { DesignFeedPost } from '@/components/design/Home';
import { TipButton } from '@/components/TipButton';
import { DepositCheckout } from '@/components/DepositCheckout';

export const dynamic = 'force-dynamic';

/**
 * One store lookup per request, shared between the title and the page. `generateMetadata` and the
 * page run separately and Next deduplicates `fetch`, not arbitrary calls; without `cache` the same
 * row would be read twice.
 */
const profileFor = cache(findProfile);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ handle: string }>;
}): Promise<Metadata> {
  const { handle } = await params;
  const stored = await profileFor(handle);
  /*
    The trail's label, `@handle`, is the title when the store knows no other name — the handle is
    the only name the account has chosen. A chosen display name goes in front of it, and the bio
    becomes the description because it is the one line the creator wrote about themselves.
  */
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
  /* Posts by default. An unknown value is the default rather than an error: a mistyped tab is not a
     reason to show somebody nothing. */
  const tab: CreatorTab = requestedTab === 'membership' ? 'membership' : 'posts';
  const tabHref = (t: CreatorTab) => {
    const q = new URLSearchParams();
    if (t !== 'posts') q.set('tab', t);
    if (reader !== undefined) q.set('reader', reader);
    const qs = q.toString();
    return `/c/${encodeURIComponent(handle)}${qs === '' ? '' : `?${qs}`}`;
  };

  /*
    Postgres first, then the chain.

    The registry is the authority on who holds a handle. If it says the handle is taken, the account
    exists and deserves a page, whatever the content store has recorded. What Postgres adds is
    presentation — a display name, a bio, a vault — and those are absent rather than fabricated.
  */
  const stored = await profileFor(handle);
  const claimed = stored === null ? await checkHandle(handle) : null;
  const onChainOwner =
    claimed !== null && claimed.ok && claimed.value.state === 'taken' ? claimed.value.owner : null;

  if (stored === null && onChainOwner === null) notFound();

  const profile: Profile =
    stored ??
    ({
      handle,
      // The handle, because it is the only name this account has chosen. Not a blank heading.
      displayName: handle,
      owner: onChainOwner as string,
      bio: '',
      vaultId: null,
      coinType: null,
    } satisfies Profile);

  /*
    A creator's own page, bounded like everything else that reads posts.

    Stated explicitly rather than left to the default, because this page has a different shape from
    the feed: it is one creator's archive, and the number that is right for it is a property of this
    page. `posts_author_created_idx` serves the filter and the ordering together, so the limit is
    reached by seeking rather than by reading the archive and discarding it.

    A creator past this many posts loses the tail here rather than the site losing a connection to
    render it — the honest trade until this page carries the cursor `listPosts` already accepts.
  */
  const posts = await listPosts({ handle, limit: POSTS_PAGE });
  const followers = await countFollowers(handle);
  const following = await isFollowing(reader ?? null, handle);
  /*
    Whose entitlements to read — proved, not named. See the note on the feed page: `reader` is a
    query parameter and decides only what this page *shows*, while `viewer` is the address that
    proved control of itself and is the only thing entitlement is resolved for.
  */
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

  /*
    A page without a vault is a real state now.

    `vaultId` became nullable when opening an account stopped implying becoming a creator. There is
    nothing to read for such a page, and passing `null` into a chain read would either throw or ask
    the node for an object id that cannot exist.

    `null` here means "no vault to read", which the render below distinguishes from a vault that
    could not be read — the second is a failure and must not be shown as an absence.
  */
  const config = siteConfig();
  const vault =
    profile.vaultId === null
      ? null
      : config.ok
        ? await readCreatorVault(createClient(config.value), profile.vaultId)
        : config;

  /*
    The coin's decimals, for pricing the join button.

    Read from `CoinMetadata` rather than assumed. Six is right for USDC and wrong for SUI by a
    factor of a thousand, and a subscription priced against the wrong scale is a real charge at the
    wrong amount. `null` when it cannot be read, and the button is withheld rather than shown
    against a guessed scale.
  */
  const decimals =
    config.ok && profile.coinType !== null
      ? await readDecimals(createClient(config.value), profile.coinType)
      : null;
  const coinDecimals = decimals !== null && decimals.ok ? decimals.value : null;
  const coinSymbol = profile.coinType?.split('::').pop() ?? '';

  /*
    Amounts formatted against this vault's own scale.

    This page divided every figure by 1e6 while holding `coinDecimals` two lines above, unused —
    tier prices, gross volume and the creator's earnings all rendered against a guess. A
    nine-decimal coin showed a thousand times too much, on the page where somebody decides what to
    pay. `null` prints nothing rather than a plausible wrong number.
  */
  const money = (minor: bigint): string =>
    coinDecimals === null
      ? 'scale unknown'
      : `${formatUnits(minor, coinDecimals)}${coinSymbol === '' ? '' : ` ${coinSymbol}`}`;

  /*
    The owner's `.sui` name, when they have set one. Shown beside the address rather than instead of
    it: the name is a label its holder chose, and the address is the thing an explorer can be asked
    about. A failed lookup leaves the address standing alone, which is the honest fallback.
  */
  const ownerNameReading = await reverseName(profile.owner);
  const ownerName = ownerNameReading.ok ? ownerNameReading.value : null;

  /*
    The support vault, from chain when the store has not recorded one.

    `profiles.stake_vault_id` is written by nothing — opening a stake vault creates a real object
    that Postgres never learns about, so a creator who opened one saw no sign of it on their own
    page. `StakeVaultOpened` names the creator, which is the same authority the rest of this page
    now uses for existence.

    A failed walk leaves it absent rather than claiming the creator has none: those are different
    facts, and only one of them should hide a creator's vault from the people who would fund it.
  */
  /*
    All of them, because the contract allows all of them.

    `stake_vault::open` checks two things — a soulbound account authenticating the sender, and that
    creation is unpaused. There is no uniqueness check, so a creator may open as many vaults as they
    like, and several already have. This page showed the first one found and silently dropped the
    rest: a depositor could be funding a vault the creator had moved on from, with no way to see the
    others existed.

    The store's single `stake_vault_id` column cannot express this and is not consulted for the
    list. It survives only as a hint about *which* vault a creator considers primary, and even that
    is never written today — the chain is the whole answer here.
  */
  const onChainStakeVaults = await (async () => {
    const walked = await readVaults();
    // A failed walk is not "this creator has none". Absent, so the section renders nothing rather
    // than telling a reader a creator has no vault when we simply could not look.
    if (!walked.ok) return undefined;
    return walked.value.vaults.filter(
      (v) => v.creator.toLowerCase() === profile.owner.toLowerCase(),
    );
  })();
  const onChainStakeVault = onChainStakeVaults?.[0]?.vaultId;

  /*
    The share this creator returns to the people pooled behind them.

    One object read, and only when there is a vault to read. `null` covers both "no vault" and "the
    read failed", and the line below renders nothing in either case — a page claiming a creator
    shares nothing because a node was slow would be worse than a page that stays quiet.
  */
  /*
    What this creator promises the people who tip them, and where the viewer stands.

    The standing is a lifetime total read from `PaymentSettled`, and the walk is bounded — so a
    supporter who *reaches* a threshold has genuinely paid it, while one who does not may simply
    have tipped outside the window. `partial` carries that distinction to the page, which says
    "we could not see all of your tips" rather than "you do not qualify".
  */
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

  /*
    The two controls that move money keep this codebase's components. `SubscribeButton` carries quote
    simulation, blocker states and signature handling; re-deriving that from a picture, against a
    contract holding real balances, is the failure this project's audit exists to prevent. The design
    supplies where they sit and what surrounds them.
  */
  const DIM = 'var(--dim,#a3bcb8)';
  const INK = 'var(--ink,#dce9e6)';
  const ALERT = 'var(--alert,#f2a29b)';
  const CREST = 'var(--crest,#8be3c6)';

  const v = vault !== null && vault.ok ? vault.value : null;
  const activeTiers = v === null ? [] : v.tiers.filter((t) => t.active);

  const MONO = "'Geist Mono',monospace";
  const BODY = "'Geist',sans-serif";

  /** A figure that was read. */
  const measured = (label: string, value: string, note: string): DesignStat => ({
    label, value, note, font: MONO, size: '1.5rem', style: 'normal', color: INK,
  });
  /** A figure that was not. Deliberately not shaped like a number. */
  const unread = (label: string, why: string): DesignStat => ({
    label, value: 'not measured', note: why, font: BODY, size: '1.0625rem', style: 'italic', color: ALERT,
  });

  const stats: DesignStat[] =
    v === null
      ? [
          unread('Settled volume', 'this page has no vault, so nothing has settled'),
          unread('Subscriptions', 'no vault'),
          unread('Unclaimed earnings', 'no vault'),
        ]
      : coinDecimals === null
        ? [
            unread('Settled volume', "the coin's decimals could not be read, so no figure is priced"),
            measured('Subscriptions', v.subscriptionsSold.toString(), 'sold to date, from the vault'),
            unread('Unclaimed earnings', "the coin's decimals could not be read"),
          ]
        : [
            measured('Settled volume', money(v.grossVolume), 'gross, settled on chain'),
            measured('Subscriptions', v.subscriptionsSold.toString(), 'sold to date, from the vault'),
            measured('Unclaimed earnings', money(v.earnings), 'held by the contract, not by us'),
          ];

  /*
    What the creator keeps, in the contract's own integer arithmetic and rounded down. The rate is
    this vault's own `feeBpsSnapshot`, fixed when it was opened — not a global constant, because two
    vaults can legitimately carry different rates.
  */
  /*
    Does the reader already hold this creator's subscription?

    `subscribedVaults` is keyed by vault, not by tier — the contract issues one Subscription per
    vault — so a held subscription marks every tier as held. The card then confirms rather than
    selling again, which is the difference between an interface that knows what you own and one that
    keeps asking.
  */
  const holdsSubscription = profile.vaultId !== null && entitlements.subscribedVaults.has(profile.vaultId);

  const tiers: DesignTier[] = activeTiers.map((t) => {
    const days = Number(t.periodMs / 86_400_000n);
    const net =
      v === null || coinDecimals === null
        ? 'not measured'
        : money((t.price * (10_000n - v.feeBpsSnapshot)) / 10_000n);
    return {
      price: coinDecimals === null ? 'not measured' : money(t.price),
      cadence: `${t.name} · every ${days} day${days === 1 ? '' : 's'}`,
      net: coinDecimals === null
        ? "the coin's decimals could not be read, so this is not priced"
        : `Creator keeps ${net}`,
      held: holdsSubscription,
      /*
        The purchase control, in the card with its own price.

        Four states, and each says something different: you already hold this; sign in to buy it; we
        could not price it so it is not for sale; or here is the button. Only the last one takes
        money, and none of the others pretends to.
      */
      action: holdsSubscription ? (
        <p style={{ margin: 0, color: CREST, fontSize: '0.9375rem', fontWeight: 600 }}>
          You hold this membership. Subscriber posts are open to you.
        </p>
      ) : coinDecimals === null || profile.vaultId === null || profile.coinType === null ? (
        <p style={{ margin: 0, color: ALERT, fontSize: '0.9375rem' }}>
          Not for sale right now: the coin&rsquo;s scale could not be read, so no price can be shown.
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

  // One register read per page. It feeds both the identity line and the pill on every post, so
  // the two cannot disagree, and the register is asked once however many posts there are.
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

  /*
    The subscribe control, one per active tier.

    The design draws a single call to action; this product sells several tiers, and showing only one
    would remove options a creator deliberately created. Each is withheld — rather than priced
    against a guess — when the coin's scale could not be read.
  */
  /*
    The subscribe control.
  */
  /*
    The identity row's action is *follow*, not subscribe.

    Subscribe moved into the tier cards, beside the prices it buys. What belongs at the top is the
    free commitment: following costs nothing, states a relationship, and is the step most people take
    before they ever pay. Putting the paid control here and the prices 600px below it asked for the
    purchase before showing the price, and gave no way to say which tier was meant.

    `FollowButton` carries its own optimistic state and count, so the reader sees the relationship
    change rather than guessing whether the click registered.
  */
  const subscribeSlot =
    viewer === null ? (
      <a className="btn ghost" href={`/signin?next=${encodeURIComponent(`/c/${profile.handle}`)}`}>
        Sign in to follow
      </a>
    ) : (
      <FollowButton handle={profile.handle} initialFollowing={following} initialCount={followers} />
    );

  /*
    The pool card holds one action, and it is the deposit.

    It first rendered the object and a link to an explorer with no way to pool anything — the one
    action the whole "support without spending" argument exists to enable. Fixing that put
    `DepositCheckout` here, and put `TipButton` here beside it, which was wrong in a way worth
    naming: they are not two flavours of the same thing.

    A deposit is SUI, into the *stake* vault, and comes back in full whenever the depositor asks. A
    tip is the creator's own coin, into the *creator* vault, and never comes back. They shared one
    panel, under one heading, above one note reading "withdrawable in full, any time" — a sentence
    true of one control and false of the other, with nothing on screen saying which it meant.
  */
  const depositSlot =
    viewer === null ? (
      <a className="btn" href={`/signin?next=${encodeURIComponent(`/c/${profile.handle}`)}`}>
        Sign in to pool SUI
      </a>
    ) : onChainStakeVault === undefined ? (
      <p style={{ margin: 0, color: DIM, fontSize: '0.9375rem' }}>
        This account has not opened a pool yet, so there is nowhere to deposit.
      </p>
    ) : (
      <DepositCheckout vaultId={onChainStakeVault} />
    );

  /*
    The tip, in the callout that describes it.

    Withheld rather than priced against a guess when the coin's scale could not be read — the same
    rule the tier cards follow, and for the same reason: an amount typed against the wrong number of
    decimals is a real payment at the wrong size.
  */
  const tipSlot =
    profile.vaultId === null ? (
      <p style={{ margin: 0, color: DIM, fontSize: '0.9375rem' }}>
        This account has no creator vault yet, so there is nowhere for a tip to settle.
      </p>
    ) : coinDecimals === null ? (
      <p style={{ margin: 0, color: ALERT, fontSize: '0.9375rem' }}>
        Not offered right now: the coin&rsquo;s scale could not be read, so an amount cannot be priced.
      </p>
    ) : viewer === null ? (
      <a className="btn ghost" href={`/signin?next=${encodeURIComponent(`/c/${profile.handle}`)}`}>
        Sign in to tip
      </a>
    ) : (
      <TipButton vaultId={profile.vaultId} decimals={coinDecimals} symbol={coinSymbol} />
    );

  return (
    <DesignCreator
      tab={tab}
      tabHref={{ posts: tabHref('posts'), membership: tabHref('membership') }}
      signedIn={viewer !== null}
      myHandle={ownerName}
      profile={{
        handle: profile.handle,
        displayName: profile.displayName,
        bio: profile.bio,
        initials: profile.handle.slice(0, 2),
        meta: `@${profile.handle} · ${followers} follower${followers === 1 ? '' : 's'}${following ? ' · following' : ''}`,
        sui: ownerName ?? shortId(profile.owner),
        agent: agentIdentity,
      }}
      tiers={tiers}
      stats={stats}
      profilePosts={profilePosts}
      viewingLabel={
        profilePosts.length === 0
          ? 'No posts yet.'
          : viewer === null
            ? 'Paid posts stay locked until you sign in.'
            : 'Paid posts open against what your address holds.'
      }
      tiersHref={v === null || profile.vaultId === null ? undefined : explorerUrl(profile.vaultId)}
      tiersLabel={v === null ? 'No vault' : 'View the vault on chain'}
      subscribeSlot={subscribeSlot}
      depositSlot={depositSlot}
      tipSlot={tipSlot}
      depositLine="The vault belongs to that account rather than to this page, so it backs every page they publish. No function in the contract lets anyone but you move your deposit."
      depositNote=""
      vaultHref={onChainStakeVault === undefined ? undefined : `/vault/${onChainStakeVault}`}
      perks={perks.map((perk) => ({
        title: perk.title,
        detail: perk.detail,
        threshold: money(perk.thresholdUnits),
        /*
          Three states, and the third is the point. `true` is earned, `false` is a complete tally
          that fell short, `undefined` is "we cannot say" — a guest, a failed read, or a tally the
          ceiling cut short. Collapsing the third into `false` would tell somebody they had not paid
          when they may have.
        */
        met:
          standing === null || !standing.ok
            ? undefined
            : standing.value.given >= perk.thresholdUnits
              ? true
              : standing.value.partial
                ? undefined
                : false,
      }))}
      perksGiven={
        standing === null || !standing.ok || standing.value.given === 0n
          ? undefined
          : money(standing.value.given)
      }
      perksPartial={standing !== null && standing.ok && standing.value.partial}
      supportersFirst={supportersFirst}
      {...(rebateBps !== null && rebateBps > 0
        ? {
            depositShare: `This creator returns ${(rebateBps / 100).toFixed(2).replace(/\.?0+$/, '')}% of their own yield to the people pooled behind them. Your part accrues in proportion to what you deposited, and you claim it yourself.`,
          }
        : {})}
    />
  );
}
