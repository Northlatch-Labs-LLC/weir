// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
/**
 * What kind of thing you are looking at.
 *
 * # Why this exists
 *
 * A creator vault, a stake vault and a page selling nothing all rendered as a name and an avatar, so a
 * reader in the feed could not tell which was which. They are not variations of one thing — their
 * economics are opposites:
 *
 *   **Membership** takes your money and does not give it back. That is the trade.
 *   **Free support** takes a deposit that stays yours and is withdrawable in full at any time;
 *     the creator earns the staking yield, and it costs the supporter nothing.
 *   **Posts only** sells nothing at all — no tiers, no vault to support.
 *
 * Confusing the first two is the most expensive mistake a reader of this product can make, in both
 * directions: paying when they meant to park, or parking when they meant to pay. So the marker is
 * not decoration, and it says what happens to your money rather than naming an object type.
 *
 * # One shape everywhere
 *
 * The same marker in the feed, on a profile and in search. A type badge that looked different in
 * each place would have to be learned three times, which is the same as not having one.
 */

export type Entity =
  /**
   * Holds at least one creator vault.
   *
   * The tier somebody is on, not a role somebody was given: a vault is an object you own, so this
   * is read from chain and cannot disagree with it.
   */
  | 'creator'
  /** Accepts deposits that stay the depositor's. Costs nothing to support. */
  | 'free-support'
  /*
    Sells nothing. Posts, and no way to pay for anything.

    Named for what it lacks rather than what it is. It was called `profile`, which read as a claim
    about the *kind* of thing being looked at — and beside `Membership` and `Free support`, both of
    which describe commerce, it invited exactly one reading: that this entity is a person's profile
    while the others are something else. A creator page whose vault simply has no tiers yet got
    labelled as though it were a different species.
  */
  /** An account with no vault. Reads, follows, comments, subscribes — takes no money. */
  | 'user'
  /*
    The stake vault itself, as an object.

    Unlike the others this is never returned by `entitiesOf` — a creator page earns its markers from
    what it sells, and this one names what a thing *is*. It is rendered directly on `/vault/[id]`,
    where the reader is looking at the vault rather than at somebody who has one, and where the page
    otherwise showed a handle and an id with nothing saying which kind of object they belonged to.
  */
  | 'stake-vault';

const LABEL: Record<Entity, string> = {
  creator: 'Creator',
  'free-support': 'Free support',
  user: 'User',
  'stake-vault': 'Vault',
};

/** What each one does to your money, in one line, on hover. */
const MEANING: Record<Entity, string> = {
  creator:
    'Holds a creator vault — sells subscriptions and paid posts, and payment for those is final',
  'free-support': 'Deposit SUI and keep it — the creator earns the yield, you withdraw any time',
  user: 'A reader — follows, comments and subscribes, and sells nothing',
  'stake-vault':
    'A no-loss vault — your deposit stays yours and is withdrawable in full; the creator earns the yield',
};

const ICON: Record<Entity, string> = {
  // A card, for something you pay.
  creator: 'M2 6h16v10H2zM2 9h16',
  // A circular arrow, for something that comes back.
  'free-support': 'M16 10a6 6 0 1 1-2-4.5M16 4v3h-3',
  // A page with lines of text. Deliberately not a person: this marker describes what is on sale,
  // and a person icon is what made it read as "this is somebody's profile" rather than "nothing
  // here is for sale".
  user: 'M4 17v-1.5A3.5 3.5 0 0 1 7.5 12h5a3.5 3.5 0 0 1 3.5 3.5V17M10 3a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7',
  // A strongbox, for something held rather than spent.
  'stake-vault': 'M3 5h14v11H3zM3 9h14M8 12h4',
};

export function EntityType({ entity }: { entity: Entity }) {
  return (
    <span className={`entity entity--${entity}`} title={MEANING[entity]}>
      <svg
        viewBox="0 0 20 20"
        width="12"
        height="12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
        focusable="false"
      >
        <path d={ICON[entity]} />
      </svg>
      {LABEL[entity]}
    </span>
  );
}

/**
 * Which marker a profile earns, from what it actually holds on chain.
 *
 * A creator vault with no tiers sells nothing yet, so it is not a membership — showing one would
 * send a reader to a page with nothing to buy. Free support is decided by holding a stake vault,
 * which is the object that makes it possible.
 *
 * Both can be true. A creator selling memberships *and* accepting free support is the arrangement
 * this platform is for, so this returns a list rather than picking a winner.
 */
export function entitiesOf(input: {
  tiers?: number;
  stakeVaultId?: string | null;
  /**
   * Support vaults read from chain. A list, because a creator may run several.
   *
   * Both forms are accepted: one caller still has a single id to hand, while search now derives
   * every vault from `StakeVaultOpened` events. The singular form used to come from a database
   * column that has never been written, so this badge never appeared on the search page for
   * anybody — the marker was correct and its input was always null.
   */
  stakeVaultIds?: readonly string[];
}): Entity[] {
  const found: Entity[] = [];
  if ((input.tiers ?? 0) > 0) found.push('creator');
  const hasStakeVault =
    (input.stakeVaultId != null && input.stakeVaultId !== '') ||
    (input.stakeVaultIds?.length ?? 0) > 0;
  if (hasStakeVault) found.push('free-support');
  // Only when nothing else applies. A marker saying this sells nothing, beside one saying it sells
  // memberships, adds no information and takes the room the useful one needs.
  if (found.length === 0) found.push('user');
  return found;
}

/**
 * Entity markers for a set of handles, in one pass.
 *
 * The feed names a dozen authors. Deriving each one's markers separately would read the same
 * profile list a dozen times and then make a chain call per author regardless of whether it could
 * change the answer.
 *
 * Only profiles that hold a creator vault need a chain read at all, and only to learn whether the
 * vault has tiers — a vault with none sells nothing, so calling it a membership would send a reader
 * to a page with nothing on it. Everything else is decided from the profile row.
 *
 * Returns a map rather than a `Reading`: one unreadable vault must not blank the markers for the
 * rest of the page. A handle whose vault could not be read falls back to what the profile alone can
 * say, which is honest — it holds a vault, and we could not learn what is in it.
 */
export async function readEntityTypes(
  handles: readonly string[],
  deps: {
    listProfiles: (options?: { handles?: readonly string[] }) => Promise<
      ReadonlyArray<{ handle: string; vaultId: string | null; stakeVaultIds?: readonly string[] }>
    >;
    tiersOf: (vaultId: string) => Promise<number | null>;
  },
): Promise<Map<string, Entity[]>> {
  const found = new Map<string, Entity[]>();
  if (handles.length === 0) return found;

  // Narrowed in SQL. This read every creator on the platform to keep the handles on one page.
  const profiles = await deps.listProfiles({ handles });

  await Promise.all(
    profiles.map(async (profile) => {
      /*
        `null` is a page that has no vault yet — ordinary now that registering creates the page and
        opening a vault is a later, repeatable decision. It was previously spelled `''`, a sentinel
        that looked like a vault id everywhere it was not compared against exactly this literal.

        Both no-vault and an unreadable vault produce no tiers, so neither invites a reader to buy
        from something that cannot be read.
      */
      const tiers =
        profile.vaultId === null ? 0 : ((await deps.tiersOf(profile.vaultId)) ?? 0);
      found.set(
        profile.handle,
        entitiesOf({ tiers, stakeVaultIds: profile.stakeVaultIds ?? [] }),
      );
    }),
  );

  return found;
}
