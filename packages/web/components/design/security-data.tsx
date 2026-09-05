// Built-by: @projectx.sui · Co-authored-by: Claude
import { createClient, fold, readPlatform } from '@projectx-social/sdk';
import { siteConfig } from '@/lib/chain';
import { keyRegistryId } from '@/lib/keys';
import { MAX_PLATFORM_FEE_BPS } from '@/lib/admin';
import { Icon } from '@/components/design/icons';
import {
  DesignSecurity,
  type DesignCmpCard,
  type DesignCmpRow,
  type DesignContract,
  type DesignGuarantee,
  type DesignOnlyChain,
} from '@/components/design/Security';

/**
 * Security's data.
 *
 * Most of this page's copy is copied verbatim from the design. Two things are not: the fee, which
 * is read from the Platform object, and the contract ids, which come from configuration.
 */

const CREST = 'var(--crest,#8be3c6)';
const TEAL = 'var(--teal,#7fd8dd)';
const SAND = 'var(--sand,#d9c9a3)';
const DIM = 'var(--dim,#a3bcb8)';
const INK = 'var(--ink,#dce9e6)';
const ALERT = 'var(--alert,#f2a29b)';
const LINE = 'rgba(var(--line-rgb,28,61,71),0.9)';

const GUARANTEES: readonly DesignGuarantee[] = [
  { icon: <Icon name="lock" size={18} />, title: 'One predicate, in one place', body: 'A gated body is released only against a Subscription or Unlock object held on chain. There is no second code path, no admin override, no support tool that can hand it over.', mechanism: 'a failed read locks, never unlocks' },
  { icon: <Icon name="eye" size={18} />, title: 'Nothing to leak client-side', body: 'A body you have not bought is not in the payload at all. There is no blurred paragraph in the HTML, no hidden div, no CSS to disable: the browser never received the words.', mechanism: 'gates render from absence, not from concealment' },
  { icon: <Icon name="shield" size={18} />, title: 'Encrypted before it is stored', body: 'A paid post\u2019s words and media live on Walrus as ciphertext, sealed to the same identity, so one unlock opens both. Seal releases the key against the object in your wallet, not against a row here. The paywall is key custody, not our server agreeing to say no. A subscriber post\u2019s words are sealed too, to the month they were published: a lapsed subscription keeps what it paid for and opens nothing published after. Its media, and everything in a free post, are gated by this server rather than sealed.', mechanism: 'Seal keys · Walrus blobs · your object' },
  { icon: <Icon name="vault" size={18} />, title: 'No custody, by construction', body: 'We never take possession of a deposit, so there is nothing for us to freeze, lend, rehypothecate or lose in a bankruptcy.', mechanism: 'no deployed function moves your principal; upgrades need 2 of 3 keys' },
  { icon: <Icon name="key" size={18} />, title: 'An account nobody can close', body: 'Sign in with Google through zkLogin and you get a real Sui address: Google never learns the address, the chain never learns the account. Your subscriptions and unlocks are objects in your wallet, not rows in ours.', mechanism: 'if this site went dark, your access survives it' },
  { icon: <Icon name="check" size={18} />, title: 'Verifiable by strangers', body: 'The package digest, the tier object, the vault object and every settlement are public. You do not have to believe our dashboard: you can read the chain and disagree with us.', mechanism: 'every figure names its source or says not measured' },
];

const ONLY_CHAIN: readonly DesignOnlyChain[] = [
  { figure: '∞', title: 'A paywall that outlives the platform', body: "Your subscriber's access is an object in their wallet. Ours is not the server that grants it, so our uptime, our terms of service and our continued existence are not conditions of your business." },
  { figure: '1:1', title: 'Numbers anyone can check', body: 'Every fee, payout and balance is a public record with a digest. Nobody has to trust a screenshot of a dashboard: a competitor, a journalist or a tax authority can verify it independently.' },
];

const CMP_SOURCES: readonly string[] = [
  "Patreon: 10% platform fee plus payment processing, roughly 13 to 16% all-in. Verified against Patreon's help centre, 19 Aug 2026.",
  "OnlyFans: 20%, the platform's own published rate, 19 Aug 2026.",
  'Both are re-verified before any paid campaign. If a competitor’s rate moves in our favour we still print theirs rather than ours, and we date it.',
];

export async function SecurityData({
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

  const feePercent =
    platform === null
      ? null
      : `${(Number(platform.feeBps) / 100).toFixed(2).replace(/\.?0+$/, '')}%`;
  const ceiling = `${Number(MAX_PLATFORM_FEE_BPS) / 100}%`;

  /*
    The corrected claim.

    "Frozen in the contract" is false — `set-fees` exists and the ceiling is what the contract really
    guarantees. Saying the true thing is also the stronger thing: a rate anyone can read, bounded by
    code, beats an unverifiable promise that it will never move.
  */
  const weirFeeAnswer =
    feePercent === null
      ? `The rate is on chain and could not be read just now. The contract caps it at ${ceiling}.`
      : `${feePercent}, taken at settlement in the same transaction that pays you. Read from the Platform object; the contract caps it at ${ceiling}.`;

  const CMP_ROWS: readonly DesignCmpRow[] = [
    { icon: <Icon name="scales" size={16} />, q: 'What does the platform take?', weir: weirFeeAnswer, patreon: '10% platform fee plus payment processing, roughly 13 to 16% all-in depending on the tier and the payment method.', of: '20% flat, deducted before payout.' },
    { icon: <Icon name="vault" size={16} />, q: 'Who holds the money between the supporter paying and you being paid?', weir: 'Nobody. Settlement and payout are one transaction, so there is no interval and no balance for us to hold.', patreon: 'Patreon holds it until a payout cycle releases it to your bank or PayPal.', of: 'OnlyFans holds it until a payout cycle releases it, with a minimum balance before withdrawal.' },
    { icon: <Icon name="lock" size={16} />, q: 'What enforces the paywall?', weir: "A Seal key over a Walrus blob, released against a Subscription or Unlock object in the buyer's wallet. A failed read locks.", patreon: "A row in Patreon's database, checked by Patreon's servers.", of: "A row in OnlyFans' database, checked by their servers." },
    { icon: <Icon name="shield" size={16} />, q: 'What happens to your business if your account is terminated?', weir: 'Your supporters keep their subscriptions and unlocks as objects, and your pool stays in a vault your address owns. Losing us does not lose them.', patreon: 'Access ends with the account. The membership list and the paid posts go with it.', of: 'Access ends with the account, and payouts can be withheld pending review.' },
  ];

  const CMP_SUMMARY: readonly DesignCmpCard[] = [
    {
      name: 'Weir',
      figure: feePercent ?? 'not measured',
      note:
        feePercent === null
          ? `Taken at settlement, in the same transaction. The rate could not be read just now; the contract caps it at ${ceiling}.`
          : `Taken at settlement, in the same transaction. Read from the Platform object, and capped at ${ceiling} by the contract.`,
      bg: 'linear-gradient(180deg,rgba(var(--pc,26,66,78),0.9),rgba(var(--pd,11,37,48),0.94))',
      border: 'rgba(var(--crest-rgb,139,227,198),0.32)',
      shadow: 'inset 0 1px 0 rgba(var(--hi-rgb,220,233,230),0.08),0 26px 60px -42px rgba(var(--crest-rgb,139,227,198),0.6)',
      rule: 'linear-gradient(100deg,var(--crest,#8be3c6),var(--teal,#7fd8dd) 46%,var(--sand,#d9c9a3))',
      nameColor: CREST,
      figureColor: feePercent === null ? ALERT : 'transparent',
      figureBg: feePercent === null ? 'none' : 'linear-gradient(100deg,var(--crest,#8be3c6),var(--teal,#7fd8dd))',
      clip: feePercent === null ? 'border-box' : 'text',
      figureGlow: feePercent === null ? 'none' : 'drop-shadow(0 0 24px rgba(var(--crest-rgb,139,227,198),0.45))',
    },
    { name: 'Patreon', figure: '13 to 16%', note: 'A 10% platform fee plus payment processing. The all-in figure is the one a creator actually feels.', bg: 'linear-gradient(180deg,rgba(var(--pa,20,52,62),0.6),rgba(var(--pb,9,32,42),0.8))', border: LINE, shadow: 'inset 0 1px 0 rgba(var(--hi-rgb,220,233,230),0.04)', rule: LINE, nameColor: DIM, figureColor: INK, figureBg: 'none', clip: 'border-box', figureGlow: 'none' },
    { name: 'OnlyFans', figure: '20%', note: "The platform's published rate, before any payout hold. Flat, and the highest of the three.", bg: 'linear-gradient(180deg,rgba(var(--pa,20,52,62),0.6),rgba(var(--pb,9,32,42),0.8))', border: LINE, shadow: 'inset 0 1px 0 rgba(var(--hi-rgb,220,233,230),0.04)', rule: LINE, nameColor: DIM, figureColor: INK, figureBg: 'none', clip: 'border-box', figureGlow: 'none' },
  ];

  /**
   * The contract cards, from configuration.
   */
  const network = config.ok ? config.value.network : null;
  const scan = (id: string) =>
    network === null ? undefined : `https://suiscan.xyz/${network}/object/${id}`;

  /*
    The key registry, read the way `lib/keys.ts` reads it.
  */
  const keyRegistry = fold(
    keyRegistryId(),
    (value) => value,
    () => null,
  );

  /*
    Two package ids, not one, and the running one first.

    This section exists to let a stranger check us, and it listed a single "Weir package" pointing at
    `packageId` — the *original* publication. `packages/sdk/src/config.ts` states what that is: type
    identity, and never a call target, because "after an upgrade it names the old code, which does
    not contain modules added since".

    This deployment has been upgraded. The original holds six modules; the running package holds
    seven, and the seventh is `key_registry` — the module deciding who can decrypt a paid body.
    Verified from chain rather than from the deploy record: the live registry's type reads
    `0xa7fd1540…::key_registry::KeyRegistry`, namespaced to the upgrade, which is only possible if
    the module was first published there. A sceptic following the one link we gave them landed in a
    package where the most sensitive code in the product is absent, and nothing said so.

    Both are needed and neither substitutes for the other: the running package is the code that
    executes when somebody pays, and the original is the address in the type tag of every object this
    product has ever created.
  */
  const rows: { key: string; name: string; icon: string; rail: string; id: string | null; what: string }[] = [
    { key: 'package', name: 'Weir package (running)', icon: 'cube', rail: 'linear-gradient(180deg,var(--crest,#8be3c6),var(--teal,#7fd8dd))', id: config.ok ? config.value.latestPackageId : null, what: 'The code that executes: subscriptions, unlocks, tier objects, the settlement that takes the platform fee in the same transaction, and the key registry. This is the package to read.' },
    { key: 'origin', name: 'Original publication', icon: 'layers', rail: 'linear-gradient(180deg,var(--teal,#7fd8dd),var(--sand,#d9c9a3))', id: config.ok ? config.value.packageId : null, what: 'Where these types were first published. Move binds type identity to that address forever, so every object Weir has ever made carries this id in its type tag: it is how you recognise one as ours. It is not the code that runs today.' },
    { key: 'keys', name: 'Key registry', icon: 'key', rail: 'linear-gradient(180deg,var(--sand,#d9c9a3),var(--crest,#8be3c6))', id: keyRegistry, what: 'The published encryption key for each address, used for direct messages between people. This module was added in the upgrade, which is why the original package above does not contain it.' },
    { key: 'platform', name: 'Platform object', icon: 'vault', rail: 'linear-gradient(180deg,var(--crest,#8be3c6),var(--teal,#7fd8dd))', id: config.ok ? config.value.platformId : null, what: 'Holds the live economic terms: the fee, the referral share, the treasury. Every figure this site prints about fees is read from here.' },
    { key: 'registry', name: 'Account registry', icon: 'layers', rail: 'linear-gradient(180deg,var(--teal,#7fd8dd),var(--sand,#d9c9a3))', id: config.ok ? config.value.registryId : null, what: 'Maps handles to addresses. This is what decides whether a name is free, and it is the same table the mint transaction writes to.' },
  ];

  const contracts: readonly DesignContract[] = rows.map((row) => {
    const present = row.id !== null && row.id !== '';
    return {
      name: row.name,
      tag: present ? 'live' : 'not published',
      tagColor: present ? CREST : SAND,
      tagBorder: present ? 'rgba(var(--crest-rgb,139,227,198),0.32)' : 'rgba(var(--sand-rgb,217,201,163),0.32)',
      icon: <Icon name={row.icon} size={16} />,
      rail: row.rail,
      id: present ? row.id : 'not published',
      idColor: present ? INK : SAND,
      idStyle: present ? 'normal' : 'italic',
      what: row.what,
      copyLabel: present ? 'Copy id' : 'Nothing to copy',
      linkLabel: present ? 'View on Suiscan' : 'Not published; set at deploy',
      linkColor: present ? TEAL : DIM,
      href: present && row.id !== null ? scan(row.id) : undefined,
      onCopy: undefined,
    };
  });

  return (
    <DesignSecurity
      signedIn={signedIn}
      myHandle={myHandle}
      guarantees={GUARANTEES}
      onlyChain={ONLY_CHAIN}
      cmpRows={CMP_ROWS}
      cmpSummary={CMP_SUMMARY}
      cmpSources={CMP_SOURCES}
      contracts={contracts}
    />
  );
}
