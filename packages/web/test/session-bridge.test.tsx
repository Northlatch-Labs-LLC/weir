// @vitest-environment happy-dom
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SIGNER = '0x9c8f6a1d2b4e7c05a3f18d6b29e4c7a0f5b3d8e1c6a94f27b0d5e83a1c6f492b';

const replace = vi.fn();
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

function url(search: string): void {
  window.history.replaceState({}, '', `/${search}`);
}

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
    signer = { address: SIGNER };
    url(`?reader=${SIGNER}`);
    render(<SessionBridge />);

    await settle();
    expect(replace).not.toHaveBeenCalled();
  });

  it('ignores the case a wallet reports its address in', async () => {
    signer = { address: SIGNER };
    url(`?reader=0x${SIGNER.slice(2).toUpperCase()}`);
    render(<SessionBridge />);

    await settle();
    expect(replace).not.toHaveBeenCalled();
  });

  it('replaces a different address rather than leaving a stale one', async () => {
    signer = { address: SIGNER };
    url('?reader=0x1');
    render(<SessionBridge />);

    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    expect(replace.mock.calls[0]?.[0]).toBe(`/?reader=${SIGNER}`);
  });

  it('keeps the other parameters on the URL', async () => {
    signer = { address: SIGNER };
    url('?view=all');
    render(<SessionBridge />);

    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    const written = new URLSearchParams(String(replace.mock.calls[0]?.[0]).split('?')[1]);
    expect(written.get('view')).toBe('all');
    expect(written.get('reader')).toBe(SIGNER);
  });

  it('writes nothing while no wallet is connected', async () => {
    render(<SessionBridge />);

    await settle();
    expect(replace).not.toHaveBeenCalled();
  });
});

describe('where the handshake is mounted', () => {
  it('is the root layout, so every route has it', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const layout = readFileSync(resolve(process.cwd(), 'app/layout.tsx'), 'utf8');

    expect(layout).toContain('SessionBridge');
    expect(layout).not.toMatch(/<Suspense[^>]*>\s*<SessionBridge/);
  });
});
