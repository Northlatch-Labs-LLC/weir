// @vitest-environment happy-dom
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

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

let signer: { address: string; label: string; kind: 'zklogin' | 'wallet' } | null = null;
const signOut = vi.fn();
const signInWithGoogle = vi.fn();
let zkAvailable = true;
let wallets: { name: string }[] = [];
const connectWallet = vi.fn();
let accountChoice: { wallet: { name: string }; accounts: { address: string; label?: string }[] } | null = null;
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

afterEach(() => cleanup());

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

  it('refuses an absolute URL', () => {
    expect(safeNext('https://evil.example/steal')).toBe('/');
    expect(safeNext('http://evil.example')).toBe('/');
  });

  it('refuses a protocol-relative URL', () => {
    expect(safeNext('//evil.example/steal')).toBe('/');
  });
});

describe('AccountMenu', () => {
  async function openConnect(): Promise<void> {
    fireEvent.click(await screen.findByRole('button', { name: /connect/i }));
  }

  it('offers a single connect control however many wallets are installed', async () => {
    wallets = [{ name: 'Slush' }, { name: 'Phantom' }];
    render(<AccountMenu />);

    await screen.findByRole('button', { name: /connect/i });
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

    expect(await screen.findByText('0x' + 'a'.repeat(64))).toBeTruthy();
    expect(screen.getByText('0x' + 'b'.repeat(64))).toBeTruthy();
  });

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

    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    fireEvent.keyDown(menu, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(items[items.length - 1]);
  });

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
