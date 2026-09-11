// @vitest-environment happy-dom
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

let signer: { address: string; signTransaction: ReturnType<typeof vi.fn> } | null = null;
vi.mock('@/components/SignerProvider', () => ({ useSigner: () => ({ signer }) }));
vi.mock('@/components/SignIn', () => ({ SignIn: () => <div>sign in</div> }));

const { StudioComposer } = await import('../components/StudioComposer');

function vault(handle: string | null, vaultId = '0xvault') {
  return { vaultId, coinType: '0x2::sui::SUI', handle };
}

function mockCreator(body: unknown, ok = true) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok, status: ok ? 200 : 502, json: async () => body })),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  signer = null;
});

describe('StudioComposer', () => {
  it('asks for a wallet instead of showing a form nobody can submit', () => {
    signer = null;
    render(<StudioComposer />);

    expect(screen.getByText('sign in')).toBeTruthy();
    expect(screen.queryByLabelText(/^TITLE$/)).toBeNull();
  });

  it('loads the publish target, which is what made the publish button reachable', async () => {
    signer = { address: '0xalice', signTransaction: vi.fn() };
    mockCreator({ stage: 'ready', vaults: [vault('alice')] });
    render(<StudioComposer />);

    await waitFor(() => expect(screen.getByText(/Publishing as/)).toBeTruthy());
    expect(screen.getByText('@alice')).toBeTruthy();
    expect(screen.getByLabelText(/^TITLE$/)).toBeTruthy();
  });

  it('offers a choice when a creator holds more than one published vault', async () => {
    signer = { address: '0xalice', signTransaction: vi.fn() };
    mockCreator({
      stage: 'ready',
      vaults: [vault('alice', '0xaaa1'), vault('alicemusic', '0xbbb2')],
    });
    render(<StudioComposer />);

    const picker = await screen.findByLabelText(/^PUBLISH TO$/);
    expect(picker.querySelectorAll('option')).toHaveLength(2);
    expect(screen.queryByText(/Publishing as/)).toBeNull();
  });

  it('withholds the composer when a vault exists but has never been named', async () => {
    signer = { address: '0xalice', signTransaction: vi.fn() };
    mockCreator({ stage: 'ready', vaults: [vault(null)] });
    render(<StudioComposer />);

    await waitFor(() => expect(screen.getByText('No named vault')).toBeTruthy());
    expect(screen.queryByLabelText(/^TITLE$/)).toBeNull();
  });

  it('does not report "no vault" when the read simply failed', async () => {
    signer = { address: '0xalice', signTransaction: vi.fn() };
    mockCreator({ error: 'grpc unavailable' }, false);
    render(<StudioComposer />);

    await waitFor(() => expect(screen.getByText('Reading from the chain')).toBeTruthy());
    expect(screen.queryByText('No named vault')).toBeNull();
    expect(screen.queryByLabelText(/^TITLE$/)).toBeNull();
  });
});
