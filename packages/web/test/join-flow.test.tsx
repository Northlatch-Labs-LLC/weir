// @vitest-environment happy-dom
// Built-by: @projectx.sui · Co-authored-by: Claude
/**
 * `JoinFlow` — the first thing anybody signs.
 *
 * Three things can stop the transaction, and each is checked before a button appears: is the handle
 * shaped legally, is it free, and does this address already hold an account. The ordering matters
 * more here than anywhere else in the product, because an abort code is a poor introduction.
 *
 * The failure worth pinning hardest: a registry that could not be read must not render as
 * "available". Letting somebody through on an unknown answer spends their gas to discover the
 * handle was taken — and a first transaction that fails is a user who does not come back.
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let signer: { address: string; kind: string; label: string; signTransaction: ReturnType<typeof vi.fn> } | null = null;
vi.mock('@/components/SignerProvider', () => ({ useSigner: () => ({ signer }) }));
vi.mock('@/components/SignIn', () => ({ SignIn: () => <div>sign in</div> }));

const { JoinFlow } = await import('../components/JoinFlow');

/**
 * The two questions `/api/account` answers, and the transaction routes behind them.
 *
 * `?handle=` is "is this name free"; `?address=` is "does this address already hold an account".
 * They are separate reads with separate failure modes, and the component has to be able to tell
 * "no account" from "could not look" — so they are stubbed separately rather than folded together.
 *
 * Anything not named here answers 501, which is the honest default: a route this test did not set
 * up has not been measured, and must not read as a cheerful zero.
 */
function mockAccount(
  handle: unknown,
  options: {
    /** What `?address=` reports. `{ handle: null }` is an address with no account yet. */
    account?: unknown;
    /** What `/api/account/prepare` reports, once a handle is picked. */
    prepare?: unknown;
    /** What `/api/checkout/submit` reports, once something is signed. */
    submit?: unknown;
  } = {},
) {
  const calls: { url: string; body: unknown }[] = [];
  const fetchMock = vi.fn(async (url: string, init?: { body?: string }) => {
    const at = String(url);
    calls.push({ url: at, body: init?.body === undefined ? undefined : JSON.parse(init.body) });

    if (at.includes('/api/account?handle=')) {
      return { ok: true, status: 200, json: async () => ({ handle }) };
    }
    if (at.includes('/api/account?address=')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ account: options.account ?? { handle: null } }),
      };
    }
    if (at.includes('/api/account/prepare')) {
      return { ok: true, status: 200, json: async () => options.prepare ?? {} };
    }
    if (at.includes('/api/checkout/submit')) {
      return { ok: true, status: 200, json: async () => options.submit ?? {} };
    }
    return { ok: false, status: 501, json: async () => ({}) };
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

beforeEach(() => {
  signer = { address: '0xda78', kind: 'zklogin', label: 'Google', signTransaction: vi.fn(async () => 'sig') };
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('signed out', () => {
  it('offers sign-in and explains what an account is', async () => {
    signer = null;
    mockAccount({ state: 'available' });
    render(<JoinFlow referrer={null} />);
    expect(screen.getByText('sign in')).toBeTruthy();
    // The property that makes the account worth having: it cannot be taken.
    expect(screen.getByText(/cannot be transferred/i)).toBeTruthy();
  });
});

describe('the referrer is shown before it is fixed forever', () => {
  it('names who referred them, and says it can never change', async () => {
    /*
     * `referrer` is set at creation and there is no setter anywhere in the protocol. Somebody
     * should see it before signing, because nobody can correct it afterwards.
     */
    signer = null;
    mockAccount({ state: 'available' });
    render(<JoinFlow referrer="0xreferrer000000000000000000000000000000000000000000000000000000" />);
    expect(screen.getByText(/never be changed/i)).toBeTruthy();
  });
});

describe('checking a handle', () => {
  it('reports one that is free', async () => {
    mockAccount({ state: 'available' });
    const { container } = render(<JoinFlow referrer={null} />);
    /*
      Awaited, not grabbed. The form is withheld until `/api/account?address=` has answered —
      before that the component cannot know whether this address already holds a handle, and
      rendering the claim form on "not asked yet" is what told registered people to register.
    */
    await waitFor(() => expect(container.querySelector('input')).not.toBeNull());
    const input = container.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'nova' } });
    await waitFor(() => expect(screen.getByText(/available/i)).toBeTruthy(), { timeout: 3000 });
  });

  it('reports one that is taken, and offers no way forward', async () => {
    mockAccount({ state: 'taken', owner: '0xsomebody' });
    const { container } = render(<JoinFlow referrer={null} />);
    /*
      Awaited, not grabbed. The form is withheld until `/api/account?address=` has answered —
      before that the component cannot know whether this address already holds a handle, and
      rendering the claim form on "not asked yet" is what told registered people to register.
    */
    await waitFor(() => expect(container.querySelector('input')).not.toBeNull());
    const input = container.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'nova' } });
    await waitFor(() => expect(screen.getByText(/taken/i)).toBeTruthy(), { timeout: 3000 });
    // Rendered but disabled, rather than removed. A control that vanishes leaves the reader
    // wondering what they did; a disabled one beside "taken" explains itself.
    expect(screen.getByText('Check and continue').closest('button')?.disabled).toBe(true);
  });

  it('does not treat an unreadable registry as available', async () => {
    /*
     * The important one. "We could not check" must never render as "it is yours" — the user would
     * spend gas to be told the handle was taken, on the first transaction they ever signed.
     */
    mockAccount({ error: 'the registry could not be read', kind: 'transport' });
    const { container } = render(<JoinFlow referrer={null} />);
    /*
      Awaited, not grabbed. The form is withheld until `/api/account?address=` has answered —
      before that the component cannot know whether this address already holds a handle, and
      rendering the claim form on "not asked yet" is what told registered people to register.
    */
    await waitFor(() => expect(container.querySelector('input')).not.toBeNull());
    const input = container.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'nova' } });
    await waitFor(() => expect(screen.queryByText(/available/i)).toBeNull(), { timeout: 3000 });
    // The gate is `handleState === 'available'`, so an unreadable registry leaves it shut. Anything
    // that treated "unknown" as passable would spend the user's gas to discover otherwise.
    expect(screen.getByText('Check and continue').closest('button')?.disabled).toBe(true);
  });

  it('explains why a handle is malformed instead of just refusing it', async () => {
    // Uppercase is rejected rather than lower-cased, so asking for Alice does not quietly give you
    // alice — and the message has to say that, or it reads as a bug.
    mockAccount({ state: 'invalid', problem: { kind: 'character', character: 'A' } });
    const { container } = render(<JoinFlow referrer={null} />);
    /*
      Awaited, not grabbed. The form is withheld until `/api/account?address=` has answered —
      before that the component cannot know whether this address already holds a handle, and
      rendering the claim form on "not asked yet" is what told registered people to register.
    */
    await waitFor(() => expect(container.querySelector('input')).not.toBeNull());
    const input = container.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Alice' } });
    await waitFor(() => expect(screen.getByText(/not allowed/i)).toBeTruthy(), { timeout: 3000 });
  });
});

/*
  Whose account this is.

  The header of `JoinFlow` lists three things that can stop the transaction, and the third — "does
  this address already have an account" — was never asked. `/api/account?address=` existed and was
  called by nothing, and the two branches that render its answer were unreachable code.

  The consequence is not cosmetic. One account per address is enforced on chain, so a registered
  address that types a fresh handle is offered a button that simulates, fails on `EAlreadyRegistered`
  and reports an abort code — as the first thing that person ever signed.
*/
describe('an address that already holds an account', () => {
  it('says so, rather than offering a handle it can never claim', async () => {
    mockAccount({ state: 'available' }, { account: { handle: 'nova' } });
    render(<JoinFlow referrer={null} />);

    await waitFor(() => expect(screen.queryByText(/already have an account/i)).not.toBeNull());
    expect(screen.getByText(/@nova/)).toBeTruthy();
    // The form is gone entirely: there is nothing here to fill in.
    expect(screen.queryByLabelText(/CHOOSE A HANDLE/i)).toBeNull();
  });

  /*
    "Could not look" and "no account" are different facts and only one of them is safe to act on.
    Reading an unreachable node as "no account yet" sends a registered user to pay gas to be told
    otherwise by an abort code, which is the exact failure the handle check already refuses to make.
  */
  it('blocks rather than guessing when the registry could not be read', async () => {
    mockAccount({ state: 'available' }, { account: { error: 'the node is unreachable', kind: 'transport' } });
    render(<JoinFlow referrer={null} />);

    await waitFor(() => expect(screen.queryByText(/could not read the registry/i)).not.toBeNull());
    expect(screen.getByText(/the node is unreachable/)).toBeTruthy();
    expect(screen.queryByLabelText(/CHOOSE A HANDLE/i)).toBeNull();
  });

  it('offers registration to an address that holds nothing yet', async () => {
    mockAccount({ state: 'available' }, { account: { handle: null } });
    const { container } = render(<JoinFlow referrer={null} />);

    await waitFor(() => expect(container.querySelector('input')).not.toBeNull());
    expect(screen.queryByText(/already have an account/i)).toBeNull();
  });
});

/*
  Simulate, then sign, and never across two different addresses.

  A wallet's account can move while this page is open — that is the whole point of following
  `standard:events`. A quote is built for one sender and simulated against that sender's gas coins,
  so a quote left on screen after the address changed is a transaction that the newly-bound account
  cannot validly sign. The wallet would sign bytes whose sender is somebody else, and the node
  would refuse them after the reader had approved a gas quote.
*/
describe('the quote belongs to the address it was simulated for', () => {
  async function simulateFor(address: string) {
    const calls = mockAccount(
      { state: 'available' },
      { prepare: { quote: { bytes: 'AAAAquote', gasMist: '2500000' } } },
    );
    signer = { address, kind: 'wallet', label: 'Slush', signTransaction: vi.fn(async () => 'sig') };
    const view = render(<JoinFlow referrer={null} />);
    // Same reason as above: the form waits for the registry read before it exists.
    await waitFor(() => expect(view.container.querySelector('input')).not.toBeNull());
    const input = view.container.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'disposable' } });
    await waitFor(() => expect(screen.getByText(/available/i)).toBeTruthy(), { timeout: 3000 });
    fireEvent.click(screen.getByText('Check and continue'));
    await waitFor(() => expect(screen.queryByText(/Simulated/)).not.toBeNull());
    return { view, calls };
  }

  it('quotes the gas the simulation actually reported', async () => {
    const { calls } = await simulateFor('0xda78');

    expect(screen.getByText(/0.0025 SUI/)).toBeTruthy();
    // Simulated for the address that will sign it, not for a default.
    const prepared = calls.find((call) => call.url.includes('/api/account/prepare'));
    expect((prepared?.body as { sender: string }).sender).toBe('0xda78');
  });

  it('drops a quote simulated for a different address when the wallet moves', async () => {
    const { view } = await simulateFor('0xda78');

    signer = { address: '0xother', kind: 'wallet', label: 'Slush', signTransaction: vi.fn(async () => 'sig') };
    view.rerender(<JoinFlow referrer={null} />);

    await waitFor(() => expect(screen.queryByText(/Simulated/)).toBeNull());
    // Back to the form, so the next quote is built for whoever is now bound.
    expect(screen.queryByText('Check and continue')).not.toBeNull();
  });

  /*
    The bytes that were simulated, signed, and submitted are one artefact. Anything that rebuilt
    them between the quote and the submission would put a transaction on chain that nobody read.
  */
  it('signs and submits exactly the bytes that were simulated', async () => {
    const { calls } = await simulateFor('0xda78');
    const sign = signer!.signTransaction;

    fireEvent.click(screen.getByText('Sign and register'));

    await waitFor(() => expect(sign).toHaveBeenCalledWith('AAAAquote'));
    const submitted = calls.find((call) => call.url.includes('/api/checkout/submit'));
    expect(submitted?.body).toEqual({ bytes: 'AAAAquote', signature: 'sig' });
  });
});

/**
 * The signup page always offers a way to sign up.
 *
 * # The defect
 *
 * With Google unavailable on the deployment and no wallet extension in the browser, `SignIn`
 * rendered one paragraph and no control — so `/join`, whose entire job is to get somebody an
 * account, had no button and no field anywhere on it. Measured at 1440px: zero buttons, zero
 * inputs. A visitor on a browser without a Sui wallet meets that, and every visitor meets it if the
 * zkLogin session read fails after a deploy.
 */
describe('the way in is never absent', () => {
  it('offers wallets to install when neither path is available', () => {
    const source = readFileSync(resolve(process.cwd(), 'components/SignIn.tsx'), 'utf8');
    /*
      Read from the source rather than rendered: the branch depends on a wallet registry and a
      session fetch, and what is being defended is that the branch produces CONTROLS rather than
      prose. The rendered assertions for the other branches are in `wallet-accounts.test.tsx`.
    */
    const branch = source.slice(source.indexOf('wallets.length === 0 && unusableWallets.length === 0'));
    expect(branch).toContain('slush.app');
    expect(branch).toContain('phantom.app');
    expect(branch).toMatch(/w-btn--primary/);
  });

  it('leads with signing in, not with installing an extension', () => {
    /*
      The second half of the same defect. This component is mounted on eight signed-out pages, so
      offering the wallet installs as the primary control made every one of them lead with "install
      a browser extension". `/signin` knows what this deployment actually offers; that is where
      somebody goes first, and the installs are what is left when there is no other way.
    */
    const source = readFileSync(resolve(process.cwd(), 'components/SignIn.tsx'), 'utf8');
    const branch = source.slice(source.indexOf('wallets.length === 0 && unusableWallets.length === 0'));
    const signIn = branch.indexOf('href="/signin"');
    const slush = branch.indexOf('slush.app');
    expect(signIn).toBeGreaterThan(-1);
    expect(signIn, 'the sign-in link must come before the wallet installs').toBeLessThan(slush);
    /*
      And not on the two pages whose own chrome already offers it: `/signin`, where it would link to
      the page being read, and `/join`, where the public header carries a "Sign in" button sixteen
      pixels from the top and this rendered a second one four hundred pixels below it.
    */
    expect(branch).toContain("pathname === '/signin' || pathname === '/join' ? null :");
  });
});
