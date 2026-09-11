// @vitest-environment happy-dom
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let signer: { address: string; kind: string; label: string; signTransaction: ReturnType<typeof vi.fn> } | null = null;
vi.mock('@/components/SignerProvider', () => ({ useSigner: () => ({ signer }) }));
vi.mock('@/components/SignIn', () => ({ SignIn: () => <div>sign in</div> }));

const { JoinFlow } = await import('../components/JoinFlow');

function mockAccount(
  handle: unknown,
  options: {
    account?: unknown;
    prepare?: unknown;
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
    expect(screen.getByText(/cannot be transferred/i)).toBeTruthy();
  });
});

describe('the referrer is shown before it is fixed forever', () => {
  it('names who referred them, and says it can never change', async () => {
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
    await waitFor(() => expect(container.querySelector('input')).not.toBeNull());
    const input = container.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'nova' } });
    await waitFor(() => expect(screen.getByText(/available/i)).toBeTruthy(), { timeout: 3000 });
  });

  it('reports one that is taken, and offers no way forward', async () => {
    mockAccount({ state: 'taken', owner: '0xsomebody' });
    const { container } = render(<JoinFlow referrer={null} />);
    await waitFor(() => expect(container.querySelector('input')).not.toBeNull());
    const input = container.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'nova' } });
    await waitFor(() => expect(screen.getByText(/taken/i)).toBeTruthy(), { timeout: 3000 });
    expect(screen.getByText('Check and continue').closest('button')?.disabled).toBe(true);
  });

  it('does not treat an unreadable registry as available', async () => {
    mockAccount({ error: 'the registry could not be read', kind: 'transport' });
    const { container } = render(<JoinFlow referrer={null} />);
    await waitFor(() => expect(container.querySelector('input')).not.toBeNull());
    const input = container.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'nova' } });
    await waitFor(() => expect(screen.queryByText(/available/i)).toBeNull(), { timeout: 3000 });
    expect(screen.getByText('Check and continue').closest('button')?.disabled).toBe(true);
  });

  it('explains why a handle is malformed instead of just refusing it', async () => {
    mockAccount({ state: 'invalid', problem: { kind: 'character', character: 'A' } });
    const { container } = render(<JoinFlow referrer={null} />);
    await waitFor(() => expect(container.querySelector('input')).not.toBeNull());
    const input = container.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Alice' } });
    await waitFor(() => expect(screen.getByText(/not allowed/i)).toBeTruthy(), { timeout: 3000 });
  });
});

describe('an address that already holds an account', () => {
  it('says so, rather than offering a handle it can never claim', async () => {
    mockAccount({ state: 'available' }, { account: { handle: 'nova' } });
    render(<JoinFlow referrer={null} />);

    await waitFor(() => expect(screen.queryByText(/already have an account/i)).not.toBeNull());
    expect(screen.getByText(/@nova/)).toBeTruthy();
    expect(screen.queryByLabelText(/CHOOSE A HANDLE/i)).toBeNull();
  });

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

describe('the quote belongs to the address it was simulated for', () => {
  async function simulateFor(address: string) {
    const calls = mockAccount(
      { state: 'available' },
      { prepare: { quote: { bytes: 'AAAAquote', gasMist: '2500000' } } },
    );
    signer = { address, kind: 'wallet', label: 'Slush', signTransaction: vi.fn(async () => 'sig') };
    const view = render(<JoinFlow referrer={null} />);
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
    const prepared = calls.find((call) => call.url.includes('/api/account/prepare'));
    expect((prepared?.body as { sender: string }).sender).toBe('0xda78');
  });

  it('drops a quote simulated for a different address when the wallet moves', async () => {
    const { view } = await simulateFor('0xda78');

    signer = { address: '0xother', kind: 'wallet', label: 'Slush', signTransaction: vi.fn(async () => 'sig') };
    view.rerender(<JoinFlow referrer={null} />);

    await waitFor(() => expect(screen.queryByText(/Simulated/)).toBeNull());
    expect(screen.queryByText('Check and continue')).not.toBeNull();
  });

  it('signs and submits exactly the bytes that were simulated', async () => {
    const { calls } = await simulateFor('0xda78');
    const sign = signer!.signTransaction;

    fireEvent.click(screen.getByText('Sign and register'));

    await waitFor(() => expect(sign).toHaveBeenCalledWith('AAAAquote'));
    const submitted = calls.find((call) => call.url.includes('/api/checkout/submit'));
    expect(submitted?.body).toEqual({ bytes: 'AAAAquote', signature: 'sig' });
  });
});

describe('the way in is never absent', () => {
  it('offers wallets to install when neither path is available', () => {
    const source = readFileSync(resolve(process.cwd(), 'components/SignIn.tsx'), 'utf8');
    const branch = source.slice(source.indexOf('wallets.length === 0 && unusableWallets.length === 0'));
    expect(branch).toContain('slush.app');
    expect(branch).toContain('phantom.app');
    expect(branch).toMatch(/w-btn--primary/);
  });

  it('leads with signing in, not with installing an extension', () => {
    const source = readFileSync(resolve(process.cwd(), 'components/SignIn.tsx'), 'utf8');
    const branch = source.slice(source.indexOf('wallets.length === 0 && unusableWallets.length === 0'));
    const signIn = branch.indexOf('href="/signin"');
    const slush = branch.indexOf('slush.app');
    expect(signIn).toBeGreaterThan(-1);
    expect(signIn, 'the sign-in link must come before the wallet installs').toBeLessThan(slush);
    expect(branch).toContain("pathname === '/signin' || pathname === '/join' ? null :");
  });
});
