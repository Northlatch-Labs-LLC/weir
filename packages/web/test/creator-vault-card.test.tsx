// @vitest-environment happy-dom
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
/**
 * The support-vault card holds one action, and it is pooling SUI.
 *
 * # Two defects this pins
 *
 * **Two denominations in one card.** `TipButton` was mounted in the same card. A tip settles against
 * `profile.vaultId`, the *creator* vault, in whatever coin that vault holds; a deposit settles
 * against the *stake* vault, in SUI. Putting them in one panel — under one "Deposit" heading, with
 * one "withdrawable in full, any time" note beneath — offers an irreversible payment inside the
 * frame built to promise the opposite. The note is true of the deposit and false of the tip, and
 * nothing on screen said which control it belonged to.
 *
 * # Why the card is rendered and the page is read
 *
 * `DesignCreator` is a client component, so the card can be built and counted. The page that fills
 * its slots is an async server component reading chain and store, so *which* control goes in which
 * slot is asserted against the source — the approach `creator-page.test.ts` already takes.
 */

import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactNode } from 'react';

vi.mock('next/navigation', () => ({
  usePathname: () => '/c/nova',
  useSearchParams: () => new URLSearchParams(),
}));

/** The signer the controls see. Reassigned per test; the address is synthetic. */
let signer: { address: string; label: string; kind: 'zklogin' | 'wallet' } | null = null;

vi.mock('@/components/SignerProvider', () => ({
  useSigner: () => ({
    signer,
    signOut: vi.fn(),
    signInWithGoogle: vi.fn(),
    wallets: [],
    unusableWallets: [],
    connectWallet: vi.fn(),
    accountChoice: null,
    chooseAccount: vi.fn(),
    cancelAccountChoice: vi.fn(),
    error: null,
    session: { network: 'mainnet', available: true },
  }),
}));

const { DesignCreator } = await import('@/components/design/Creator');
const { TipButton } = await import('@/components/TipButton');

const PROFILE = {
  handle: 'nova',
  displayName: 'Nova',
  bio: 'A bio.',
  initials: 'no',
  meta: '@nova · 3 followers',
  sui: 'nova.sui',
};

/** The card, with each slot filled by a marker so its contents can be told apart. */
function card(overrides: { tipSlot?: ReactNode } = {}) {
  return render(
    <DesignCreator
      counts={{ posts: 0, followers: 0, subscribers: null }}
      signedIn
      myHandle="nova"
      profile={PROFILE}
      tiers={[
        {
          price: '10 USDC',
          cadence: 'Monthly · every 30 days',
          net: 'Creator keeps 9.71 USDC',
          held: false,
          action: <button type="button" data-testid="subscribe">Join</button>,
        },
      ]}
      stats={[]}
      profilePosts={[]}
      viewingLabel="Viewing as a guest"
      tiersHref={undefined}
      tiersLabel="No vault"
      subscribeSlot={<button type="button" data-testid="follow">Follow</button>}
      depositSlot={
        <div data-testid="deposit">
          <label htmlFor="amount">AMOUNT · SUI</label>
          <input id="amount" defaultValue="1" />
        </div>
      }
      tipSlot={overrides.tipSlot ?? <button type="button" data-testid="tip">Send a tip</button>}
      depositLine="Pool SUI behind this account."
      depositNote="Withdrawable in full, any time."
      tab="membership"
      perks={[]}
      tabHref={{ posts: '/c/nova', membership: '/c/nova?tab=membership' }}
    />,
  );
}

afterEach(cleanup);

describe('the support-vault card', () => {
  it('offers exactly one amount field, and it is the one the transaction is built from', () => {
    const { container } = card();
    const aside = container.querySelector('aside');
    expect(aside).not.toBeNull();

    const fields = aside!.querySelectorAll('input');
    /*
      One. A second box that looks identical and is read by nothing is worse than no box at all:
      it takes the reader's number and drops it, and the deposit proceeds at a different amount.
    */
    expect(fields.length).toBe(1);
    expect(aside!.querySelector('[data-testid="deposit"]')?.contains(fields[0]!)).toBe(true);
  });

  it('leaves no label pointing at a control that is gone', () => {
    const { container } = card();
    const aside = container.querySelector('aside')!;
    for (const label of aside.querySelectorAll('label[for]')) {
      const target = label.getAttribute('for')!;
      // A `for` with no match is a click that silently does nothing, and a screen reader
      // announcing a field that is not there.
      expect(aside.querySelector(`#${target}`)).not.toBeNull();
    }
  });

  it('keeps the tip out of the pool card', () => {
    const { container } = card();
    const aside = container.querySelector('aside')!;
    /*
      The pool card promises the principal comes back. A tip never does. They cannot share a panel
      without one of them making the other's copy a lie.
    */
    expect(aside.querySelector('[data-testid="tip"]')).toBeNull();
  });

  it('puts the tip where the design already explains it', () => {
    const { container } = card();
    const membership = container.querySelector('section[aria-label="Membership"]')!;
    expect(membership.querySelector('[data-testid="tip"]')).not.toBeNull();
  });

  it('keeps the membership purchase in the tier card and out of the pool card', () => {
    const { container } = card();
    const aside = container.querySelector('aside')!;
    const membership = container.querySelector('section[aria-label="Membership"]')!;
    expect(membership.querySelector('[data-testid="subscribe"]')).not.toBeNull();
    expect(aside.querySelector('[data-testid="subscribe"]')).toBeNull();
  });
});

/**
 * The tip control's own layout.
 *
 * `.comment-input` carries `flex: 1; min-width: 0` — it is written for a flex row, which is how
 * `Comments` and `DepositCheckout` both mount it. `TipButton` had no row and an inline label, so
 * the browser set the two side by side: the field collapsed to its intrinsic width and overlapped
 * the tail of its own label. Nothing about that is visible to a renderer without layout, so it is
 * the *construction* that is asserted here rather than the geometry.
 */
describe('the tip field', () => {
  it('puts the label above the field, not beside it', () => {
    signer = { address: '0xaaa', label: 'Wallet', kind: 'wallet' };
    const { container } = render(<TipButton vaultId="0xv" decimals={6} symbol="USDC" />);
    const label = container.querySelector('label[for="tip"]')!;
    expect(getComputedStyle(label).display).toBe('block');
  });

  it('gives the field the flex row its own class requires', () => {
    signer = { address: '0xaaa', label: 'Wallet', kind: 'wallet' };
    const { container } = render(<TipButton vaultId="0xv" decimals={6} symbol="USDC" />);
    const input = container.querySelector('#tip')!;
    // Without this the `flex: 1` on `.comment-input` applies to nothing and the field shrinks to
    // its intrinsic width, which is where the overlap came from.
    expect(getComputedStyle(input.parentElement!).display).toBe('flex');
  });
});

/**
 * Which control the page hands to which slot.
 *
 * The render tests above prove the *card* keeps them apart. These prove the *page* does not put
 * them back together — the regression is one JSX element moving between two slots, which typechecks
 * and renders either way.
 */
/*
  Resolved from the working directory rather than `import.meta.url`. Under happy-dom that URL is an
  `http:` one, and `readFileSync` refuses it — which is why `creator-page.test.ts` can use the URL
  form and this file, which needs a DOM, cannot.
*/
const PAGE = readFileSync(resolve(process.cwd(), 'app/c/[handle]/page.tsx'), 'utf8');

/**
 * Everything the page assembles for `depositSlot`, up to the next thing it builds for the tip.
 *
 * The window used to end at `const tipSlot`. `const tipNote` was then declared above it — the
 * sentence explaining why a tip is not on offer, which names `coinDecimals` because that is the
 * read that failed — and the window swallowed it, so the assertion below started failing on code
 * that is not in the pool card at all. It ends at whichever of the two comes first.
 */
const DEPOSIT_SLOT = (() => {
  const start = PAGE.indexOf('const depositSlot');
  if (start === -1) throw new Error('depositSlot was not found on the creator page');
  const ends = ['const tipNote', 'const tipSlot']
    .map((decl) => PAGE.indexOf(decl, start))
    .filter((at) => at !== -1);
  const end = ends.length === 0 ? -1 : Math.min(...ends);
  return PAGE.slice(start, end === -1 ? PAGE.length : end);
})();

describe('what the creator page puts in the pool card', () => {
  it('mounts the deposit control there', () => {
    expect(DEPOSIT_SLOT).toContain('<DepositCheckout');
  });

  it('mounts no payment denominated in the creator’s own coin', () => {
    /*
      The exact regression. `TipButton` takes `profile.vaultId` and the creator's `coinDecimals`;
      the pool card is SUI and the stake vault. Neither the amount nor the destination matches the
      panel it was rendered in.
    */
    expect(DEPOSIT_SLOT).not.toContain('TipButton');
    expect(DEPOSIT_SLOT).not.toContain('SubscribeButton');
    expect(DEPOSIT_SLOT).not.toContain('coinDecimals');
  });

  it('builds a tip slot, so the control still exists somewhere', () => {
    expect(PAGE).toContain('const tipSlot');
    expect(PAGE).toContain('tipSlot={tipSlot}');
  });
});
