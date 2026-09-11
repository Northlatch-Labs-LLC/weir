// @vitest-environment happy-dom
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const account = (address: string, label?: string) => ({
  address,
  label,
  publicKey: new Uint8Array(),
  chains: ['sui:mainnet'],
  features: [],
});

const A = account('0x' + 'a'.repeat(64), 'Trading');
const B = account('0x' + 'b'.repeat(64));

const WALLET = {
  name: 'Test Wallet',
  chains: ['sui:mainnet'],
  features: ['standard:connect', 'sui:signTransaction', 'sui:signPersonalMessage'],
  accounts: [] as unknown[],
};

let currentWallet: unknown = null;
let currentAccount: unknown = null;
let connectResult: { accounts: unknown[] } = { accounts: [] };
const connect = vi.fn(async () => connectResult);
const disconnect = vi.fn(async () => undefined);
const switchAccount = vi.fn();
const order: string[] = [];

function walletWith(accounts: unknown[]) {
  return { ...WALLET, accounts };
}

const kit = {
  connectWallet: async () => {
    order.push('connect');
    return connect();
  },
  disconnectWallet: async () => {
    order.push('disconnect');
    return disconnect();
  },
  switchAccount,
};

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@mysten/dapp-kit-react', () => ({
  DAppKitProvider: ({ children }: { children: React.ReactNode }) => children,
  useDAppKit: () => kit,
  useWallets: () => [WALLET],
  useCurrentAccount: () => currentAccount,
  useCurrentWallet: () => currentWallet,
}));
vi.mock('@mysten/dapp-kit-core', () => ({
  createDAppKit: () => kit,
  CurrentAccountSigner: class {},
}));
vi.mock('@mysten/sui/grpc', () => ({ SuiGrpcClient: class {} }));

const { SignerProvider, useSigner } = await import('../components/SignerProvider');
const { SESSION_STORAGE_KEY } = await import('../lib/zklogin');

function Probe() {
  const s = useSigner();
  return (
    <div>
      <span data-testid="address">{s.signer?.address ?? 'none'}</span>
      <span data-testid="choice">{s.accountChoice === null ? 'closed' : 'open'}</span>
      <span data-testid="choice-accounts">
        {(s.accountChoice?.accounts ?? []).map((a) => a.address).join(',')}
      </span>
      <span data-testid="reported">
        {s.walletAccounts === null ? 'null' : s.walletAccounts.map((a) => a.address).join(',')}
      </span>
      <span data-testid="error">{s.error ?? 'none'}</span>
      <button type="button" onClick={() => void s.connectWallet(WALLET as never)}>
        connect
      </button>
      <button type="button" onClick={() => s.chooseAccount(B as never)}>
        choose B
      </button>
      <button type="button" onClick={() => s.cancelAccountChoice()}>
        cancel
      </button>
      <button type="button" onClick={() => s.reopenAccountChoice()}>
        reopen
      </button>
      <button type="button" onClick={() => void s.reauthorizeWallet()}>
        reauthorize
      </button>
      <button type="button" onClick={() => s.signOut()}>
        sign out
      </button>
    </div>
  );
}

function mount(network: string | null = 'mainnet') {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ network: 'mainnet', available: false }),
    })),
  );
  return render(
    <SignerProvider network={network} rpcUrl="http://127.0.0.1:9000">
      <Probe />
    </SignerProvider>,
  );
}

const press = async (label: string) => {
  screen.getByText(label).click();
  await waitFor(() => undefined);
};

beforeEach(() => {
  currentWallet = null;
  currentAccount = null;
  connectResult = { accounts: [] };
  connect.mockClear();
  disconnect.mockClear();
  switchAccount.mockClear();
  order.length = 0;
  window.sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('several authorised addresses are a question, not a guess', () => {
  it('says nothing when the wallet authorised one', async () => {
    connectResult = { accounts: [A] };
    mount();
    await press('connect');
    expect(screen.getByTestId('choice').textContent).toBe('closed');
  });

  it('asks which, when the wallet authorised several', async () => {
    connectResult = { accounts: [A, B] };
    currentWallet = walletWith([A, B]);
    mount();
    await press('connect');
    expect(screen.getByTestId('choice').textContent).toBe('open');
    expect(screen.getByTestId('choice-accounts').textContent).toBe(`${A.address},${B.address}`);
  });

  it('switches to the address the reader picked, and closes the question', async () => {
    connectResult = { accounts: [A, B] };
    currentWallet = walletWith([A, B]);
    mount();
    await press('connect');
    await press('choose B');
    expect(switchAccount).toHaveBeenCalledWith({ account: B });
    expect(screen.getByTestId('choice').textContent).toBe('closed');
  });

  it('lets the reader back out without switching to anything', async () => {
    connectResult = { accounts: [A, B] };
    currentWallet = walletWith([A, B]);
    mount();
    await press('connect');
    await press('cancel');
    expect(screen.getByTestId('choice').textContent).toBe('closed');
    expect(switchAccount).not.toHaveBeenCalled();
  });
});

describe('reopening the choice', () => {
  it('offers every address the wallet currently authorises', async () => {
    currentWallet = walletWith([A, B]);
    currentAccount = A;
    mount();
    await press('reopen');
    expect(screen.getByTestId('choice-accounts').textContent).toBe(`${A.address},${B.address}`);
  });

  it('says so rather than opening an empty question when no wallet is connected', async () => {
    mount();
    await press('reopen');
    expect(screen.getByTestId('choice').textContent).toBe('closed');
    expect(screen.getByTestId('error').textContent).toContain('no wallet is connected');
  });
});

describe('asking the extension again', () => {
  it('disconnects first, because a connected wallet answers from cache and shows nothing', async () => {
    currentWallet = walletWith([A]);
    currentAccount = A;
    connectResult = { accounts: [A] };
    mount();
    await press('reauthorize');
    expect(order).toEqual(['disconnect', 'connect']);
  });

  it('says so when there is no wallet to ask', async () => {
    mount();
    await press('reauthorize');
    expect(screen.getByTestId('error').textContent).toContain('no wallet is connected');
    expect(connect).not.toHaveBeenCalled();
  });
});

describe('what the provider reports about the wallet', () => {
  it('reports no addresses at all when no wallet is connected', async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId('reported').textContent).toBe('null'));
  });

  it('reports every address the wallet authorises, not only the bound one', async () => {
    currentWallet = walletWith([A, B]);
    currentAccount = A;
    mount();
    await waitFor(() =>
      expect(screen.getByTestId('reported').textContent).toBe(`${A.address},${B.address}`),
    );
  });

  it('signs as the account the kit reports as current', async () => {
    currentWallet = walletWith([A]);
    currentAccount = A;
    mount();
    await waitFor(() => expect(screen.getByTestId('address').textContent).toBe(A.address));
  });
});

describe('a deployment that does not know its network signs nothing', () => {
  it('builds no signer, even with a wallet and an account connected', async () => {
    currentWallet = walletWith([A]);
    currentAccount = A;
    mount(null);
    await waitFor(() => expect(screen.getByTestId('reported').textContent).toBe(A.address));
    expect(screen.getByTestId('address').textContent).toBe('none');
  });

  it('refuses to connect, and says why, rather than connecting into nothing', async () => {
    mount(null);
    await press('connect');
    expect(connect).not.toHaveBeenCalled();
    expect(screen.getByTestId('error').textContent).toContain('which network it is on');
  });
});

describe('signing out', () => {
  it('disconnects the wallet, clears the Google session, and tells the server', async () => {
    currentWallet = walletWith([A]);
    currentAccount = A;
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, '{"maxEpoch":1}');
    mount();
    await press('sign out');

    expect(disconnect).toHaveBeenCalled();
    expect(window.sessionStorage.getItem(SESSION_STORAGE_KEY)).toBeNull();
    const calls = (globalThis.fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    expect(
      calls.some(
        ([url, init]) =>
          url === '/api/session' && (init as { method?: string } | undefined)?.method === 'DELETE',
      ),
    ).toBe(true);
  });
});
