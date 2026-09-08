// Built-by: @projectx.sui · Co-authored-by: Claude
import { createClient, fold, readDecimals, readPlatform } from '@projectx-social/sdk';
import { siteConfig } from '@/lib/chain';
import { listProfiles } from '@/lib/content';
import { readChestPots } from '@/lib/chests';
import { formatUnits } from '@/lib/units';
import { Icon } from '@/components/design/icons';
import { DesignChests, type DesignChest } from '@/components/design/Chests';

/**
 * Chests' data.
 *
 * # The pot is now read
 *
 * Three states, and they are different facts:
 *
 * - **measured** — the walk completed and this vault has tips. The figure is `gross`, formatted
 *   against that vault's own coin.
 * - **Early** — the walk completed and found none. A genuine zero, and the design has a state for
 *   it that does not look like a failure.
 * - **not measured** — the walk failed, or the ceiling truncated it, or the coin's scale could not
 *   be read. A subtotal shown as a total understates what somebody has been given, which is the one
 *   direction this page must never be wrong in.
 */

const CREST = 'var(--crest,#8be3c6)';
const SAND = 'var(--sand,#d9c9a3)';
const DIM = 'var(--dim,#a3bcb8)';
const ALERT = 'var(--alert,#f2a29b)';
const BODY = "'Geist',sans-serif";

export async function ChestsData({
  signedIn,
  myHandle,
}: {
  signedIn: boolean;
  myHandle: string | null;
}) {
  const config = siteConfig();
  const client = config.ok ? createClient(config.value) : null;
  const reading = client === null || !config.ok ? null : await readPlatform(client, config.value);
  const platform =
    reading === null
      ? null
      : fold(
          reading,
          (value) => value,
          () => null,
        );
  const feeBps = platform === null ? null : Number(platform.feeBps);
  const feeLabel = feeBps === null ? null : `${(feeBps / 100).toFixed(2).replace(/\.?0+$/, '')}%`;

  const profiles = await listProfiles();

  /*
    Every tip on the deployment, in one walk, indexed by vault.

    `null` when the walk failed outright — distinct from a walk that completed and found nothing,
    which is an empty map. The rows below branch on that difference rather than collapsing it.
  */
  const potsReading = await readChestPots();
  const pots = fold(
    potsReading,
    (value) => value,
    () => null,
  );
  const potsWhy =
    potsReading.ok
      ? potsReading.value.truncated
        ? 'more settled payments than one page can total'
        : ''
      : `${potsReading.failure.kind}: ${potsReading.failure.source}`;
  /* A truncated walk holds subtotals. They are not totals and are not shown as any. */
  const potsUsable = pots !== null && !pots.truncated;

  /*
    Decimals once per distinct coin, not once per creator. Creators on a deployment usually share a
    denomination, so this is normally a single metadata read for the whole page.
  */
  const decimalsByCoin = new Map<string, number | null>();
  for (const coinType of new Set(
    profiles.map((p) => p.coinType).filter((c): c is string => c != null && c !== ''),
  )) {
    const read = client === null ? null : await readDecimals(client, coinType);
    decimalsByCoin.set(coinType, read !== null && read.ok ? read.value : null);
  }

  /*
    The corrected split line.

    The design promises the whole amount reaches them. It does not, and saying so here costs less
    than a supporter discovering it from a block explorer.
  */
  const split =
    feeLabel === null
      ? 'A platform fee is taken at settlement; the rate could not be read just now.'
      : `${feeLabel} is taken at settlement, in the same transaction. The rest reaches them directly.`;

  /**
   * Returns the figure and the type it is set in, because the whole scheme rests on an unread value
   * never being mistakable for a read one: measured figures are mono and ink, "Early" is the body
   * face in sand, and a failure is italic and alert-coloured, shaped nothing like a number.
   */
  const potOf = (profile: (typeof profiles)[number]) => {
    const MONO = 'var(--weir-mono)';
    const measured = (value: string, note: string) => ({
      pot: value,
      potFont: MONO,
      potSize: '1.5rem',
      potStyle: 'normal',
      potColor: 'var(--ink,#dce9e6)',
      potNote: note,
    });
    const unmeasured = (why: string) => ({
      pot: 'not measured',
      potFont: BODY,
      potSize: '1.0625rem',
      potStyle: 'italic',
      potColor: ALERT,
      potNote: why,
    });

    // No vault is not a failure to measure — there is genuinely nowhere for a tip to have landed.
    if (profile.vaultId === null) {
      return {
        pot: 'No chest yet',
        potFont: BODY,
        potSize: '1.0625rem',
        potStyle: 'normal',
        potColor: SAND,
        potNote: 'this creator has not opened a vault',
      };
    }
    if (!potsUsable) return unmeasured(potsWhy || 'the payment log could not be read');

    const decimals = profile.coinType == null ? null : (decimalsByCoin.get(profile.coinType) ?? null);
    const symbol = profile.coinType?.split('::').pop() ?? '';
    const held = pots?.byVault.get(profile.vaultId);

    /*
      The walk completed and this vault has no tips. "Early" rather than a zero: a mono `0` beside
      the other rows' real figures reads as a measured emptiness about a person, and the design has
      a state for "we looked and there is little yet" that does not.
    */
    if (held === undefined || held.totalMinor === 0n) {
      return {
        pot: 'Early',
        potFont: BODY,
        potSize: '1.0625rem',
        potStyle: 'normal',
        potColor: SAND,
        potNote: 'no tips yet; the log was read',
      };
    }
    // A total exists and cannot be priced. Refused rather than shown against a guessed scale.
    if (decimals === null) return unmeasured("the coin's decimals could not be read");

    return measured(
      `${formatUnits(held.totalMinor, decimals)}${symbol === '' ? '' : ` ${symbol}`}`,
      `${held.gifts} tip${held.gifts === 1 ? '' : 's'} from ${held.givers} ${held.givers === 1 ? 'person' : 'people'}`,
    );
  };

  const chests: DesignChest[] = profiles.map((profile) => ({
    ...potOf(profile),
    name: profile.displayName,
    icon: <Icon name="chest" size={16} color={CREST} />,
    tag: profile.vaultId === null ? 'no vault' : 'open',
    tagColor: profile.vaultId === null ? SAND : CREST,
    tagBorder:
      profile.vaultId === null
        ? 'rgba(var(--sand-rgb,217,201,163),0.32)'
        : 'rgba(var(--crest-rgb,139,227,198),0.32)',
    rule: 'linear-gradient(100deg,var(--crest,#8be3c6),var(--teal,#7fd8dd))',
    body: profile.bio,
    split,
    note:
      profile.vaultId === null
        ? 'This creator has not opened a vault, so there is nowhere for a chest to settle yet.'
        : "It buys no access. Any perks are the creator's own promise, kept by them.",
    noteColor: profile.vaultId === null ? SAND : DIM,
    giveLabel: signedIn ? `Give to @${profile.handle}` : 'Sign in to give',
    href: signedIn ? `/c/${profile.handle}` : `/signin?next=${encodeURIComponent(`/c/${profile.handle}`)}`,
    /*
      Suggestions that prefill the give box, never a committed transaction.

      Data only — no handler. A server component cannot pass a function to a client one, and trying
      to is a 500 rather than a warning. `DesignChests` attaches the click.
    */
    amounts: [1, 5, 25].map((sui) => ({
      label: `${sui} SUI`,
      sui,
      bg: 'transparent',
      color: DIM,
      border: 'rgba(var(--line-rgb,28,61,71),0.9)',
    })),
  }));

  return (
    <DesignChests signedIn={signedIn} myHandle={myHandle} chests={chests} feeBps={feeBps} />
  );
}
