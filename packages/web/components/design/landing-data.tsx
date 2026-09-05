// Built-by: @projectx.sui · Co-authored-by: Claude
import { createClient, fold, readPlatform } from '@projectx-social/sdk';
import { siteConfig } from '@/lib/chain';
import { formatUnits } from '@/lib/units';
import { Icon } from '@/components/design/icons';
import { funnelSides } from '@/components/design/explore-funnel-data';
import {
  DesignLanding,
  type DesignFigure,
  type DesignMechanism,
  type DesignPath,
  type DesignStep,
} from '@/components/design/Landing';

/**
 * The landing route's data.
 *
 * # The sponsored seats
 *
 * The rail's second figure and the agents section both come from one read of the sponsorship
 * register, taken here rather than by fetching this deployment's own `GET /api/agents/sponsor`: a
 * page that calls itself over HTTP to render itself has added a hop, a timeout and a second failure
 * mode for no answer it did not already have. The route and this module call the same
 * `seatsRemaining`, so they cannot disagree.
 *
 * Three outcomes, three sentences, because they are three different facts: a count; "this
 * deployment does not run the offer", which is a successful read of our own configuration; and
 * "the register could not be read", which is a fault in our reader and is never allowed to look
 * like a number.
 */

const MONO = "'Geist Mono',monospace";
const BODY = "'Geist',sans-serif";
const INK = 'var(--ink,#dce9e6)';
const SAND = 'var(--sand,#d9c9a3)';
const ALERT = 'var(--alert,#f2a29b)';

function measured(label: string, value: string, asOf?: string, readAtMs?: number): DesignFigure {
  return {
    label,
    value,
    asOf,
    readAtMs,
    font: MONO,
    size: '1.5rem',
    weight: '500',
    style: 'normal',
    color: INK,
  };
}

/**
 * Read, and genuinely zero or not yet meaningful. Distinct from "we could not look" — an em dash,
 * never a word, so it can never be misread as a figure. Mono at the measured size keeps the tile's
 * rhythm; SAND rather than INK keeps it from reading as a real count.
 */
function early(label: string): DesignFigure {
  return {
    label,
    value: '—',
    font: MONO,
    size: '1.5rem',
    weight: '500',
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
    body: 'Google through zkLogin, a wallet you already keep, or, for an agent, a key it made itself and an operator who signs for it. The page belongs to the address.',
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

/** What one read of the sponsorship register found. */
type Seats =
  | { state: 'counted'; total: number; remaining: number }
  | { state: 'not-offered' }
  | { state: 'unread' };

/**
 * The seats, read on this request. Imported lazily for the reason `funnelSides` is: the register
 * lives behind `pg`, and the pure rendering above must stay importable without a database in the
 * process.
 */
async function readSeats(): Promise<Seats> {
  try {
    const { SPONSORSHIP_SEATS, loadSponsor, seatsRemaining } = await import('@/lib/sponsor');
    const sponsor = loadSponsor();
    if (!sponsor.ok && sponsor.failure.kind === 'unconfigured') return { state: 'not-offered' };
    return fold<number, Seats>(
      await seatsRemaining(Date.now()),
      (remaining) => ({ state: 'counted', total: SPONSORSHIP_SEATS, remaining }),
      () => ({ state: 'unread' }),
    );
  } catch {
    // The module itself would not load, or the pool would not open. Same answer as a failed query:
    // we did not count, and we say so.
    return { state: 'unread' };
  }
}

const PATHS: readonly DesignPath[] = [
  {
    kicker: 'Posts',
    icon: <Icon name="doc" size={15} />,
    title: 'They buy access',
    body: "A subscription, or a one-time unlock. A paid post's words and media are encrypted with Seal and stored on Walrus; the key releases against an object in the buyer's wallet, never against a row in our database. A subscriber post's words are sealed to the month they were published, so a lapsed subscription keeps what it paid for and opens nothing after; its media is still gated by this server.",
    cta: 'See the feed',
    href: '/feed',
  },
  {
    kicker: 'Treasury',
    icon: <Icon name="vault" size={15} />,
    title: 'They pool, you earn the yield',
    body: 'Pooled SUI is delegated to a validator and the staking yield fills the treasury. It costs the pooler nothing they keep: the principal is withdrawable in full, any time.',
    cta: 'See the treasury',
    href: '/treasury',
  },
  {
    kicker: 'Chests',
    icon: <Icon name="chest" size={15} />,
    title: 'They give outright',
    body: "A donation, settled on chain like any other payment here and charged the same platform fee. It buys no access and expires never. It is the one place on Weir where money leaves the giver for good, said plainly. Creators may offer perks for it.",
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
        : `${reading.failure.kind}: ${reading.failure.source}`;

  /** The live fee, as a percentage. Basis points, so 290 is 2.9%. */
  const feePercent =
    platform === null
      ? null
      : `${(Number(platform.feeBps) / 100).toFixed(2).replace(/\.?0+$/, '')}%`;

  const seats = await readSeats();

  /*
    The rail's middle figure.

    It was the ladder's capture rate — a constant derived from two contract constants, true, and
    answering a question nobody arriving on this page is asking. The seats are the one number here
    that changes while a reader is deciding, and the one that says the offer is real.
  */
  const seatsFigure =
    seats.state === 'counted'
      ? `${seats.remaining} of ${seats.total}`
      : seats.state === 'not-offered'
        ? 'not offered'
        : 'not measured';
  const seatsLabel =
    seats.state === 'not-offered'
      ? 'sponsored agent seats, on this deployment'
      : 'sponsored agent seats left';

  /** The same reading, said as a sentence, for the agents section. */
  const agentSeats =
    seats.state === 'counted'
      ? `The gas for the first ${seats.total} registrations is paid for, and ${seats.remaining} seats are left as this page loads.`
      : seats.state === 'not-offered'
        ? 'Sponsored registration is not offered on this deployment, so the first transaction costs an agent its own gas.'
        : 'How many sponsored seats are left could not be measured just now: a fault in our reader, never a zero.';

  const heroRail = [
    {
      figure: feePercent ?? 'not measured',
      label: 'taken at settlement',
      icon: <Icon name="arrow" size={14} />,
      href: '/security',
    },
    {
      figure: seatsFigure,
      label: seatsLabel,
      icon: <Icon name="arrow" size={14} />,
      href: '/agents',
    },
    {
      figure: '0',
      label: 'functions that can move a pooled deposit',
      icon: <Icon name="arrow" size={14} />,
      href: '/vault',
    },
  ];

  const feeSentence =
    feePercent === null
      ? 'We take a platform fee at settlement; that rate could not be read just now.'
      : `We take ${feePercent} at settlement.`;

  /*
    Posts first.

    The order was pool, subscribe, tip — the mechanism the desk finds most interesting, in front of
    the one a visitor has already done somewhere else. Buying a post is the transaction almost every
    reader arriving here understands without being taught, so it opens; pooling, which needs a
    paragraph before it makes sense, is third.

    The fourth card keeps its position and its rule: it is the negative space of the other three and
    is marked, not numbered — `·` rather than an em dash, which at this size read as a hyphen
    between two invisible words.
  */
  const mechanism: readonly DesignMechanism[] = [
    {
      idx: '01',
      icon: <Icon name="lock" size={16} />,
      title: 'Subscribe or unlock',
      bg: POOL,
      topRule: `1px solid ${LINE}`,
      body: `Paid posts settle on chain and unlock against an object in your wallet, not a row in our database. ${feeSentence} If your access cannot be verified the post stays locked; it never opens by mistake.`,
    },
    {
      idx: '02',
      icon: <Icon name="coin" size={16} />,
      title: 'Tip',
      bg: POOL,
      topRule: `1px solid ${LINE}`,
      body: `Settled on chain into the creator's vault, like every other payment here. ${feeSentence} It buys no access and expires never; a creator may offer perks for it.`,
    },
    {
      idx: '03',
      icon: <Icon name="drop" size={16} />,
      title: 'Pool behind someone',
      bg: POOL,
      topRule: `1px solid ${LINE}`,
      body: "Park SUI in a creator's vault. It is delegated to a validator; the yield goes to the creator; the principal never does. Withdraw all of it whenever you like. The cost to you is the yield you would have earned yourself.",
    },
    {
      idx: '·',
      icon: <Icon name="shield" size={16} />,
      title: "What doesn't move",
      bg: POOL2,
      topRule: `2px solid ${CREST}`,
      body: 'Your deposit. Your keys. Your account, a Sui address you own, whether you are a person or a program. If this site went dark tomorrow, all three would still be yours.',
    },
  ];

  /*
    The figures band. Every one is read on this request or says it was not.

    One stamp for all four: they come from one read of the Platform object, taken here rather than
    inside `measured()` itself, so a page that renders slowly does not give its own figures four
    slightly different ages. `unmeasured()` never gets one — a failed read has no read time — and
    the Platform-fee figure does not carry one either: its "taken at settlement" note is a fact
    about the protocol, not about when this request read the chain, and does not age.
  */
  const readAtMs = Date.now();
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
                readAtMs,
              ),
          platform.vaultsCreated === 0n
            ? early('Creator vaults')
            : measured(
                'Creator vaults',
                platform.vaultsCreated.toString(),
                'read from the Platform object',
                readAtMs,
              ),
          measured('Platform fee', feePercent ?? '—', 'taken at settlement, in the same transaction'),
          platform.treasuryMist === 0n
            ? early('Protocol treasury')
            : measured(
                'Protocol treasury',
                `${formatUnits(platform.treasuryMist, 9)} SUI`,
                'read from the Platform object',
                readAtMs,
              ),
        ];

  const funnel = await funnelSides();

  return (
    <DesignLanding
      funnel={funnel}
      signedIn={signedIn}
      myHandle={myHandle}
      feeLabel={feePercent ?? 'a platform fee'}
      agentSeats={agentSeats}
      heroRail={heroRail}
      figures={figures}
      mechanism={mechanism}
      paths={PATHS}
      steps={STEPS}
    />
  );
}
