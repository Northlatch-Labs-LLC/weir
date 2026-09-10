// @vitest-environment happy-dom
// Built-by: @projectx.sui · Co-authored-by: Claude
/**
 * Connecting is not signing in, and the difference is what these pin.
 *
 * # The defect
 *
 * A wallet sharing an address grants nothing here. What grants anything is a signature over the
 * read-content statement, which mints a session the server can answer as. That signature was asked
 * for once, from an effect, ending in `catch {}` — so a reader who declined it, or whose wallet
 * errored, was left connected and unproved with NO trace of it anywhere in the application. Their
 * own paid posts rendered locked, the account menu said "signed in", and no control on any screen
 * would ask a second time. The whole recovery path was guessing that a reload might help.
 *
 * So the proof is a state now, and these are the transitions worth holding still: that a signature
 * is not requested when the server already has one, that a refusal is recorded rather than
 * swallowed, that pressing confirm asks again, and that switching address stops the previous
 * address's proof from speaking for the new one.
 */

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const WALLET = {
  name: 'Test Wallet',
  chains: ['sui:mainnet'],
  features: ['standard:connect', 'sui:signTransaction', 'sui:signPersonalMessage'],
  accounts: [] as unknown[],
};
const A = { address: `0x${'a'.repeat(64)}`, chains: ['sui:mainnet'], features: [], publicKey: new Uint8Array() };
const B = { address: `0x${'b'.repeat(64)}`, chains: ['sui:mainnet'], features: [], publicKey: new Uint8Array() };

let currentAccount: unknown = null;
let currentWallet: unknown = null;

/** What the kit's signer does when asked for a personal message. Swapped per test. */
let signPersonalMessage: (bytes?: Uint8Array) => Promise<{ signature: string }> =
  vi.fn(async () => ({ signature: 'sig' }));
let signCalls = 0;

vi.mock('@mysten/dapp-kit-react', () => ({
  DAppKitProvider: ({ children }: { children: React.ReactNode }) => children,
  useDAppKit: () => ({ connectWallet: vi.fn(), disconnectWallet: vi.fn(), switchAccount: vi.fn() }),
  useWallets: () => [WALLET],
  useCurrentAccount: () => currentAccount,
  useCurrentWallet: () => currentWallet,
}));
vi.mock('@mysten/dapp-kit-core', () => ({
  createDAppKit: () => ({}),
  CurrentAccountSigner: class {
    signTransaction = vi.fn();
    signPersonalMessage = (bytes: Uint8Array) => {
      signCalls += 1;
      return signPersonalMessage(bytes);
    };
  },
}));
vi.mock('@mysten/sui/grpc', () => ({ SuiGrpcClient: class {} }));

const refresh = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh, replace: vi.fn() }),
  usePathname: () => '/',
}));

const { SignerProvider, useSigner } = await import('../components/SignerProvider');

function Probe() {
  const { proof, proveSession, signer } = useSigner();
  return (
    <div>
      <span data-testid="proof">{proof}</span>
      <span data-testid="address">{signer?.address ?? 'none'}</span>
      <button type="button" onClick={() => void proveSession()}>
        confirm
      </button>
    </div>
  );
}

/**
 * The server's answers, in order. `zklogin/session` is asked for first by the provider's own
 * startup effect, so every script begins with it.
 */
function serve(...sessionAnswers: unknown[]) {
  let at = 0;
  const fetchMock = vi.fn(async (url: string, init?: { method?: string }) => {
    if (String(url).includes('zklogin/session')) {
      return { ok: true, status: 200, json: async () => ({ network: 'mainnet', available: false }) };
    }
    if (String(url) === '/api/session' && init?.method === 'POST') {
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    }
    const answer = sessionAnswers[Math.min(at, sessionAnswers.length - 1)];
    at += 1;
    return { ok: true, status: 200, json: async () => answer };
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const mount = () =>
  render(
    <SignerProvider network="mainnet" rpcUrl="http://127.0.0.1:9000">
      <Probe />
    </SignerProvider>,
  );

beforeEach(() => {
  currentAccount = null;
  currentWallet = null;
  refresh.mockClear();
  signPersonalMessage = vi.fn(async () => ({ signature: 'sig' }));
  signCalls = 0;
  window.sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('a session the server already holds', () => {
  it('is proved without asking the wallet for anything', async () => {
    /*
      The reason the check comes before the signature. A wallet prompt on every reload is a prompt
      people learn to approve without reading, and this application asks for exactly one signature
      that matters.
    */
    currentWallet = WALLET;
    currentAccount = A;
    serve({ checked: true, reader: A.address });
    mount();

    await waitFor(() => expect(screen.getByTestId('proof').textContent).toBe('proved'));
    expect(signCalls).toBe(0);
  });

  it('matches the address case-insensitively, so a checksum spelling is not a different person', async () => {
    currentWallet = WALLET;
    currentAccount = A;
    serve({ checked: true, reader: A.address.toUpperCase().replace('0X', '0x') });
    mount();

    await waitFor(() => expect(screen.getByTestId('proof').textContent).toBe('proved'));
    expect(signCalls).toBe(0);
  });
});

describe('a session the server does not hold', () => {
  it('asks the wallet to sign, and is proved once the server accepts it', async () => {
    currentWallet = WALLET;
    currentAccount = A;
    serve({ checked: true, reader: null });
    mount();

    await waitFor(() => expect(screen.getByTestId('proof').textContent).toBe('proved'));
    expect(signCalls).toBeGreaterThan(0);
    // Entitlement is resolved on the server, so the proof only takes effect on the next render.
    // Without this the reader sits looking at their own paid posts, locked.
    expect(refresh).toHaveBeenCalled();
  });

  it('records a refused signature instead of swallowing it', async () => {
    /*
      This is the whole defect. The old code was `catch {}` inside an effect: a reader who declined
      got no signal at all, and there was no control anywhere that would ask again.
    */
    currentWallet = WALLET;
    currentAccount = A;
    signPersonalMessage = vi.fn(async () => {
      throw new Error('User rejected the request');
    });
    serve({ checked: true, reader: null });
    mount();

    await waitFor(() => expect(screen.getByTestId('proof').textContent).toBe('declined'));
  });

  it('does not re-prompt a reader who refused', async () => {
    // A refusal is a decision. Asking again on its own is how a wallet prompt becomes something
    // people dismiss without reading, which is the opposite of what this signature is for.
    currentWallet = WALLET;
    currentAccount = A;
    signPersonalMessage = vi.fn(async () => {
      throw new Error('User rejected the request');
    });
    serve({ checked: true, reader: null });
    mount();

    await waitFor(() => expect(screen.getByTestId('proof').textContent).toBe('declined'));
    const asked = signCalls;
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(signCalls).toBe(asked);
  });

  it('asks again when the reader presses confirm', async () => {
    // The recovery path that did not exist. Pressing it is the reader deciding, which is the only
    // thing that should re-open a wallet prompt after a refusal.
    currentWallet = WALLET;
    currentAccount = A;
    let fail = true;
    signPersonalMessage = vi.fn(async () => {
      if (fail) throw new Error('User rejected the request');
      return { signature: 'sig' };
    });
    serve({ checked: true, reader: null });
    mount();

    await waitFor(() => expect(screen.getByTestId('proof').textContent).toBe('declined'));
    fail = false;
    screen.getByText('confirm').click();
    await waitFor(() => expect(screen.getByTestId('proof').textContent).toBe('proved'));
  });
});

describe('an unreadable session is not an absent one', () => {
  it('does not raise a wallet prompt when the server could not look', async () => {
    /*
      `checked: false` means the server failed to read its own store. Treating that as "you have no
      session" would ask for a signature to replace a session that is probably intact.
    */
    currentWallet = WALLET;
    currentAccount = A;
    serve({ checked: false });
    mount();

    await waitFor(() => expect(screen.getByTestId('proof').textContent).toBe('unproved'));
    expect(signCalls).toBe(0);
  });
});

describe('switching address', () => {
  it('proves the new address rather than carrying the old one’s proof across', async () => {
    /*
      Switching account inside the extension changes who is connected while the server's cookie
      still names the address before it. Carrying `proved` across is how a reader ends up on
      another of their own accounts being told the posts they paid for are locked, with the chrome
      insisting they are signed in.

      What is asserted is the signature, not the label: the state passes through `unknown` too
      quickly to catch, and "it asked the wallet again" is the thing that actually distinguishes a
      fresh proof from a stale one being reused.
    */
    currentWallet = WALLET;
    currentAccount = A;
    serve({ checked: true, reader: A.address });
    const { rerender } = mount();
    await waitFor(() => expect(screen.getByTestId('proof').textContent).toBe('proved'));
    expect(signCalls).toBe(0);

    currentAccount = B;
    rerender(
      <SignerProvider network="mainnet" rpcUrl="http://127.0.0.1:9000">
        <Probe />
      </SignerProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('address').textContent).toBe(B.address));
    await waitFor(() => expect(signCalls).toBeGreaterThan(0));
  });
});
