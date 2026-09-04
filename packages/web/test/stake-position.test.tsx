// @vitest-environment happy-dom
// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
/**
 * `StakePosition` — the screen the no-loss guarantee is rendered from.
 *
 * The contract's promise is that principal stays the depositor's, the creator earns only the yield
 * it generates, and the principal comes back in full on request. That property is worth exactly as
 * much as this component's withdraw button.
 *
 * Two failures matter more than the rest, and neither throws:
 *
 *   Rendering a failed read as a zero balance tells somebody their deposit is gone. It is the
 *   worst sentence this application can say, and `?? 0` says it.
 *   Adding principal to accrued yield produces one "your balance" figure that blurs the single
 *   guarantee worth making — principal is redeemable one for one, yield is not the depositor's.
 */

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

/** Routes answered independently, because in production they fail independently. */
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
  it('says the vault could not be read, and does not show a figure', async () => {
    mockRoutes({ stake: { ok: false, body: { error: 'the node timed out' } } });
    render(<StakePosition vaultId="0xv" />);
    await waitFor(() => expect(screen.getByText(/Not measured/i)).toBeTruthy());
    expect(screen.getByText(/not.*a zero balance/i)).toBeTruthy();
  });

  it('offers no withdraw button when it could not read the position', async () => {
    // Offering an action against an unknown balance is how somebody signs a transaction that
    // aborts, having been shown nothing that said it might.
    mockRoutes({ stake: { ok: false, body: { error: 'unreachable' } } });
    render(<StakePosition vaultId="0xv" />);
    await waitFor(() => expect(screen.getByText(/Not measured/i)).toBeTruthy());
    expect(screen.queryByText('Withdraw')).toBeNull();
  });
});

describe('a measured absence is stated as one', () => {
  it('says the table was read and holds no entry, rather than showing nothing', async () => {
    /*
     * "You have not deposited here" and "we could not tell" must look different. Only the first is
     * safe to act on, and only the first is an invitation.
     */
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
    // Different money with different owners. Principal is redeemable one for one; accrued yield
    // belongs to the creator minus whatever share they hand back. Summing them would blur the one
    // guarantee this product makes.
    mockRoutes({ stake: { ok: true, body: { vault: VAULT, position: { principalMist: '1000000000', pendingRebateMist: '250000000' } } } });
    render(<StakePosition vaultId="0xv" />);
    await waitFor(() => expect(screen.getByText(/Principal \(yours\)/i)).toBeTruthy());
    expect(screen.getByText(/Your share accrued/i)).toBeTruthy();
    // 1.0 and 0.25, never 1.25.
    expect(screen.queryByText('1.25')).toBeNull();
  });

  it('calls the accrued share a lower bound', async () => {
    // The contract accrues on interaction, so anything earned since the depositor last touched the
    // vault is not in the figure. Presenting it as a total overstates on a rising number.
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
    /*
     * `withdraw` authenticates against a SocialAccount. Without one the contract aborts, so the
     * component says so before the user spends gas discovering it.
     */
    mockRoutes({
      stake: { ok: true, body: { vault: VAULT, position: { principalMist: '1000000000', pendingRebateMist: '0' } } },
      creator: {},
    });
    render(<StakePosition vaultId="0xv" />);
    await waitFor(() => expect(screen.getByText(/No account object at this address/i)).toBeTruthy());
    expect(screen.queryByText('Withdraw')).toBeNull();
  });

  it('warns loudly when the vault reports less backing than principal', async () => {
    // The contract asserts against this on every path that moves money, so seeing it means
    // something is wrong that must be looked at before anybody deposits again.
    mockRoutes({ stake: { ok: true, body: { vault: { ...VAULT, solvent: false }, position: { principalMist: '1000000000', pendingRebateMist: '0' } } } });
    render(<StakePosition vaultId="0xv" />);
    await waitFor(() => expect(screen.getByText(/Invariant violated/i)).toBeTruthy());
  });

  it('promises no waiting period and no approval', async () => {
    // The differentiator, in the words the contract actually supports.
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

/*
  Vault multiplicity, and the naming that depended on a column nobody wrote.

  `stake_vault::open` gates on a soulbound account and an unpaused platform, and checks nothing
  else — so a creator may open as many vaults as they like, and on mainnet several have. Two
  consequences were wrong here and both were silent:

    - A profile page showed the first vault the event walk returned and dropped the rest, so a
      depositor could fund a vault the creator had moved on from with no sign the others existed.
    - `readVault` named a vault by matching `profiles.stake_vault_id`, a column no code path ever
      writes. Every stake vault page therefore rendered "Unnamed vault" while the chain knew whose
      it was.

  Asserted against source because both are about which source of truth is consulted, and a render
  test would pass against either while the wrong one was being asked.
*/
describe('stake vaults are read from chain, not from a column', () => {
  const stake = readFileSync(join(process.cwd(), 'lib/stake.ts'), 'utf8');
  const page = readFileSync(join(process.cwd(), 'app/c/[handle]/page.tsx'), 'utf8');

  it('names a vault by its on-chain creator, not only by the stored link', () => {
    expect(stake).toContain('normaliseAddress(p.owner) === normaliseAddress(vault.value.creator)');
  });

  it('lists every vault the creator has opened rather than the first found', () => {
    expect(page).toContain('walked.value.vaults.filter');
    // `.find(` would take one and silently discard the rest — the defect this replaced.
    expect(page).not.toContain('walked.value.vaults.find');
  });

  it('does not treat the stored column as the list', () => {
    expect(page).not.toContain('if (profile.stakeVaultId !== undefined) return profile.stakeVaultId');
  });
});
