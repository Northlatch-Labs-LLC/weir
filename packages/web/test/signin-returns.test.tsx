// @vitest-environment happy-dom
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
/**
 * The sign-in page returns the reader to where they were going — once they are signed in.
 *
 * # The first defect
 *
 * `/signin?next=/c/heron` sanitised that parameter through `safeNext`, which six assertions
 * covered, handed it to this component as `nextPath`, printed "After signing in you return to
 * /c/heron" on the screen — and then, on the wallet branch, called `connectWallet` and stopped. The
 * reader approved in their extension and sat on the sign-in page with nothing happening.
 *
 * # The second defect
 *
 * Fixed, the page left the moment a signer existed. The feed asks the server for a proved
 * session, and the server had none: the signature request was still open in the reader's wallet.
 * The feed sent them back here, this page sent them to the feed, and the two pages traded a reader
 * hundreds of times a minute until they signed or closed the tab. So the page waits for the proof,
 * then asks the server the question the destination will ask, and only then goes.
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/signin',
}));

const WALLET = { name: 'Test Wallet', icon: undefined };
const ADDRESS = `0x${'a'.repeat(64)}`;
const SIGNER = { kind: 'wallet' as const, address: ADDRESS, label: 'Test Wallet' };

let signer: unknown = null;
let accountChoice: unknown = null;
let proof: 'unknown' | 'checking' | 'proved' | 'unproved' | 'declined' = 'unknown';
const connectWallet = vi.fn();
const signInWithGoogle = vi.fn();
const proveSession = vi.fn();

vi.mock('@/components/SignerProvider', () => ({
  useSigner: () => ({
    ready: true,
    wake: () => {},
    wallets: [WALLET],
    unusableWallets: [],
    signInWithGoogle,
    connectWallet,
    signer,
    accountChoice,
    proof,
    proveSession,
  }),
}));

const { SigninPanel } = await import('../components/app/SigninPanel');

/* What the server says it holds for this browser. */
let serverReader: string | null = ADDRESS;
beforeEach(() => {
  signer = null;
  accountChoice = null;
  proof = 'unknown';
  serverReader = ADDRESS;
  replace.mockClear();
  connectWallet.mockClear();
  signInWithGoogle.mockClear();
  proveSession.mockClear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ checked: true, reader: serverReader }) }) as Response),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function settled() {
  await new Promise((resolve) => setTimeout(resolve, 30));
}

describe('a wallet that connects', () => {
  it('does not navigate while nobody has signed in', async () => {
    render(<SigninPanel nextPath="/c/heron" />);
    await settled();
    expect(replace).not.toHaveBeenCalled();
  });

  it('returns the reader to `next` once the session is proved and the server agrees', async () => {
    const view = render(<SigninPanel nextPath="/c/heron" />);
    signer = SIGNER;
    proof = 'proved';
    view.rerender(<SigninPanel nextPath="/c/heron" />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/c/heron'));
  });

  it('goes to the feed when no destination was asked for', async () => {
    const view = render(<SigninPanel />);
    signer = SIGNER;
    proof = 'proved';
    view.rerender(<SigninPanel />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/feed'));
  });

  it('waits while the wallet is still asking which address to use', async () => {
    /*
      A wallet holding several addresses raises `accountChoice`. Navigating out from under that
      question picks one on the reader's behalf, which is the defect the picker exists to prevent.
    */
    const view = render(<SigninPanel nextPath="/c/heron" />);
    signer = SIGNER;
    proof = 'proved';
    accountChoice = { wallet: WALLET, accounts: [] };
    view.rerender(<SigninPanel nextPath="/c/heron" />);
    await settled();
    expect(replace).not.toHaveBeenCalled();

    accountChoice = null;
    view.rerender(<SigninPanel nextPath="/c/heron" />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/c/heron'));
  });
});

describe('a wallet that has connected but not yet proved the session', () => {
  it('stays, and says the signature request is what it is waiting for', async () => {
    signer = SIGNER;
    proof = 'checking';
    render(<SigninPanel nextPath="/feed" />);
    await settled();
    expect(replace).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toContain('Confirm this account in Test Wallet');
  });

  it('stays when the reader declined, and offers to ask again', async () => {
    signer = SIGNER;
    proof = 'declined';
    render(<SigninPanel nextPath="/feed" />);
    await settled();
    expect(replace).not.toHaveBeenCalled();
    screen.getByRole('button', { name: 'Confirm this account' }).click();
    expect(proveSession).toHaveBeenCalledTimes(1);
  });

  it('leaves the moment the proof lands', async () => {
    signer = SIGNER;
    proof = 'checking';
    const view = render(<SigninPanel nextPath="/feed" />);
    await settled();
    expect(replace).not.toHaveBeenCalled();
    proof = 'proved';
    view.rerender(<SigninPanel nextPath="/feed" />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/feed'));
  });

  it('cannot loop: when the server does not hold the session it stops here and says why', async () => {
    signer = SIGNER;
    proof = 'proved';
    serverReader = null;
    render(<SigninPanel nextPath="/feed" />);
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('did not keep the sign-in'));
    expect(replace).not.toHaveBeenCalled();
  });
});

describe('what the page tells the reader', () => {
  it('names the destination it is going to send them to', () => {
    // The sentence and the behaviour come from the same value, so they cannot disagree again.
    render(<SigninPanel nextPath="/c/heron" />);
    expect(screen.getByText('/c/heron')).toBeTruthy();
  });
});

describe('the Google path', () => {
  it('hands the same destination to the sign-in it starts', () => {
    render(<SigninPanel nextPath="/c/heron" />);
    screen.getByText('Continue with Google').click();
    expect(signInWithGoogle).toHaveBeenCalledWith('/c/heron');
  });
});
