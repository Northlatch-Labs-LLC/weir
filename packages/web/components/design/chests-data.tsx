// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { createClient, fold, readDecimals, readPlatform } from '@projectx-social/sdk';
import { siteConfig } from '@/lib/chain';
import { listProfiles } from '@/lib/content';
import { readChestPots } from '@/lib/chests';
import { formatUnits } from '@/lib/units';
import { Icon } from '@/components/design/icons';
import { DesignChests, type DesignChest } from '@/components/design/Chests';

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

  const potsReading = await readChestPots();
  const pots = fold(
    potsReading,
    (value) => value,
    () => null,
  );
  if (!potsReading.ok) {
    console.warn(
      `chest totals unavailable: ${potsReading.failure.kind} — ${potsReading.failure.source}`,
    );
  }
  const potsWhy = potsReading.ok
    ? potsReading.value.truncated
      ? 'more settled payments than one page can total'
      : ''
    : '';
  const potsUsable = pots !== null && !pots.truncated;

  const decimalsByCoin = new Map<string, number | null>();
  for (const coinType of new Set(
    profiles.map((p) => p.coinType).filter((c): c is string => c != null && c !== ''),
  )) {
    const read = client === null ? null : await readDecimals(client, coinType);
    decimalsByCoin.set(coinType, read !== null && read.ok ? read.value : null);
  }

  const split =
    feeLabel === null
      ? 'A platform fee is taken at settlement; the rate is being read from the chain.'
      : `${feeLabel} is taken at settlement, in the same transaction. The rest reaches them directly.`;

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
      pot: '',
      potFont: BODY,
      potSize: '1.0625rem',
      potStyle: 'italic',
      potColor: ALERT,
      potNote: why,
    });

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
    if (!potsUsable) return unmeasured(potsWhy);

    const decimals = profile.coinType == null ? null : (decimalsByCoin.get(profile.coinType) ?? null);
    const symbol = profile.coinType?.split('::').pop() ?? '';
    const held = pots?.byVault.get(profile.vaultId);

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
    if (decimals === null) return unmeasured("the coin scale is being read from the chain");

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
