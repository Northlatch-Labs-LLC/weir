// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

export type Entity =
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

const MEANING: Record<Entity, string> = {
  creator:
    'Holds a creator vault — sells subscriptions and paid posts, and payment for those is final',
  'free-support': 'Deposit SUI and keep it — the creator earns the yield, you withdraw any time',
  user: 'A reader — follows, comments and subscribes, and sells nothing',
  'stake-vault':
    'A staking vault — your deposit stays yours and is withdrawable in full; the creator earns the yield',
};

const ICON: Record<Entity, string> = {
  creator: 'M2 6h16v10H2zM2 9h16',
  'free-support': 'M16 10a6 6 0 1 1-2-4.5M16 4v3h-3',
  user: 'M4 17v-1.5A3.5 3.5 0 0 1 7.5 12h5a3.5 3.5 0 0 1 3.5 3.5V17M10 3a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7',
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

export function entitiesOf(input: {
  tiers?: number;
  stakeVaultId?: string | null;
  stakeVaultIds?: readonly string[];
}): Entity[] {
  const found: Entity[] = [];
  if ((input.tiers ?? 0) > 0) found.push('creator');
  const hasStakeVault =
    (input.stakeVaultId != null && input.stakeVaultId !== '') ||
    (input.stakeVaultIds?.length ?? 0) > 0;
  if (hasStakeVault) found.push('free-support');
  if (found.length === 0) found.push('user');
  return found;
}

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

  const profiles = await deps.listProfiles({ handles });

  await Promise.all(
    profiles.map(async (profile) => {
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
