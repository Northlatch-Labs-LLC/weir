// @vitest-environment happy-dom
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

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
    expect(refresh).toHaveBeenCalled();
  });

  it('records a refused signature instead of swallowing it', async () => {
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
