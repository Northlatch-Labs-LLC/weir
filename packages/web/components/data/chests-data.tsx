// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { createClient, fold, readDecimals, readPlatform } from '@projectx-social/sdk';
import { siteConfig } from '@/lib/chain';
import { listProfiles } from '@/lib/content';
import { readChestPots } from '@/lib/chests';
import { formatUnits } from '@/lib/units';
import { Icon } from '@/components/app/icons';
import { ChestsScreen, type ChestView, type ChestPot } from '@/components/app/ChestsScreen';


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

  const potOf = (profile: (typeof profiles)[number]): ChestPot => {
    if (profile.vaultId === null) return { state: 'no-vault', note: 'this creator has not opened a vault' };
    if (!potsUsable) return { state: 'unread', why: potsWhy === '' ? 'the chest total is being read from the chain' : potsWhy };

    const decimals = profile.coinType == null ? null : (decimalsByCoin.get(profile.coinType) ?? null);
    const symbol = profile.coinType?.split('::').pop() ?? '';
    const held = pots?.byVault.get(profile.vaultId);

    if (held === undefined || held.totalMinor === 0n) return { state: 'early', note: 'no tips yet; the log was read' };
    if (decimals === null) return { state: 'unread', why: 'the coin scale is being read from the chain' };

    return {
      state: 'measured',
      value: `${formatUnits(held.totalMinor, decimals)}${symbol === '' ? '' : ` ${symbol}`}`,
      note: `${held.gifts} tip${held.gifts === 1 ? '' : 's'} from ${held.givers} ${held.givers === 1 ? 'person' : 'people'}`,
    };
  };

  const chests: ChestView[] = profiles.map((profile) => ({
    handle: profile.handle,
    name: profile.displayName,
    icon: <Icon name="chest" size={16} />,
    open: profile.vaultId !== null,
    body: profile.bio,
    pot: potOf(profile),
    split,
    note:
      profile.vaultId === null
        ? 'This creator has not opened a vault, so there is nowhere for a chest to settle yet.'
        : "It buys no access. Any perks are the creator's own promise, kept by them.",
    giveLabel: signedIn ? `Give to @${profile.handle}` : 'Sign in to give',
    href: signedIn ? `/c/${profile.handle}` : `/signin?next=${encodeURIComponent(`/c/${profile.handle}`)}`,
    amounts: [1, 5, 25].map((sui) => ({ label: `${sui} SUI`, sui })),
  }));

  return (
    <ChestsScreen chests={chests} feeBps={feeBps} />
  );
}
