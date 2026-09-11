// @vitest-environment happy-dom
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
/**
 * The connected wallet has to reach the server, or the gate answers about the wrong person.
 *
 * # The defect this pins
 *
 * Entitlement is decided on the server from the chain objects `?reader=` owns. Every link in the
 * frame carries that parameter onward once it exists — but nothing originated it from the wallet.
 * Only the join flow and the account menu ever wrote one, so a reader who connected a wallet
 * anywhere else stayed anonymous: `readEntitlements(null)` returns nothing, and `canRead` locks a
 * subscriber post correctly, about a reader the server was never told about.
 *
 * It was found by using the product. A subscriber-only post was published, a second address bought
 * a subscription to it on chain, and the post still rendered locked to that address. The
 * subscription was real, the gate was right, and the question was being asked about nobody.
 *
 * # Why this moved out of `Shell`
 *
 * The tests survived that intact and green, because they asserted against `Shell` rather than
 * against "every route". They now target `SessionBridge`, which the root layout mounts, so what is
 * pinned is the behaviour rather than the component that happened to host it.
 *
 * # Why this is safe to do automatically
 *
 * Naming an address proves nothing and unlocks nothing — the objects it owns decide, and those
 * cannot be forged by claiming to be their owner. A wrong address sees less, never more.
 */

import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SIGNER = '0x9c8f6a1d2b4e7c05a3f18d6b29e4c7a0f5b3d8e1c6a94f27b0d5e83a1c6f492b';

const replace = vi.fn();
/*
  One router object for the whole suite, because that is what Next returns.

  Minting a fresh `{ replace }` per call looks harmless and is not: `router` is a dependency of the
  effect under test, so a new identity on every render refires it, and the component re-renders as
  the session fetch lands. The first draft of this mock did that and reported two navigations where
  the component performs one — a failure invented entirely by the test.
*/
const router = { replace };
let signer: { address: string } | null = null;

vi.mock('next/navigation', () => ({
  usePathname: () => '/',
  useRouter: () => router,
}));

vi.mock('@/components/SignerProvider', () => ({
  useSigner: () => ({ signer, session: { network: 'mainnet' } }),
}));

const { SessionBridge } = await import('../components/SessionBridge');

/**
 * Put a query string on the document.
 *
 * `SessionBridge` reads `window.location.search` rather than `useSearchParams`, because that hook
 * forces the component under a Suspense boundary and a boundary there does not resolve — the
 * subtree stays in React's hidden staging div and the effects never run. So the URL is the input
 * here, which is also what the browser actually gives it.
 */
function url(search: string): void {
  window.history.replaceState({}, '', `/${search}`);
}

/** Let the effects run. They are synchronous up to the first await; this covers the rest. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 20));
}

beforeEach(() => {
  replace.mockClear();
  url('');
  signer = null;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the reader the server is told about', () => {
  it('is the connected wallet, once one is connected', async () => {
    signer = { address: SIGNER };
    render(<SessionBridge />);

    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    expect(replace.mock.calls[0]?.[0]).toBe(`/?reader=${SIGNER}`);
  });

  it('is left alone when it already names the connected wallet', async () => {
    // The guard against a replace loop: the effect reruns on the parameter it just wrote, so a
    // comparison that missed would navigate forever.
    signer = { address: SIGNER };
    url(`?reader=${SIGNER}`);
    render(<SessionBridge />);

    await settle();
    expect(replace).not.toHaveBeenCalled();
  });

  it('ignores the case a wallet reports its address in', async () => {
    // Sui addresses are hex and wallets differ on casing. Comparing them raw would rewrite the URL
    // on every render with a value the server already had.
    signer = { address: SIGNER };
    url(`?reader=0x${SIGNER.slice(2).toUpperCase()}`);
    render(<SessionBridge />);

    await settle();
    expect(replace).not.toHaveBeenCalled();
  });

  it('replaces a different address rather than leaving a stale one', async () => {
    // Switching wallets mid-session. Leaving the previous address would show the new one somebody
    // else's entitlements, which is the failure this whole parameter exists to make impossible.
    signer = { address: SIGNER };
    url('?reader=0x1');
    render(<SessionBridge />);

    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    expect(replace.mock.calls[0]?.[0]).toBe(`/?reader=${SIGNER}`);
  });

  it('keeps the other parameters on the URL', async () => {
    // `view` is the feed's following/all tab. Rewriting the URL to just the reader would drop the
    // reader back to the default feed the moment their wallet connected.
    signer = { address: SIGNER };
    url('?view=all');
    render(<SessionBridge />);

    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    const written = new URLSearchParams(String(replace.mock.calls[0]?.[0]).split('?')[1]);
    expect(written.get('view')).toBe('all');
    expect(written.get('reader')).toBe(SIGNER);
  });

  it('writes nothing while no wallet is connected', async () => {
    // Signed out is a real state, not a missing address. Guessing one here would be the same class
    // of mistake in the other direction.
    render(<SessionBridge />);

    await settle();
    expect(replace).not.toHaveBeenCalled();
  });
});

/**
 * That it is mounted at all.
 *
 * The behaviour above was correct and unreachable for weeks, because it hung off a component that
 * most routes had stopped rendering. Asserting the *root layout* mounts it is the assertion that
 * would have caught that — a component test proves a component works and never that anything
 * renders it.
 */
describe('where the handshake is mounted', () => {
  it('is the root layout, so every route has it', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const layout = readFileSync(resolve(process.cwd(), 'app/layout.tsx'), 'utf8');

    expect(layout).toContain('SessionBridge');
    /*
      Not inside a Suspense boundary. One was tried: the subtree stayed in React's hidden staging
      div, the effects never ran, and the handshake was mounted, green and doing nothing.
    */
    expect(layout).not.toMatch(/<Suspense[^>]*>\s*<SessionBridge/);
  });
});
