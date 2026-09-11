// @vitest-environment happy-dom
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let signer: { address: string; kind: string; label: string; signTransaction: ReturnType<typeof vi.fn> } | null = null;
vi.mock('@/components/SignerProvider', () => ({ useSigner: () => ({ signer }) }));
vi.mock('@/components/SignIn', () => ({ SignIn: () => <div>sign in</div> }));

const { StakePosition } = await import('../components/StakePosition');

const VAULT = {
  vaultId: '0xv', creator: '0xc', handle: 'alice', validator: '0xval', accepting: true,
  totalPrincipalMist: '2000000000', liquidMist: '1000000000', stakedMist: '1000000000',
  tranches: 1, lifetimeYieldMist: '0', harvests: '0', creatorYieldMist: '0',
  rebatePoolMist: '0', rebateBps: '2000', solvent: true,
};

function mockRoutes(routes: { stake?: { ok: boolean; body: unknown }; creator?: unknown }) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    if (String(url).includes('/api/stake?')) {
      const r = routes.stake ?? { ok: true, body: { vault: VAULT, position: null } };
      return { ok: r.ok, status: r.ok ? 200 : 503, json: async () => r.body };
    }
    return { ok: true, status: 200, json: async () => routes.creator ?? { accountId: '0xacc' } };
  }));
}

beforeEach(() => {
  signer = { address: '0xda78', kind: 'wallet', label: 'Test', signTransaction: vi.fn(async () => 'sig') };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('a failed read is never a zero balance', () => {
  it('says the vault is still loading, and does not show a figure', async () => {
    mockRoutes({ stake: { ok: false, body: { error: 'the node timed out' } } });
    render(<StakePosition vaultId="0xv" />);
    await waitFor(() => expect(screen.getByText(/Reading from the chain/i)).toBeTruthy());
    expect(screen.getByText(/deposit is held on chain/i)).toBeTruthy();
  });

  it('offers no withdraw button when it could not read the position', async () => {
    mockRoutes({ stake: { ok: false, body: { error: 'unreachable' } } });
    render(<StakePosition vaultId="0xv" />);
    await waitFor(() => expect(screen.getByText(/Reading from the chain/i)).toBeTruthy());
    expect(screen.queryByText('Withdraw')).toBeNull();
  });
});

describe('a measured absence is stated as one', () => {
  it('says the table was read and holds no entry, rather than showing nothing', async () => {
    mockRoutes({ stake: { ok: true, body: { vault: VAULT, position: null } } });
    render(<StakePosition vaultId="0xv" />);
    await waitFor(() => expect(screen.getByText(/have not deposited here/i)).toBeTruthy());
  });

  it('shows no withdraw control with nothing deposited', async () => {
    mockRoutes({ stake: { ok: true, body: { vault: VAULT, position: null } } });
    render(<StakePosition vaultId="0xv" />);
    await waitFor(() => expect(screen.getByText(/have not deposited here/i)).toBeTruthy());
    expect(screen.queryByText('Withdraw')).toBeNull();
  });
});

describe('principal and yield are never one figure', () => {
  it('shows them as separate numbers', async () => {
    mockRoutes({ stake: { ok: true, body: { vault: VAULT, position: { principalMist: '1000000000', pendingRebateMist: '250000000' } } } });
    render(<StakePosition vaultId="0xv" />);
    await waitFor(() => expect(screen.getByText(/Principal \(yours\)/i)).toBeTruthy());
    expect(screen.getByText(/Your share accrued/i)).toBeTruthy();
    expect(screen.queryByText('1.25')).toBeNull();
  });

  it('calls the accrued share a lower bound', async () => {
    mockRoutes({ stake: { ok: true, body: { vault: VAULT, position: { principalMist: '1000000000', pendingRebateMist: '1' } } } });
    render(<StakePosition vaultId="0xv" />);
    await waitFor(() => expect(screen.getByText(/lower bound/i)).toBeTruthy());
  });
});

describe('withdrawing', () => {
  it('offers it when principal is held', async () => {
    mockRoutes({ stake: { ok: true, body: { vault: VAULT, position: { principalMist: '1000000000', pendingRebateMist: '0' } } } });
    render(<StakePosition vaultId="0xv" />);
    await waitFor(() => expect(screen.getByText('Withdraw')).toBeTruthy());
  });

  it('refuses it when the address holds no account object, and says why', async () => {
    mockRoutes({
      stake: { ok: true, body: { vault: VAULT, position: { principalMist: '1000000000', pendingRebateMist: '0' } } },
      creator: {},
    });
    render(<StakePosition vaultId="0xv" />);
    await waitFor(() => expect(screen.getByText(/No account object at this address/i)).toBeTruthy());
    expect(screen.queryByText('Withdraw')).toBeNull();
  });

  it('warns loudly when the vault reports less backing than principal', async () => {
    mockRoutes({ stake: { ok: true, body: { vault: { ...VAULT, solvent: false }, position: { principalMist: '1000000000', pendingRebateMist: '0' } } } });
    render(<StakePosition vaultId="0xv" />);
    await waitFor(() => expect(screen.getByText(/Invariant violated/i)).toBeTruthy());
  });

  it('promises no waiting period and no approval', async () => {
    mockRoutes({ stake: { ok: true, body: { vault: VAULT, position: { principalMist: '1000000000', pendingRebateMist: '0' } } } });
    render(<StakePosition vaultId="0xv" />);
    await waitFor(() => expect(screen.getByText(/no waiting period and no approval/i)).toBeTruthy());
  });
});

describe('signed out', () => {
  it('offers sign-in rather than an empty balance', async () => {
    signer = null;
    mockRoutes({});
    render(<StakePosition vaultId="0xv" />);
    await waitFor(() => expect(screen.getByText('sign in')).toBeTruthy());
  });
});

describe('stake vaults are read from chain, not from a column', () => {
  const stake = readFileSync(join(process.cwd(), 'lib/stake.ts'), 'utf8');
  const page = readFileSync(join(process.cwd(), 'app/c/[handle]/page.tsx'), 'utf8');

  it('names a vault by its on-chain creator, not only by the stored link', () => {
    expect(stake).toContain('normaliseAddress(p.owner) === normaliseAddress(vault.value.creator)');
  });

  it('lists every vault the creator has opened rather than the first found', () => {
    expect(page).toContain('walked.value.vaults.filter');
    expect(page).not.toContain('walked.value.vaults.find');
  });

  it('does not treat the stored column as the list', () => {
    expect(page).not.toContain('if (profile.stakeVaultId !== undefined) return profile.stakeVaultId');
  });
});
