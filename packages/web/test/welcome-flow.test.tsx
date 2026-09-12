// @vitest-environment happy-dom
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ADDRESS = '0xda784b6c20c5995f6b719a20a26eddee5ec971c8ecec890e61c8b4634dd1715d';
const signed: string[] = [];
let signer: { address: string; signPersonalMessage: (bytes: Uint8Array) => Promise<string> } | null = null;
const push = vi.fn();

vi.mock('@/components/SignerProvider', () => ({ useSigner: () => ({ signer }) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn() }), usePathname: () => '/welcome' }));

const { WelcomeFlow } = await import('../components/welcome/WelcomeFlow');

const SUGGESTED = [
  { handle: 'heron', displayName: 'Heron', owner: '0x1', followers: 12, isAgent: true, following: false },
  { handle: 'wren', displayName: 'Wren', owner: '0x2', followers: 9, isAgent: false, following: false },
  { handle: 'already', displayName: 'Already', owner: '0x3', followers: 1, isAgent: undefined, following: true },
];

function serveFollow(answer: (handle: string) => unknown = () => ({ following: true, followers: 1 })) {
  const calls: unknown[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url: string, init?: { body?: string }) => {
      const body = JSON.parse(init?.body ?? '{}') as { handle: string };
      calls.push(body);
      return { ok: true, status: 200, json: async () => answer(body.handle) };
    }),
  );
  return calls;
}

beforeEach(() => {
  signed.length = 0;
  push.mockClear();
  signer = {
    address: ADDRESS,
    signPersonalMessage: async (bytes) => {
      signed.push(new TextDecoder().decode(bytes));
      return 'sig';
    },
  };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('suggested for you', () => {
  it('lists the suggestions, marks the declared agent, and shows who is already followed', () => {
    serveFollow();
    render(<WelcomeFlow suggestions={SUGGESTED} handle="nova" />);
    expect(screen.getByText('Suggested for you')).toBeTruthy();
    expect(screen.getByText('Heron')).toBeTruthy();
    expect(screen.getByText('Declared agent')).toBeTruthy();
    expect(screen.getAllByText('Following')).toHaveLength(1);
  });

  it('follows one account with the same signed statement the follow button uses', async () => {
    const calls = serveFollow();
    render(<WelcomeFlow suggestions={SUGGESTED} handle="nova" />);
    fireEvent.click(screen.getAllByText('Follow')[0]!);
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(signed[0]).toContain('action: follow\ncreator: heron');
    expect(calls[0]).toMatchObject({ handle: 'heron', follower: ADDRESS, following: true, signature: 'sig' });
    await waitFor(() => expect(screen.getAllByText('Following')).toHaveLength(2));
  });

  it('follows all the rest, one signature each, in order', async () => {
    const calls = serveFollow();
    render(<WelcomeFlow suggestions={SUGGESTED} handle="nova" />);
    fireEvent.click(screen.getByText('Follow all'));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(signed.map((s) => s.split('creator: ')[1])).toEqual(['heron', 'wren']);
    await waitFor(() => expect(screen.queryByText('Follow all')).toBeNull());
  });

  it('shows the server’s refusal instead of pretending', async () => {
    serveFollow(() => ({ error: 'that page does not exist' }));
    render(<WelcomeFlow suggestions={SUGGESTED} handle="nova" />);
    fireEvent.click(screen.getAllByText('Follow')[0]!);
    await waitFor(() => expect(screen.getByText('that page does not exist')).toBeTruthy());
  });

  it('skips straight to the introduction', () => {
    serveFollow();
    render(<WelcomeFlow suggestions={SUGGESTED} handle="nova" />);
    fireEvent.click(screen.getByText('Skip'));
    expect(screen.getByText(/Three things before you go/)).toBeTruthy();
  });
});

describe('the introduction', () => {
  it('walks three slides and lands in the feed', () => {
    serveFollow();
    render(<WelcomeFlow suggestions={[]} handle="nova" />);
    expect(screen.getByText('Your keys stay on your device')).toBeTruthy();
    fireEvent.click(screen.getByText('Next'));
    fireEvent.click(screen.getByText('Next'));
    expect(screen.getByText('What you pay for lands in your wallet')).toBeTruthy();
    fireEvent.click(screen.getByText('Let’s go'));
    expect(push).toHaveBeenCalledWith('/feed');
  });

  it('can be skipped to the feed at any slide', () => {
    serveFollow();
    render(<WelcomeFlow suggestions={[]} handle="nova" />);
    fireEvent.click(screen.getByText('Skip'));
    expect(push).toHaveBeenCalledWith('/feed');
  });
});
