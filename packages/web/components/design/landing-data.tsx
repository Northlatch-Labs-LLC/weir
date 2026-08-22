// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import { createClient, fold, readPlatform } from '@projectx-social/sdk';
import { siteConfig } from '@/lib/chain';
import { LADDER_DEPTH, RUNGS } from '@/lib/ladder';
import { formatUnits } from '@/lib/units';
import { Icon } from '@/components/design/icons';
import {
  DesignLanding,
  type DesignFigure,
  type DesignMechanism,
  type DesignPath,
  type DesignStep,
} from '@/components/design/Landing';

/**
 * The landing route's data.
 */

const MONO = "'Geist Mono',monospace";
const BODY = "'Geist',sans-serif";
const INK = 'var(--ink,#dce9e6)';
const SAND = 'var(--sand,#d9c9a3)';
const ALERT = 'var(--alert,#f2a29b)';

function measured(label: string, value: string, asOf?: string): DesignFigure {
  return {
    label,
    value,
    asOf,
    font: MONO,
    size: '1.5rem',
    weight: '500',
    style: 'normal',
    color: INK,
  };
}

/** Read, and genuinely zero or not yet meaningful. Distinct from "we could not look". */
function early(label: string): DesignFigure {
  return {
    label,
    value: 'Early',
    font: BODY,
    size: '1.0625rem',
    weight: '600',
    style: 'normal',
    color: SAND,
  };
}

/**
 * The read failed.
 *
 * It says so in italic alert type, and deliberately does not look like a number — the point of the
 * whole scheme is that an unread value can never be mistaken for a read one.
 */
function unmeasured(label: string, why: string): DesignFigure {
  return {
    label,
    value: 'not measured',
    asOf: why,
    font: BODY,
    size: '1.0625rem',
    weight: '500',
    style: 'italic',
    color: ALERT,
  };
}

const POOL = 'var(--panel,#0b2530)';
const POOL2 = 'var(--line-2,#123039)';
const LINE = 'var(--line,#1c3d47)';
const CREST = 'var(--crest,#8be3c6)';

const STEPS: readonly DesignStep[] = [
  {
    n: '1',
    icon: <Icon name="key" size={15} />,
    title: 'Bring an address',
    body: 'Google through zkLogin, or a wallet you already keep. The page belongs to the address.',
  },
  {
    n: '2',
    icon: <Icon name="layers" size={15} />,
    title: 'Set your tiers',
    body: 'Written to an on-chain object anyone can read. Change them later; the history stays public.',
  },
  {
    n: '3',
    icon: <Icon name="drop" size={15} />,
    title: 'Open the pool',
    body: 'One vault, owned by your account, backing every page you publish.',
  },
  {
    n: '4',
    icon: <Icon name="doc" size={15} />,
    title: 'Post',
    body: 'Free, subscribers-only, or one-off unlock. Gated bodies never leave the server.',
  },
];

const PATHS: readonly DesignPath[] = [
  {
    kicker: 'Posts',
    icon: <Icon name="doc" size={15} />,
    title: 'They buy access',
    body: "A subscription, or a one-time unlock. The body is encrypted with Seal and stored on Walrus; the key releases against an object in the buyer's wallet, never against a row in our database.",
    cta: 'See the feed',
    href: '/',
  },
  {
    kicker: 'Treasury',
    icon: <Icon name="vault" size={15} />,
    title: 'They pool, you earn the yield',
    body: 'Pooled SUI is delegated to a validator and the staking yield fills the treasury. It costs the pooler nothing they keep — the principal is withdrawable in full, any time.',
    cta: 'See the treasury',
    href: '/treasury',
  },
  {
    kicker: 'Chests',
    icon: <Icon name="chest" size={15} />,
    title: 'They give outright',
    body: "A donation, settled on chain like any other payment here and charged the same platform fee. It buys nothing and expires never — the one place on Weir where money leaves the giver for good, said plainly.",
    cta: 'See the chests',
    href: '/chests',
  },
];

export async function LandingData({
  signedIn,
  myHandle,
}: {
  /* Always false today — `/` only renders the landing for a visitor with no proved session — but
     taken as a prop rather than assumed, so the chrome cannot silently disagree with the page. */
  signedIn: boolean;
  myHandle: string | null;
}) {
  const config = siteConfig();
  const client = config.ok ? createClient(config.value) : null;
  const reading = client === null || !config.ok ? null : await readPlatform(client, config.value);

  /*
    One read, folded once. `platform` is null when the chain could not be reached at all, and every
    figure below branches on that rather than substituting a default — there is no default here that
    would be honest.
  */
  const platform =
    reading === null
      ? null
      : fold(
          reading,
          (value) => value,
          () => null,
        );

  const why =
    reading === null
      ? 'this site is not configured for a chain'
      : reading.ok
        ? ''
        : `${reading.failure.kind} — ${reading.failure.source}`;

  /** The live fee, as a percentage. Basis points, so 290 is 2.9%. */
  const feePercent =
    platform === null
      ? null
      : `${(Number(platform.feeBps) / 100).toFixed(2).replace(/\.?0+$/, '')}%`;

  /**
   * What the ladder captures, derived from the contract's own constants rather than typed.
   */
  const ladderCapture = `${((Number(LADDER_DEPTH) / Number(RUNGS)) * 100).toFixed(1)}%`;

  const heroRail = [
    {
      figure: feePercent ?? 'not measured',
      label: 'taken at settlement',
      icon: <Icon name="arrow" size={14} />,
      href: '/security',
    },
    {
      figure: ladderCapture,
      label: 'yield the ladder captures',
      icon: <Icon name="arrow" size={14} />,
      href: '/treasury',
    },
    {
      figure: '0',
      label: 'functions that can touch your deposit',
      icon: <Icon name="arrow" size={14} />,
      href: '/vault',
    },
  ];

  const feeSentence =
    feePercent === null
      ? 'We take a platform fee at settlement; that rate could not be read just now.'
      : `We take ${feePercent} at settlement.`;

  const mechanism: readonly DesignMechanism[] = [
    {
      idx: '01',
      icon: <Icon name="drop" size={16} />,
      title: 'Pool behind someone',
      bg: POOL,
      topRule: `1px solid ${LINE}`,
      body: "Park SUI in a creator's vault. It is delegated to a validator; the yield goes to the creator; the principal never does. Withdraw all of it whenever you like. The cost to you is the yield you would have earned yourself.",
    },
    {
      idx: '02',
      icon: <Icon name="lock" size={16} />,
      title: 'Subscribe or unlock',
      bg: POOL,
      topRule: `1px solid ${LINE}`,
      body: `Paid posts settle on chain and unlock against an object in your wallet, not a row in our database. ${feeSentence} If your access cannot be verified the post stays locked — it never opens by mistake.`,
    },
    {
      idx: '03',
      icon: <Icon name="coin" size={16} />,
      title: 'Tip',
      bg: POOL,
      topRule: `1px solid ${LINE}`,
      body: `Settled on chain into the creator's vault, like every other payment here. ${feeSentence} It buys nothing and expires never.`,
    },
    {
      idx: '—',
      icon: <Icon name="shield" size={16} />,
      title: "What doesn't move",
      bg: POOL2,
      topRule: `2px solid ${CREST}`,
      body: 'Your deposit. Your keys. Your account — a Sui address you own. If this site went dark tomorrow, all three would still be yours.',
    },
  ];

  /*
    The figures band. Every one is read on this request or says it was not.
  */
  const figures: readonly DesignFigure[] =
    platform === null
      ? [unmeasured('Accounts', why), unmeasured('Creator vaults', why), unmeasured('Platform fee', why)]
      : [
          platform.accountsCreated === 0n
            ? early('Accounts')
            : measured(
                'Accounts',
                platform.accountsCreated.toString(),
                'read from the Platform object',
              ),
          platform.vaultsCreated === 0n
            ? early('Creator vaults')
            : measured(
                'Creator vaults',
                platform.vaultsCreated.toString(),
                'read from the Platform object',
              ),
          measured('Platform fee', feePercent ?? '—', 'taken at settlement, in the same transaction'),
          platform.treasuryMist === 0n
            ? early('Protocol treasury')
            : measured(
                'Protocol treasury',
                `${formatUnits(platform.treasuryMist, 9)} SUI`,
                'read from the Platform object',
              ),
        ];

  return (
    <DesignLanding
      signedIn={signedIn}
      myHandle={myHandle}
      feeLabel={feePercent ?? 'a platform fee'}
      heroRail={heroRail}
      figures={figures}
      mechanism={mechanism}
      paths={PATHS}
      steps={STEPS}
    />
  );
}
