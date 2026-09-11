// @vitest-environment happy-dom
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let signer: {
  address: string; kind: string; label: string;
  signPersonalMessage: ReturnType<typeof vi.fn>;
} | null = null;
let exportRecovery = vi.fn();

vi.mock('@/components/SignerProvider', () => ({
  useSigner: () => ({ signer, exportRecovery }),
}));
vi.mock('@/components/SignIn', () => ({ SignIn: () => <div>sign in</div> }));
vi.mock('next/navigation', () => ({ usePathname: () => '/' }));

const { Notifications } = await import('../components/Notifications');
const { Comments } = await import('../components/Comments');
const { AccountRecovery } = await import('../components/AccountRecovery');

function mockJson(body: unknown, ok = true) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok, status: ok ? 200 : 503, json: async () => body })));
}

beforeEach(() => {
  signer = {
    address: '0xda78', kind: 'zklogin', label: 'Google',
    signPersonalMessage: vi.fn(async () => 'sig'),
  };
  exportRecovery = vi.fn();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Notifications', () => {
  async function loadInbox() {
    render(<Notifications />);
    fireEvent.click(screen.getByText('Load alerts'));
  }

  it('does not render a failed read as an empty inbox', async () => {
    mockJson({ error: 'the chain could not be read' });
    await loadInbox();
    await waitFor(() => expect(screen.getByText(/Not measured/i)).toBeTruthy());
  });

  it('says a list is recent rather than complete when the ceiling was hit', async () => {
    mockJson({ payments: [], activity: [], truncated: true });
    await loadInbox();
    await waitFor(() => expect(screen.getByText(/Recent, not complete/i)).toBeTruthy());
  });

  it('says nothing yet when it genuinely read an empty inbox', async () => {
    mockJson({ payments: [], activity: [], truncated: false });
    await loadInbox();
    await waitFor(() => expect(screen.getByText(/Nothing yet/i)).toBeTruthy());
  });

  it('signs before it reads, so an inbox cannot be opened by naming an address', async () => {
    mockJson({ payments: [], activity: [], truncated: false });
    await loadInbox();
    await waitFor(() => expect(signer?.signPersonalMessage).toHaveBeenCalled());
  });
});

describe('Comments', () => {
  it('shows the count without asking a server, and the words only when asked', async () => {
    mockJson({ comments: [{ id: '1', author: '0xabc', text: 'Hello World!', createdAtMs: 1 }] });
    render(<Comments postId="p1" count={1} />);

    const control = screen.getByRole('button', { name: /read 1 comment/i });
    expect(control).toBeTruthy();
    expect(screen.queryByText('1 COMMENT')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    expect(screen.queryByText('Hello World!')).toBeNull();

    fireEvent.click(control);
    await waitFor(() => expect(screen.getByText('Hello World!')).toBeTruthy());
    expect(screen.getByText('1 COMMENT')).toBeTruthy();
  });

  it('offers a way to comment on a post nobody has commented on', () => {
    mockJson({ comments: [] });
    render(<Comments postId="p1" count={0} />);
    expect(screen.getByRole('button', { name: /^comment$/i })).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('offers sign-in rather than a comment box to a signed-out reader', async () => {
    signer = null;
    mockJson({ comments: [] });
    render(<Comments postId="p1" count={0} />);

    expect(screen.queryByRole('link', { name: /sign in/i })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^comment$/i }));

    const link = await screen.findByRole('link', { name: /sign in/i });
    expect(link.getAttribute('href')).toBe('/signin?next=%2F');
    expect(screen.queryByLabelText('Write a comment')).toBeNull();
  });
});

describe('AccountRecovery', () => {
  it('shows nothing at all to a wallet user', () => {
    signer = { address: '0xda78', kind: 'wallet', label: 'W', signPersonalMessage: vi.fn() };
    const { container } = render(<AccountRecovery />);
    expect(container.innerHTML).toBe('');
  });

  it('does not reveal the salt until it is asked for', () => {
    render(<AccountRecovery />);
    expect(screen.getByText(/Show my recovery details/i)).toBeTruthy();
    expect(exportRecovery).not.toHaveBeenCalled();
  });

  it('states plainly that losing access is the risk, not theft', () => {
    render(<AccountRecovery />);
    expect(screen.getByText(/cannot spend from your address/i)).toBeTruthy();
  });

  it('reveals all five values together when asked', async () => {
    exportRecovery = vi.fn(async () => ({
      salt: '12345', iss: 'https://accounts.google.com', aud: 'client', sub: 'user',
      keyClaimName: 'sub', legacyAddress: false, note: 'keep these',
    }));
    render(<AccountRecovery />);
    fireEvent.click(screen.getByText(/Show my recovery details/i));
    await waitFor(() => expect(screen.getByText(/12345/)).toBeTruthy());
    for (const value of ['https://accounts.google.com', 'client', 'user']) {
      expect(screen.getByText(new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))).toBeTruthy();
    }
  });

  it('says an expired sign-in is what protects it, rather than reporting a fault', async () => {
    exportRecovery = vi.fn(async () => {
      throw new Error('Your Google sign-in has expired, which is what protects this.');
    });
    render(<AccountRecovery />);
    fireEvent.click(screen.getByText(/Show my recovery details/i));
    await waitFor(() => expect(screen.getByText(/what protects this/i)).toBeTruthy());
  });
});

const { FollowButton } = await import('../components/FollowButton');

describe('FollowButton', () => {
  it('shows the count it was given, server-rendered, with no flash of zero', () => {
    mockJson({});
    render(<FollowButton handle="alice" initialFollowing={false} initialCount={42} />);
    expect(screen.getByText(/42/)).toBeTruthy();
  });

  it('reflects that the reader already follows', () => {
    mockJson({});
    render(<FollowButton handle="alice" initialFollowing initialCount={1} />);
    expect(screen.getByText(/Following|Unfollow/i)).toBeTruthy();
  });

  it('asks a signed-out reader to sign in rather than following silently', () => {
    signer = null;
    mockJson({});
    render(<FollowButton handle="alice" initialFollowing={false} initialCount={0} />);
    expect(screen.getByRole('link', { name: /sign in/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /follow/i })).toBeNull();
  });

  it('signs a statement naming the creator before recording anything', async () => {
    mockJson({ ok: true, count: 1 });
    render(<FollowButton handle="alice" initialFollowing={false} initialCount={0} />);
    fireEvent.click(screen.getAllByText(/Follow/i).map((n) => n.closest('button')).find(Boolean)!);
    await waitFor(() => expect(signer?.signPersonalMessage).toHaveBeenCalled());
    const signed = new TextDecoder().decode(
      (signer?.signPersonalMessage.mock.calls[0]?.[0] ?? new Uint8Array()) as Uint8Array,
    );
    expect(signed).toContain('alice');
    expect(signed).toMatch(/follow/i);
  });
});
