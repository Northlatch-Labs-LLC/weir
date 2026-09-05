// @vitest-environment happy-dom
// Built-by: @projectx.sui · Co-authored-by: Claude
/**
 * The chrome: the header, the account menu, and the sign-in page's redirect guard.
 *
 * # What these are actually defending
 *
 * Two of the three are behaviours that are invisible when broken. A menu that leaves focus on a
 * hidden element still looks right in a screenshot and is unusable by keyboard. An open redirect in
 * `?next=` looks like a working sign-in right up until somebody sends the link to somebody else.
 * Neither shows up in a visual review, which is exactly why they are pinned here.
 *
 * The third is the recovery entry. `AccountRecovery` sat unmounted for weeks with a green suite,
 * because a component test proves a component renders and never that a route reaches it. These
 * assert the *link* exists, and that it exists only for the sessions that have a salt.
 *
 * # Assertions are plain DOM on purpose
 *
 * `toHaveAttribute`, `toHaveFocus` and friends come from `@testing-library/jest-dom`, which this
 * project does not install — so they are not used here. `getAttribute` and `document.activeElement`
 * say the same thing against the same tree, and matching the house style is worth more than the
 * nicer failure message a third matcher library would print.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AccountMenu } from '@/components/AccountMenu';
import { safeNext } from '@/app/signin/page';

let pathname = '/';
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(),
}));

/** The signer the menu sees. Reassigned per test; every address here is synthetic. */
let signer: { address: string; label: string; kind: 'zklogin' | 'wallet' } | null = null;
const signOut = vi.fn();
const signInWithGoogle = vi.fn();
/** Whether this deployment has zkLogin configured. Reset per test. */
let zkAvailable = true;
/** Wallets the browser reports. Reassigned per test. */
let wallets: { name: string }[] = [];
const connectWallet = vi.fn();
/** Set when a wallet authorises several addresses. The dialog must host this picker. */
let accountChoice: { wallet: { name: string }; accounts: { address: string; label?: string }[] } | null = null;
/** What the wallet said, verbatim. Rendered in the dialog — it used to go nowhere. */
let walletError: string | null = null;
const chooseAccount = vi.fn();
const cancelAccountChoice = vi.fn();
vi.mock('@/components/SignerProvider', () => ({
  useSigner: () => ({
    signer,
    signOut,
    signInWithGoogle,
    wallets,
    unusableWallets: [],
    connectWallet,
    accountChoice,
    chooseAccount,
    cancelAccountChoice,
    error: walletError,
    session: { network: 'mainnet', available: zkAvailable },
  }),
}));

const ZK = {
  address: '0xabc1230000000000000000000000000000000000000000000000000000009f42',
  label: 'Google',
  kind: 'zklogin' as const,
};
const WALLET = {
  address: '0xdef4560000000000000000000000000000000000000000000000000000001a05',
  label: 'Slush',
  kind: 'wallet' as const,
};

beforeEach(() => {
  pathname = '/';
  signer = null;
  zkAvailable = true;
  wallets = [];
  accountChoice = null;
  walletError = null;
  chooseAccount.mockClear();
  cancelAccountChoice.mockClear();
  signOut.mockClear();
  signInWithGoogle.mockClear();
  connectWallet.mockClear();
});

/*
  Explicit, because this config does not set `globals: true` — so React Testing Library's automatic
  cleanup never registers. Without it every render stays in the document and the second test onwards
  fails with "found multiple elements", which reads as a duplicate-rendering bug in the component
  rather than as the harness leaking between tests.
*/
afterEach(() => cleanup());

/** The menu renders nothing on the first pass; `findBy*` waits for the mount effect to land. */
async function openMenu(): Promise<HTMLElement> {
  const trigger = await screen.findByRole('button', { expanded: false });
  fireEvent.click(trigger);
  return trigger;
}

describe('safeNext — the sign-in redirect', () => {
  it('keeps an ordinary in-app path', () => {
    expect(safeNext('/earnings')).toBe('/earnings');
    expect(safeNext('/c/projectx?reader=0x1')).toBe('/c/projectx?reader=0x1');
  });

  it('falls back to the root when nothing was asked for', () => {
    expect(safeNext(undefined)).toBe('/');
  });

  /*
    The whole point of the function. A link to *our* sign-in page carrying somebody else's
    destination is convincing precisely because the domain in the address bar is genuinely ours.
  */
  it('refuses an absolute URL', () => {
    expect(safeNext('https://evil.example/steal')).toBe('/');
    expect(safeNext('http://evil.example')).toBe('/');
  });

  /*
    The case that gets forgotten. `//evil.example` begins with a slash and reads as relative; every
    browser treats it as protocol-relative, which is to say absolute. A guard checking only
    `startsWith('/')` passes this straight through.
  */
  it('refuses a protocol-relative URL', () => {
    expect(safeNext('//evil.example/steal')).toBe('/');
  });
});

describe('AccountMenu', () => {
  /** Opens the connect window from the header's single button. */
  async function openConnect(): Promise<void> {
    fireEvent.click(await screen.findByRole('button', { name: /connect/i }));
  }

  /*
    One control, not one per wallet.
  */
  it('offers a single connect control however many wallets are installed', async () => {
    wallets = [{ name: 'Slush' }, { name: 'Phantom' }];
    render(<AccountMenu />);

    await screen.findByRole('button', { name: /connect/i });
    // Not a button per wallet sitting in the header itself.
    expect(screen.queryByRole('button', { name: 'Slush' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Phantom' })).toBeNull();
  });

  it('lists the installed wallets in the window and connects the one chosen', async () => {
    wallets = [{ name: 'Slush' }, { name: 'Phantom' }];
    render(<AccountMenu />);
    await openConnect();

    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Phantom' }));

    expect(connectWallet).toHaveBeenCalledOnce();
    expect((connectWallet.mock.calls[0] as unknown[])[0]).toEqual({ name: 'Phantom' });
  });

  /*
    The defect this window exists for.

    A wallet authorising several addresses sets `accountChoice`, and only `SignIn` ever rendered
    that picker — so on the feed and `/explore`, which carry no sign-in panel, approving in Slush
    led to nothing at all while single-address Phantom appeared to work. The picker now lives with
    the control that started the flow, so it has a host on every route.
  */
  it('hosts the address picker itself, on a page with no sign-in panel', async () => {
    wallets = [{ name: 'Slush' }];
    accountChoice = {
      wallet: { name: 'Slush' },
      accounts: [
        { address: '0x' + '1'.repeat(64) },
        { address: '0x' + '2'.repeat(64), label: 'Savings' },
      ],
    };
    render(<AccountMenu />);

    // Opens on its own: the reader approved inside the extension, not in this tab.
    const first = await screen.findByRole('button', { name: new RegExp('0x1{64}') });
    fireEvent.click(first);
    expect(chooseAccount).toHaveBeenCalledOnce();
  });

  it('shows in full every address offered, so two can be told apart', async () => {
    wallets = [{ name: 'Slush' }];
    accountChoice = {
      wallet: { name: 'Slush' },
      accounts: [{ address: '0x' + 'a'.repeat(64) }, { address: '0x' + 'b'.repeat(64) }],
    };
    render(<AccountMenu />);

    // Never abbreviated: two addresses shortened to the same six characters are the same button.
    expect(await screen.findByText('0x' + 'a'.repeat(64))).toBeTruthy();
    expect(screen.getByText('0x' + 'b'.repeat(64))).toBeTruthy();
  });

  /*
    What the wallet said, where the reader is looking.

    `error` was recorded by the provider and rendered only by `SignIn`, so a refusal from the
    header produced nothing whatsoever on the two routes with no sign-in panel on them.
  */
  it("shows the wallet's own refusal rather than swallowing it", async () => {
    wallets = [{ name: 'Slush' }];
    walletError = 'User rejected the request.';
    render(<AccountMenu />);
    await openConnect();

    expect(screen.getByText('User rejected the request.')).toBeTruthy();
  });

  it('offers a way forward when no wallet is installed', async () => {
    render(<AccountMenu />);
    await openConnect();

    expect(screen.getByText(/no sui wallet in this browser/i)).toBeTruthy();
    const google = screen.getByRole('link', { name: /google/i });
    expect(google.getAttribute('href')).toBe('/signin?next=%2F');
  });

  /*
    The window must not render inside the header.

    `.appbar` carries `backdrop-filter`, and a filtered ancestor becomes the containing block for
    `position: fixed` children — so a window rendered in place sized itself to a 60px bar and was
    clipped out of sight while every DOM assertion about it still passed. Only its *parentage* can
    catch that, which is why this asserts where the node lives rather than that it exists.
  */
  it('renders the window outside the header, not within it', async () => {
    wallets = [{ name: 'Slush' }];
    const { container } = render(<AccountMenu />);
    await openConnect();

    const dialog = screen.getByRole('dialog');
    expect(container.contains(dialog)).toBe(false);
    expect(document.body.contains(dialog)).toBe(true);
  });

  it('closes on Escape', async () => {
    wallets = [{ name: 'Slush' }];
    render(<AccountMenu />);
    await openConnect();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens on click and puts focus on the first item', async () => {
    signer = ZK;
    render(<AccountMenu />);
    const trigger = await openMenu();

    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const items = screen.getAllByRole('menuitem');
    await waitFor(() => expect(document.activeElement).toBe(items[0]));
  });

  it('closes on Escape and returns focus to the trigger', async () => {
    signer = ZK;
    render(<AccountMenu />);
    const trigger = await openMenu();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('menu')).toBeNull();
    // The half that is invisible when wrong: focus must not be left on the removed element.
    await waitFor(() => expect(document.activeElement).toBe(trigger));
  });

  it('moves between items with the arrow keys', async () => {
    signer = ZK;
    render(<AccountMenu />);
    await openMenu();

    const menu = screen.getByRole('menu');
    const items = screen.getAllByRole('menuitem');
    await waitFor(() => expect(document.activeElement).toBe(items[0]));

    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);

    // Wraps rather than stopping, so Up from the top reaches the last item.
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(items[items.length - 1]);
  });

  /*
    Recovery is the route to the salt. A wallet session has no salt and never depended on this
    deployment, so offering it there would imply a risk that user does not carry.
  */
  it('offers recovery to a Google session', async () => {
    signer = ZK;
    render(<AccountMenu />);
    await openMenu();
    const item = screen.getByRole('menuitem', { name: 'Recovery details' });
    expect(item.getAttribute('href')).toBe('/account/recovery');
  });

  it('does not offer recovery to a wallet session', async () => {
    signer = WALLET;
    render(<AccountMenu />);
    await openMenu();
    expect(screen.queryByRole('menuitem', { name: 'Recovery details' })).toBeNull();
  });

  it('shows the address in full, so it can be checked against an explorer', async () => {
    signer = ZK;
    render(<AccountMenu />);
    await openMenu();
    expect(screen.queryByText(ZK.address)).not.toBeNull();
  });

  it('signs out', async () => {
    signer = WALLET;
    render(<AccountMenu />);
    await openMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    expect(signOut).toHaveBeenCalledOnce();
  });
});

/*
  The `AppHeader` block that stood here is gone with the component.

  `AccountMenu` and `safeNext` above are untouched: both are still mounted, and `AccountMenu` is
  now the only account control in the product.
*/
