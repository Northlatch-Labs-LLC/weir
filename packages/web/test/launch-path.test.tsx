// @vitest-environment happy-dom
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const OPERATOR = '0x9c8f6a1d2b4e7c05a3f18d6b29e4c7a0f5b3d8e1c6a94f27b0d5e83a1c6f492b';
const AGENT = '0xda784b6c20c5995f6b719a20a26eddee5ec971c8ecec890e61c8b4634dd1715d';
let signer: { address: string } | null = null;

vi.mock('@/components/SignerProvider', () => ({ useSigner: () => ({ signer }) }));
vi.mock('next/navigation', () => ({ usePathname: () => '/agents/build', useRouter: () => ({ push: vi.fn() }) }));

const { LaunchPath } = await import('../components/agents/LaunchPath');

type Answer = { status?: number; body: unknown };
function serve(answers: Record<string, Answer | ((url: string) => Answer)>) {
  const seen: string[] = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    seen.push(url);
    const key = Object.keys(answers).find((k) => url.includes(k));
    const found = key === undefined ? { status: 501, body: {} } : answers[key]!;
    const answer = typeof found === 'function' ? found(url) : found;
    const status = answer.status ?? 200;
    return { ok: status < 400, status, json: async () => answer.body } as Response;
  }) as unknown as typeof fetch;
  return { fetchImpl, seen };
}

beforeEach(() => {
  signer = null;
});
afterEach(cleanup);

describe('the command', () => {
  it('fills in the handle and the operator address the reader is signed in with', async () => {
    signer = { address: OPERATOR };
    const { fetchImpl } = serve({ '/api/agents/sponsor': { body: { offered: true, seatsRemaining: 41, seatsTotal: 50 } }, '/api/account?handle=': { body: { handle: { state: 'available' } } } });
    const { container } = render(<LaunchPath fetchImpl={fetchImpl} />);
    fireEvent.change(container.querySelector('#agent-handle')!, { target: { value: 'Heron' } });
    const command = container.querySelector('.w-cmd')!.textContent ?? '';
    expect(command).toContain('node register-agent.mjs heron ' + OPERATOR);
    expect(command).toContain('curl -fsSLO https://weir.social/register-agent.mjs');
  });

  it('shows the placeholders and points a stranger at the door', () => {
    const { fetchImpl } = serve({ '/api/agents/sponsor': { body: { offered: true, seatsRemaining: 41, seatsTotal: 50 } } });
    const { container } = render(<LaunchPath fetchImpl={fetchImpl} />);
    expect(container.querySelector('.w-cmd')!.textContent).toContain('<handle> <your-sui-address>');
    expect(screen.getByText('Sign in').closest('a')?.getAttribute('href')).toBe('/signin?next=/agents/build');
  });

  it('reads how many sponsored seats remain, and says so when none are offered', async () => {
    const offered = serve({ '/api/agents/sponsor': { body: { offered: true, seatsRemaining: 41, seatsTotal: 50 } } });
    render(<LaunchPath fetchImpl={offered.fetchImpl} />);
    await waitFor(() => expect(screen.getByText(/41 of 50 sponsored registrations remain/)).toBeTruthy());
    cleanup();
    const closed = serve({ '/api/agents/sponsor': { body: { offered: false, reason: 'no sponsor key', seatsTotal: 50 } } });
    render(<LaunchPath fetchImpl={closed.fetchImpl} />);
    await waitFor(() => expect(screen.getByText(/not offered here: no sponsor key/)).toBeTruthy());
  });
});

describe('watching it wake', () => {
  it('reads the account, the declaration, the vault and the first post from the public routes', async () => {
    const { fetchImpl, seen } = serve({
      '/api/agents/sponsor': { body: { offered: true, seatsRemaining: 1, seatsTotal: 50 } },
      '/api/account?handle=': { body: { handle: { state: 'taken', owner: AGENT } } },
      [`/api/agents/${AGENT}`]: { body: { agent: { model: 'claude-sonnet-5', purpose: 'reads the network' } } },
      '/api/creator?owner=': { body: { stage: 'ready', vaults: [{ handle: 'heron', displayName: 'Heron' }] } },
      '/api/browse?kind=posts': { body: { items: [{ id: 'p1', title: 'First light', authorHandle: 'heron' }] } },
    });
    const { container } = render(<LaunchPath fetchImpl={fetchImpl} />);
    fireEvent.change(container.querySelector('#agent-handle')!, { target: { value: 'heron' } });
    fireEvent.click(screen.getByText('Watch @heron'));
    await waitFor(() => expect(screen.getByText(/is held by/)).toBeTruthy());
    await waitFor(() => expect(screen.getByText(/Standing\. Model claude-sonnet-5/)).toBeTruthy());
    expect(screen.getByText(/Open and named “Heron”/)).toBeTruthy();
    expect(screen.getByText('First light').closest('a')?.getAttribute('href')).toBe('/p/p1');
    expect(container.querySelectorAll('.w-watch__row[data-state="done"]')).toHaveLength(4);
    expect(seen.some((u) => u.includes(`/api/agents/${AGENT}`))).toBe(true);
  });

  it('shows an unclaimed name as waiting and a route that did not answer as unread, never as absent', async () => {
    const { fetchImpl } = serve({
      '/api/agents/sponsor': { body: { offered: true, seatsRemaining: 1, seatsTotal: 50 } },
      '/api/account?handle=': { body: { handle: { error: 'the registry could not be read', kind: 'transport' } } },
    });
    const { container } = render(<LaunchPath fetchImpl={fetchImpl} />);
    fireEvent.change(container.querySelector('#agent-handle')!, { target: { value: 'wren' } });
    fireEvent.click(screen.getByText('Watch @wren'));
    await waitFor(() => expect(screen.getByText(/The register could not be read: the registry could not be read/)).toBeTruthy());
    expect(container.querySelectorAll('.w-watch__row[data-state="unread"]')).toHaveLength(1);
    expect(screen.getByText('Waits for the account.')).toBeTruthy();
  });
});
