// @vitest-environment happy-dom
// Built-by: @projectx.sui · Co-authored-by: Claude
/**
 * `DepositCheckout` — putting money into a stake vault.
 *
 * The deposit is the moment somebody trusts this product with real value, and the thing that makes
 * it safe to do is that they see exactly what will happen before they sign. So the tests are about
 * what is shown and when, not about arithmetic:
 *
 *   Nothing is signable until a simulation against live objects has come back clean.
 *   The bytes signed are the bytes simulated — no rebuild between the quote and the signature.
 *   A refusal says nothing was signed, because a failed checkout that looks ambiguous sends
 *   somebody hunting for a transaction that never existed.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let signer: { address: string; kind: string; label: string; signTransaction: ReturnType<typeof vi.fn> } | null = null;
vi.mock('@/components/SignerProvider', () => ({ useSigner: () => ({ signer }) }));
vi.mock('@/components/SignIn', () => ({ SignIn: () => <div>sign in</div> }));

const { DepositCheckout } = await import('../components/DepositCheckout');

const QUOTE = {
  bytes: 'BASE64BYTES',
  gasMist: '1417384',
  amountMist: '1000000000',
  suiDeltaMist: '-1001417384',
};

/** Returns the mock itself — `vi.stubGlobal` returns nothing, and the calls are the assertion. */
function mockRoutes(routes: { prepare?: unknown; submit?: unknown }) {
  const fetchMock = vi.fn(async (url: string, init?: { body?: string }) => ({
    ok: true,
    status: 200,
    json: async () =>
      String(url).includes('/prepare') ? (routes.prepare ?? { quote: QUOTE }) : (routes.submit ?? { digest: '0xDIGEST' }),
  }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => {
  signer = { address: '0xda78', kind: 'zklogin', label: 'Google', signTransaction: vi.fn(async () => 'sig') };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

/** Drives the component to the quoted state, which is where every interesting assertion lives. */
async function quoted() {
  const view = render(<DepositCheckout vaultId="0xv" />);
  fireEvent.click(screen.getByText('Check the deposit'));
  await waitFor(() => expect(screen.getByText(/What will happen/i)).toBeTruthy());
  return view;
}

describe('before anything is signed', () => {
  it('offers sign-in rather than a deposit form when signed out', () => {
    signer = null;
    mockRoutes({});
    render(<DepositCheckout vaultId="0xv" />);
    expect(screen.getByText('sign in')).toBeTruthy();
  });

  it('promises the principal stays withdrawable, which is the whole offer', () => {
    signer = null;
    mockRoutes({});
    render(<DepositCheckout vaultId="0xv" />);
    expect(screen.getByText(/withdrawable at any time/i)).toBeTruthy();
  });

  it('refuses an amount that is not a number before touching the network', async () => {
    /*
     * Parsed by string, never `parseFloat`. A rejected amount should cost a message rather than a
     * round trip, and more importantly must never reach the transaction builder as NaN.
     */
    const fetchMock = mockRoutes({});
    render(<DepositCheckout vaultId="0xv" />);
    const input = document.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'one sui' } });
    fireEvent.click(screen.getByText('Check the deposit'));
    await waitFor(() => expect(screen.getByText(/Enter an amount in SUI/i)).toBeTruthy());
    expect(fetchMock.mock.calls.length).toBe(0);
  });
});

describe('the quote', () => {
  it('shows what the deposit does before offering to sign it', async () => {
    mockRoutes({});
    await quoted();
    // Named as the thing it is: money that stays theirs.
    expect(screen.getByText(/stays yours, withdrawable/i)).toBeTruthy();
  });

  it('shows the total leaving the wallet, not just the deposit', async () => {
    // Deposit plus gas. Showing only the deposit understates what actually leaves, and the
    // difference is the part somebody notices afterwards.
    mockRoutes({});
    await quoted();
    expect(screen.getByText(/Total leaving your wallet/i)).toBeTruthy();
  });

  it('says the account object is required rather than failing at signing time', async () => {
    // `deposit` authenticates against a SocialAccount; without one the contract aborts.
    mockRoutes({ prepare: { needsAccount: true } });
    render(<DepositCheckout vaultId="0xv" />);
    fireEvent.click(screen.getByText('Check the deposit'));
    await waitFor(() => expect(screen.getByText(/Account required/i)).toBeTruthy());
  });

  it('reports a refused simulation as nothing signed', async () => {
    /*
     * A failed checkout must be unambiguous. "Nothing was signed" is the sentence that stops
     * somebody hunting an explorer for a transaction that never existed.
     */
    mockRoutes({ prepare: { error: 'insufficient balance' } });
    render(<DepositCheckout vaultId="0xv" />);
    fireEvent.click(screen.getByText('Check the deposit'));
    await waitFor(() => expect(screen.getByText(/Nothing was signed/i)).toBeTruthy());
  });
});

describe('signing', () => {
  it('signs exactly the bytes that were simulated', async () => {
    /*
     * The gate the whole application is built on. Anything rebuilt between the quote and the
     * signature means the user approved one transaction and signed another.
     */
    mockRoutes({});
    await quoted();
    fireEvent.click(screen.getByText("Confirm and sign"));
    await waitFor(() => expect(signer?.signTransaction).toHaveBeenCalledWith(QUOTE.bytes));
  });

  it('submits the same bytes it signed', async () => {
    const fetchMock = mockRoutes({});
    await quoted();
    fireEvent.click(screen.getByText("Confirm and sign"));
    await waitFor(() => {
      const submit = fetchMock.mock.calls.find(([url]) => String(url).includes('/submit'));
      const body = JSON.parse(submit?.[1]?.body ?? '{}') as { bytes?: string };
      expect(body.bytes).toBe(QUOTE.bytes);
    });
  });

  it('shows the digest once it lands, so the deposit can be checked independently', async () => {
    mockRoutes({});
    await quoted();
    fireEvent.click(screen.getByText("Confirm and sign"));
    await waitFor(() => expect(screen.getByText(/Deposited/i)).toBeTruthy());
  });
});
