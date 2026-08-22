// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
/**
 * How long stored media actually lives — in one place both the server and the browser may read.
 *
 * # Why this module exists at all
 *
 * `publisher-token.ts` is `server-only`, so the composer could not import the lease it was
 * describing and described it from memory instead. It got it backwards: the creator was told a
 * public image was stored "permanently", when public is the **one-epoch** tier — a fortnight — and
 * the encrypted paid tier is the one that lasts two years.
 *
 * Deliberately **not** `server-only`. That is the entire point: a number the interface quotes and a
 * number the code spends must be the same number, and the only way to guarantee that is to let both
 * sides import it.
 *
 * # The lease is a product decision, not an accident
 *
 * Free posts expire. That is chosen, and it is *not* chosen for cost: a store costs
 * `encoded_MiB × (0.0001 × epochs + 0.0002)`, so one epoch measured at 0.018 WAL against 0.347 for
 * fifty-three — 19× the price for 53× the life. Renewing short leases repeatedly is more expensive
 * than buying one long one. `ephemeral` exists because content that expires is a product decision;
 * anybody reaching for it to save money has the economics backwards.
 *
 * What follows from choosing it is that the interface has to say so, plainly, before somebody
 * publishes — which is what `test/storage-retention.test.ts` enforces.
 */

/**
 * A mainnet Walrus epoch, in days.
 *
 * Measured rather than assumed: `walrus info` reports `Epoch duration: 14days`, and
 * `walrus info --json` gives it exactly as `epochDuration: { secs: 1209600 }` — 1,209,600 seconds
 * is fourteen days.
 *
 * Note what this is *not*: a schedule. It converts a number of epochs into a human duration for a
 * sentence like "kept for 14 days". Deciding whether one particular blob has already expired is a
 * different question with a different answer — it needs the current epoch, which is on chain, and
 * must be read rather than computed from an anchor date held here.
 */
export const EPOCH_DAYS = 14;

export type StorageTier = 'ephemeral' | 'durable';

/**
 * The lease bought per tier, in epochs.
 *
 * `durable` is Walrus's own ceiling on a single purchase — 53 epochs, a little over two years.
 * `test/storage-retention.test.ts` asserts it still equals `MAX_EPOCHS`, so raising the protocol's
 * cap without revisiting this fails rather than silently leaving the extra life unbought.
 */
export const TIER_EPOCHS: Readonly<Record<StorageTier, number>> = {
  ephemeral: 1,
  durable: 53,
};

/** The lease as a number of days, which is the only form a person can act on. */
export function retentionDays(tier: StorageTier): number {
  return TIER_EPOCHS[tier] * EPOCH_DAYS;
}

/**
 * Which tier a post's media is stored under.
 *
 * Gating and duration are read from the same fact and kept separate everywhere else — `gated`
 * decides encryption, `tier` decides the lease — but the *mapping* between them belongs in one
 * place, so the composer can state the consequence of an access level without re-deriving it.
 */
export function tierForAccess(access: 'public' | 'subscribers' | 'paid'): StorageTier {
  return access === 'paid' ? 'durable' : 'ephemeral';
}
