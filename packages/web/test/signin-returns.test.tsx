// @vitest-environment happy-dom
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
/**
 * The sign-in page returns the reader to where they were going.
 *
 * # The defect
 *
 * `/signin?next=/c/heron` sanitised that parameter through `safeNext`, which six assertions
 * covered, handed it to this component as `nextPath`, printed "After signing in you return to
 * /c/heron" on the screen — and then, on the wallet branch, called `connectWallet` and stopped. The
 * reader approved in their extension and sat on the sign-in page with nothing happening.
 *
 * Six tests proved the string was safe. None proved it was used. That is the shape worth pinning:
 * a helper fully covered, its output discarded, and a sentence on screen promising the discarded
 * behaviour.
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/signin',
}));

const WALLET = { name: 'Test Wallet', icon: undefined };
const SIGNER = { kind: 'wallet' as const, address: `0x${'a'.repeat(64)}`, label: 'Test Wallet' };

let signer: unknown = null;
let accountChoice: unknown = null;
const connectWallet = vi.fn();
const signInWithGoogle = vi.fn();

vi.mock('@/components/SignerProvider', () => ({
  useSigner: () => ({
    wallets: [WALLET],
    unusableWallets: [],
    signInWithGoogle,
    connectWallet,
    signer,
    accountChoice,
  }),
}));

const { DesignSignin } = await import('../components/design/Signin');

beforeEach(() => {
  signer = null;
  accountChoice = null;
  replace.mockClear();
  connectWallet.mockClear();
  signInWithGoogle.mockClear();
});
afterEach(cleanup);

describe('a wallet that connects', () => {
  it('does not navigate while nobody has signed in', () => {
    render(<DesignSignin nextPath="/c/heron" />);
    expect(replace).not.toHaveBeenCalled();
  });

  it('returns the reader to `next` once there is a signer', async () => {
    const view = render(<DesignSignin nextPath="/c/heron" />);
    signer = SIGNER;
    view.rerender(<DesignSignin nextPath="/c/heron" />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/c/heron'));
  });

  it('goes home when no destination was asked for', async () => {
    const view = render(<DesignSignin />);
    signer = SIGNER;
    view.rerender(<DesignSignin />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
  });

  it('waits while the wallet is still asking which address to use', async () => {
    /*
      A wallet holding several addresses raises `accountChoice`. Navigating out from under that
      question picks one on the reader's behalf, which is the defect the picker exists to prevent.
    */
    const view = render(<DesignSignin nextPath="/c/heron" />);
    signer = SIGNER;
    accountChoice = { wallet: WALLET, accounts: [] };
    view.rerender(<DesignSignin nextPath="/c/heron" />);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(replace).not.toHaveBeenCalled();

    accountChoice = null;
    view.rerender(<DesignSignin nextPath="/c/heron" />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/c/heron'));
  });
});

describe('what the page tells the reader', () => {
  it('names the destination it is going to send them to', () => {
    // The sentence and the behaviour come from the same value, so they cannot disagree again.
    render(<DesignSignin nextPath="/c/heron" />);
    expect(screen.getByText('/c/heron')).toBeTruthy();
  });
});

describe('the Google path', () => {
  it('hands the same destination to the sign-in it starts', () => {
    render(<DesignSignin nextPath="/c/heron" />);
    screen.getByText('Continue with Google').click();
    expect(signInWithGoogle).toHaveBeenCalledWith('/c/heron');
  });
});
