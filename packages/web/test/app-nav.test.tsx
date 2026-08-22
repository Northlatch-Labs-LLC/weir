// @vitest-environment happy-dom
// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
/**
 * The dashboard rail: what it offers, and to whom.
 *
 * # What moved, and what must not have been lost
 *
 * The first attempt at the swap lost the rail entirely and flattened the dashboard into one column.
 * These pin the destinations against that, so a future change to the chrome cannot quietly take
 * navigation with it.
 *
 * # The gating is the part worth defending
 *
 * The old rail's tests asserted the drawer opened and the labels were not bare icons. They never
 * asserted the thing that actually matters: *who sees the creator tools*. There is no creator role
 * anywhere — not on chain, not in the database — so it is derived from whether an address holds a
 * vault, and the third state is the one that bites. `undefined` means "not looked up yet, or the
 * read failed", and it must hide the entry without ever being mistaken for "you are not a creator".
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SIGNER = '0x9c8f6a1d2b4e7c05a3f18d6b29e4c7a0f5b3d8e1c6a94f27b0d5e83a1c6f492b';

let signer: { address: string } | null = null;
let pathname = '/creator';

vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/components/SignerProvider', () => ({
  useSigner: () => ({ signer, session: { network: 'mainnet' } }),
}));

const { AppNav } = await import('../components/design/AppNav');

/**
 * What the chain says about this address.
 *
 * `stage` is `/api/creator`; `admin` is `/api/admin`. `null` for either means the route answered
 * with something unusable — which the component must treat as "we could not look", not as "no".
 */
function chain({ stage, admin }: { stage?: string | null; admin?: boolean | null }): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string) => ({
      ok: true,
      status: 200,
      json: async () =>
        input.startsWith('/api/creator')
          ? stage == null
            ? {}
            : { stage }
          : admin == null
            ? {}
            : { isAdmin: admin },
    })),
  );
}

function labels(): string[] {
  return [...document.querySelectorAll('.weir-appnav__link')].map((a) => a.textContent ?? '');
}

beforeEach(() => {
  signer = null;
  pathname = '/creator';
  chain({});
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the dashboard rail', () => {
  it('offers every destination that has no other way in', async () => {
    signer = { address: SIGNER };
    chain({ stage: 'ready', admin: true });
    render(<AppNav />);

    /*
      The full set. Each of these is a real surface, and losing one to a chrome change is invisible
      — the page still exists and answers, and simply nothing links to it any more.
    */
    await waitFor(() => {
      for (const label of [
        'Feed',
        'Explore',
        'Messages',
        'Alerts',
        'Purchases',
        'Referrals',
        'Creator vault',
        'Compose',
        'Earnings',
        'Platform',
      ]) {
        expect(labels().some((text) => text.includes(label))).toBe(true);
      }
    });
  });

  it('names every destination in words, never a bare icon', () => {
    render(<AppNav />);
    // The state this replaced rendered these at 10px in a row and they were unreadable. The text
    // being present is the part a DOM test can hold; the size is held by the stylesheet.
    for (const text of labels()) expect(text.trim()).not.toBe('');
  });

  it('is its own landmark, distinct from the header nav', () => {
    render(<AppNav />);
    /*
      Two navigations exist on these pages and they are different things: the header's "Primary" is
      the product, this is the account. Two landmarks sharing one name is worse than one landmark —
      somebody listing them by voice gets the same word twice and has to open both to tell them
      apart.
    */
    expect(screen.getByLabelText('Account')).toBeTruthy();
  });

  it('marks the page you are on for a screen reader, not by colour alone', () => {
    pathname = '/purchases';
    render(<AppNav />);
    const here = document.querySelector('[aria-current="page"]');
    expect(here?.textContent).toContain('Purchases');
  });
});

describe('who is shown the creator tools', () => {
  it('shows them to an address that holds a vault', async () => {
    signer = { address: SIGNER };
    chain({ stage: 'ready' });
    render(<AppNav />);

    await waitFor(() => expect(labels().some((t) => t.includes('Compose'))).toBe(true));
  });

  it('withholds them from an address that holds none', async () => {
    signer = { address: SIGNER };
    chain({ stage: 'no-vault' });
    render(<AppNav />);

    // Offering the studio to somebody with no vault sends them to a page that can only refuse
    // them, and every control on it aborts on chain.
    await waitFor(() => expect(labels().some((t) => t.includes('Feed'))).toBe(true));
    expect(labels().some((t) => t.includes('Compose'))).toBe(false);
  });

  it('withholds them when the chain could not be read, rather than guessing either way', async () => {
    signer = { address: SIGNER };
    chain({ stage: null });
    render(<AppNav />);

    /*
      The third state. A failed read is not "you are not a creator" — but it is also not grounds to
      show controls that would abort. So the rail stays as it was and grows only when a real answer
      arrives, which is the direction that never tells a creator they are not one.
    */
    await waitFor(() => expect(labels().some((t) => t.includes('Feed'))).toBe(true));
    expect(labels().some((t) => t.includes('Compose'))).toBe(false);
  });

  it('offers Join only while there is no account to join with', async () => {
    signer = { address: SIGNER };
    chain({ stage: 'no-account' });
    render(<AppNav />);

    await waitFor(() => expect(labels().some((t) => t.includes('Create your account'))).toBe(true));
  });

  it('withholds Join from somebody who already has an account', async () => {
    signer = { address: SIGNER };
    chain({ stage: 'ready' });
    render(<AppNav />);

    await waitFor(() => expect(labels().some((t) => t.includes('Compose'))).toBe(true));
    // Registering twice is refused on chain, so the link could only ever lead to an abort.
    expect(labels().some((t) => t.includes('Create your account'))).toBe(false);
  });

  it('withholds the platform entry from somebody without the capability', async () => {
    signer = { address: SIGNER };
    chain({ stage: 'ready', admin: false });
    render(<AppNav />);

    await waitFor(() => expect(labels().some((t) => t.includes('Compose'))).toBe(true));
    expect(labels().some((t) => t.includes('Platform'))).toBe(false);
  });
});
