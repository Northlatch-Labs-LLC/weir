// @vitest-environment happy-dom
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
/**
 * `Earnings` — what a creator is owed, and what was taken.
 *
 * Three figures that must never merge: gross volume is what buyers paid, platform fees are what
 * ProjectX took, and earnings is what the creator can withdraw. Showing one number would hide the
 * fee from the person paying it.
 *
 * Gross is cumulative and does not move when earnings are withdrawn. Anything that summed or
 * subtracted them would drift apart from the chain within one withdrawal.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let signer: { address: string; kind: string; label: string; signTransaction: ReturnType<typeof vi.fn> } | null = null;
vi.mock('@/components/SignerProvider', () => ({ useSigner: () => ({ signer }) }));
vi.mock('@/components/SignIn', () => ({ SignIn: () => <div>sign in</div> }));

const { Earnings } = await import('../components/Earnings');

const VAULT = {
  vaultId: '0xv', capId: '0xcap', handle: 'alice',
  coinType: '0xdba34672…::usdc::USDC',
  // The real figures from the publisher's mainnet vault: 0.6 paid, 0.0174 taken at 290 bps,
  // 0.5826 withdrawable. Six decimals, carried by the vault rather than assumed by the component.
  decimals: 6,
  grossVolume: '600000', platformFees: '17400', earnings: '582600',
  feeBpsSnapshot: '290',
};

function mockEarnings(body: unknown) {
  const fetchMock = vi.fn(async (url: string) => ({
    ok: true, status: 200,
    json: async () => (String(url).includes('/api/earnings?') ? body : { digest: '0xD' }),
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  signer = { address: '0xda78', kind: 'wallet', label: 'W', signTransaction: vi.fn(async () => 'sig') };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('the three figures stay three', () => {
  it('shows what is withdrawable now', async () => {
    mockEarnings({ vaults: [VAULT] });
    render(<Earnings />);
    await waitFor(() => expect(screen.getByText(/Withdrawable now/i)).toBeTruthy());
  });

  it('names the fee rate stamped into the vault, so it is visible rather than inferred', async () => {
    /*
     * `fee_bps_snapshot` is fixed the day the vault is created and this platform cannot raise it
     * afterwards. That promise is only worth something if the creator can see the number.
     */
    mockEarnings({ vaults: [VAULT] });
    render(<Earnings />);
    await waitFor(() => expect(screen.getByText(/2\.9% platform fee, fixed at creation/i)).toBeTruthy());
  });

  it('does not present gross as though it were earnings', async () => {
    // 0.6 gross and 0.5826 withdrawable are different facts. A single "your money" figure would be
    // wrong by exactly the platform's cut.
    mockEarnings({ vaults: [VAULT] });
    render(<Earnings />);
    await waitFor(() => expect(screen.getByText('0.5826')).toBeTruthy());
    expect(screen.getByText('0.6')).toBeTruthy();
  });
});

describe('withdrawing', () => {
  it('says so plainly when the address holds no capability', async () => {
    // `claim_earnings` takes a CreatorCap bound to that one vault. Without it the contract aborts,
    // and an abort code is a poor way to learn you are signed in as the wrong address.
    mockEarnings({ vaults: [{ ...VAULT, capId: null }] });
    render(<Earnings />);
    await waitFor(() => expect(screen.getByText(/No CreatorCap at this address/i)).toBeTruthy());
  });
});

describe('states that are not a zero balance', () => {
  it('says it is reading rather than showing nothing earned', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined)));
    render(<Earnings />);
    await waitFor(() => expect(screen.getByText(/Reading your vaults/i)).toBeTruthy());
  });

  it('offers sign-in rather than an empty statement', () => {
    signer = null;
    mockEarnings({ vaults: [] });
    render(<Earnings />);
    expect(screen.getByText('sign in')).toBeTruthy();
  });
});

describe('amounts are scaled by the vault, not by a constant', () => {
  /*
   * The defect this replaced: the component formatted every vault as six-decimal USDC. A
   * nine-decimal SUI vault therefore reported earnings a thousand times too large, and the figure
   * was plausible enough that looking at it did not reveal anything.
   *
   * The test that previously covered this file asserted the wrong behaviour, so the suite defended
   * the bug. These are the assertions it should have carried.
   */
  const SUI_VAULT = {
    ...VAULT,
    coinType: '0x2::sui::SUI',
    decimals: 9,
    // 0.6, 0.0174 and 0.5826 again — the same amounts, at nine decimals.
    grossVolume: '600000000', platformFees: '17400000', earnings: '582600000',
  };

  it('renders a nine-decimal vault at nine decimals', async () => {
    mockEarnings({ vaults: [SUI_VAULT] });
    render(<Earnings />);
    await waitFor(() => expect(screen.getByText('0.5826')).toBeTruthy());
  });

  it('does not render the same figure for two vaults holding different coins', async () => {
    // Identical raw integers, different coins. Formatting them alike is precisely the bug.
    mockEarnings({ vaults: [{ ...VAULT, earnings: '582600000' }, SUI_VAULT] });
    render(<Earnings />);
    // Six decimals reads 582.6; nine reads 0.5826. Both must appear.
    await waitFor(() => expect(screen.getByText('582.6')).toBeTruthy());
    expect(screen.getByText('0.5826')).toBeTruthy();
  });

  it('reads decimals off the payload rather than the coin type', () => {
    // Parsing a symbol out of the type string would break on any coin this deployment has not seen.
    const component = readFileSync(join(import.meta.dirname, '..', 'components/Earnings.tsx'), 'utf8');
    // Comments strip first — the header names the constant deliberately, to record what the bug was.
    const code = component.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).toContain('vault.decimals');
    expect(code).not.toContain('USDC_DECIMALS');
  });
});
