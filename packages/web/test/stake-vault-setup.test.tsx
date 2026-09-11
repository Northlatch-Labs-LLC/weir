// @vitest-environment happy-dom
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let signer: { address: string; kind: string; label: string; signTransaction: ReturnType<typeof vi.fn> } | null = null;
vi.mock('@/components/SignerProvider', () => ({ useSigner: () => ({ signer }) }));
vi.mock('@/components/SignIn', () => ({ SignIn: () => <div>sign in</div> }));

const { StakeVaultSetup } = await import('../components/StakeVaultSetup');

const VAULT = {
  vaultId: '0xv', creator: '0xc', handle: null, validator: '0xval', accepting: true,
  totalPrincipalMist: '2000000000', liquidMist: '1000000000', stakedMist: '1000000000',
  tranches: 1, lifetimeYieldMist: '0', harvests: '0', creatorYieldMist: '0',
  rebatePoolMist: '0', rebateBps: '2000', solvent: true,
};

function mockRoutes(owner: unknown, vault: unknown = { vault: VAULT }) {
  const fetchMock = vi.fn(async (url: string) => ({
    ok: true, status: 200,
    json: async () => (String(url).includes('owner=') ? owner : vault),
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  signer = { address: '0xda78', kind: 'wallet', label: 'W', signTransaction: vi.fn(async () => 'sig') };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('opening a vault', () => {
  it('offers the form to a creator who holds no stake cap', async () => {
    mockRoutes({ stakeCaps: [] });
    render(<StakeVaultSetup accountId="0xacc" />);
    await waitFor(() => expect(screen.getByText(/Open a support vault/i)).toBeTruthy());
  });

  it('says the validator can never be changed, before it is chosen', async () => {
    mockRoutes({ stakeCaps: [] });
    render(<StakeVaultSetup accountId="0xacc" />);
    await waitFor(() => expect(screen.getByText(/PERMANENT, CANNOT BE CHANGED LATER/i)).toBeTruthy());
  });

  it('explains why supporters say yes to this', async () => {
    mockRoutes({ stakeCaps: [] });
    render(<StakeVaultSetup accountId="0xacc" />);
    await waitFor(() =>
      expect(screen.getByText(/withdraw all of it whenever they like/i)).toBeTruthy(),
    );
  });
});

describe('a vault that exists', () => {
  it('warns that the principal is not the creator’s money', async () => {
    mockRoutes({ stakeCaps: [{ capId: '0xcap', vaultId: '0xv' }] });
    render(<StakeVaultSetup accountId="0xacc" />);
    await waitFor(() => expect(screen.getByText(/not yours/i)).toBeTruthy());
    expect(screen.getByText(/Only the yield column is your revenue/i)).toBeTruthy();
  });

  it('shows the supporters’ share as a percentage of yield', async () => {
    mockRoutes({ stakeCaps: [{ capId: '0xcap', vaultId: '0xv' }] });
    render(<StakeVaultSetup accountId="0xacc" />);
    await waitFor(() => expect(screen.getByText('20%')).toBeTruthy());
  });

  it('calls zero realised yield a measured zero, not a failed read', async () => {
    mockRoutes({ stakeCaps: [{ capId: '0xcap', vaultId: '0xv' }] });
    render(<StakeVaultSetup accountId="0xacc" />);
    await waitFor(() => expect(screen.getByText(/measured\s+zero, not a failed read/i)).toBeTruthy());
  });
});

describe('states that are not a conclusion', () => {
  it('does not offer the open form when the cap lookup could not be read', async () => {
    mockRoutes({ error: 'the chain could not be read' });
    render(<StakeVaultSetup accountId="0xacc" />);
    await waitFor(() => expect(screen.getByText(/could not be read/i)).toBeTruthy());
    expect(screen.queryByText(/Open a support vault/i)).toBeNull();
  });

  it('says it is reading rather than offering to open a second vault', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)));
    render(<StakeVaultSetup accountId="0xacc" />);
    await waitFor(() => expect(screen.getByText(/Reading the chain/i)).toBeTruthy());
    expect(screen.queryByText(/Open a support vault/i)).toBeNull();
  });
});

describe('holding more than one support vault', () => {
  const TWO = [
    { capId: '0xcap1', vaultId: '0xv' },
    { capId: '0xcap2', vaultId: '0xw' },
  ];

  it('offers every vault, not just the first', async () => {
    mockRoutes({ stakeCaps: TWO });
    render(<StakeVaultSetup accountId="0xacc" />);

    const picker = await screen.findByLabelText(/SUPPORT VAULTS/i);
    expect(picker.querySelectorAll('option')).toHaveLength(2);
  });

  it('says how many there are, so a missing one is noticeable', async () => {
    mockRoutes({ stakeCaps: TWO });
    render(<StakeVaultSetup accountId="0xacc" />);

    await waitFor(() => expect(screen.getByText(/YOU HOLD 2 SUPPORT VAULTS/i)).toBeTruthy());
  });

  it('withholds the picker for a single vault, which has nothing to choose', async () => {
    mockRoutes({ stakeCaps: [TWO[0]] });
    render(<StakeVaultSetup accountId="0xacc" />);

    await waitFor(() => expect(screen.getByText(/Your support vault/i)).toBeTruthy());
    expect(screen.queryByLabelText(/SUPPORT VAULTS/i)).toBeNull();
  });
});
