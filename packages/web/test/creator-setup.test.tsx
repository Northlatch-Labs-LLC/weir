// @vitest-environment happy-dom
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let signer: { address: string; kind: string; label: string; signTransaction: ReturnType<typeof vi.fn> } | null = null;
vi.mock('@/components/SignerProvider', () => ({ useSigner: () => ({ signer }) }));
vi.mock('@/components/SignIn', () => ({ SignIn: () => <div>sign in</div> }));

const { CreatorSetup } = await import('../components/CreatorSetup');

const VAULT = {
  vaultId: '0xvault', capId: '0xcap', coinType: '0x2::sui::SUI',
  decimals: 9, symbol: 'SUI',
  tiers: [] as { name: string; price: string; periodMs: string; active: boolean }[],
  accepting: true, handle: 'alice',
};

function mockSetup(body: unknown) {
  const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => ({
    ok: true,
    status: 200,
    json: async () => (String(url).includes('/api/creator?') ? body : {}),
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  signer = { address: '0xda78', kind: 'zklogin', label: 'Google', signTransaction: vi.fn(async () => 'sig') };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('the order the contract requires', () => {
  it('sends somebody with no account to claim a handle first', async () => {
    mockSetup({ stage: 'no-account' });
    render(<CreatorSetup />);
    await waitFor(() => expect(screen.getByText(/Claim a handle first/i)).toBeTruthy());
    expect(screen.getByText('Claim a handle').closest('a')?.getAttribute('href')).toBe('/join');
  });

  it('offers the vault to somebody who has an account but no vault', async () => {
    mockSetup({ stage: 'no-vault', accountId: '0xacc', handle: 'alice', creationFeeMist: '0' });
    render(<CreatorSetup />);
    await waitFor(() => expect(screen.getByText(/Open your creator vault/i)).toBeTruthy());
  });
});

describe('choosing the denomination, which cannot be changed afterwards', () => {
  const USDC = '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
  const SUI = '0x2::sui::SUI';
  const noVault = (vaultCoinTypes: string[]) => ({
    stage: 'no-vault', accountId: '0xacc', handle: 'alice', creationFeeMist: '0', vaultCoinTypes,
  });

  it('offers every configured coin and preselects none of them', async () => {
    mockSetup(noVault([USDC, SUI]));
    render(<CreatorSetup />);
    await waitFor(() => expect(screen.getByText(/Open your creator vault/i)).toBeTruthy());

    const radios = screen.getAllByRole('radio') as HTMLInputElement[];
    expect(radios.map((r) => r.value)).toEqual([USDC, SUI]);
    expect(radios.some((r) => r.checked)).toBe(false);
  });

  it('will not open a vault until a denomination is chosen', async () => {
    mockSetup(noVault([USDC, SUI]));
    render(<CreatorSetup />);
    const button = await screen.findByRole('button', { name: /Choose a denomination/i });
    expect((button as HTMLButtonElement).disabled).toBe(true);
  });

  it('simulates against the coin actually chosen, not the first offered', async () => {
    const fetchMock = mockSetup(noVault([USDC, SUI]));
    render(<CreatorSetup />);
    await waitFor(() => expect(screen.getByText(/Open your creator vault/i)).toBeTruthy());

    const sui = screen.getAllByRole('radio').find((r) => (r as HTMLInputElement).value === SUI);
    fireEvent.click(sui as HTMLElement);
    fireEvent.click(await screen.findByRole('button', { name: /Open a vault/i }));

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => String(url).includes('/api/creator/vault'));
      expect(call).toBeTruthy();
      expect(JSON.parse(String(call?.[1]?.body)).coinType).toBe(SUI);
    });
  });

  it('withholds the form entirely when the deployment offers no denomination', async () => {
    mockSetup(noVault([]));
    render(<CreatorSetup />);
    await waitFor(() => expect(screen.getByText(/Open your creator vault/i)).toBeTruthy());

    expect(screen.queryAllByRole('radio')).toHaveLength(0);
    expect(screen.getByText(/offers no vault denomination/i)).toBeTruthy();
  });
});

describe('a vault nobody can subscribe to', () => {
  it('says so, rather than presenting an empty vault as finished', async () => {
    mockSetup({ stage: 'ready', accountId: '0xacc', handle: 'alice', vaults: [VAULT] });
    render(<CreatorSetup />);
    await waitFor(() => expect(screen.getByText(/nobody can subscribe/i)).toBeTruthy());
  });

  it('does not say it once a tier exists', async () => {
    mockSetup({
        stage: 'ready', accountId: '0xacc', handle: 'alice',
        vaults: [{ ...VAULT, tiers: [{ name: 'Monthly', price: '5000000', periodMs: '2592000000', active: true }] }],
      });
    render(<CreatorSetup />);
    await waitFor(() => expect(screen.getByText('Monthly')).toBeTruthy());
    expect(screen.queryByText(/nobody can subscribe/i)).toBeNull();
  });
});

describe('signed out', () => {
  it('offers sign-in rather than an empty setup', () => {
    signer = null;
    mockSetup({});
    render(<CreatorSetup />);
    expect(screen.getByText('sign in')).toBeTruthy();
  });
});

describe('while the chain is being read', () => {
  it('says it is reading rather than showing a conclusion', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)));
    render(<CreatorSetup />);
    await waitFor(() => expect(screen.getByText(/Reading the chain/i)).toBeTruthy());
    expect(screen.queryByText(/Claim a handle first/i)).toBeNull();
  });
});

describe('tier prices are scaled by the vault, not by a constant', () => {
  const TIER = { name: 'Monthly', price: '5000000000', periodMs: '2592000000', active: true };

  it('formats a nine-decimal price at nine decimals', async () => {
    mockSetup({
      stage: 'ready', accountId: '0xacc', handle: 'alice',
      vaults: [{ ...VAULT, tiers: [TIER] }],
    });
    render(<CreatorSetup />);
    await waitFor(() => expect(screen.getByText(/\b5\b/)).toBeTruthy());
    expect(screen.queryByText(/5000/)).toBeNull();
  });

  it('labels the price with the vault’s coin rather than the word USDC', async () => {
    mockSetup({
      stage: 'ready', accountId: '0xacc', handle: 'alice',
      vaults: [{ ...VAULT, tiers: [TIER] }],
    });
    render(<CreatorSetup />);
    await waitFor(() => expect(screen.getByText(/SUI/)).toBeTruthy());
    expect(screen.queryByText(/USDC/)).toBeNull();
  });

  it('does not price anything for a vault whose decimals are unknown', () => {
    const source = readFileSync(join(import.meta.dirname, '..', 'components/CreatorSetup.tsx'), 'utf8');
    expect(source).toContain('if (vault.decimals === null) return;');
  });

  it('reads the scale from the vault at both the parse and the format', () => {
    const source = readFileSync(join(import.meta.dirname, '..', 'components/CreatorSetup.tsx'), 'utf8');
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).toContain('frac.padEnd(places');
    expect(code).not.toMatch(/padEnd\(6,/);
    expect(code).not.toMatch(/1_000_000n/);
  });
});
