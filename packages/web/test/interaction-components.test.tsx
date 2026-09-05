// @vitest-environment happy-dom
// Built-by: @projectx.sui · Co-authored-by: Claude
/**
 * Notifications, comments, following, and account recovery.
 *
 * The first three are where somebody is asked to sign a statement rather than a transaction — no
 * gas, no money, but a signature all the same. What matters is that they are never asked to sign
 * something the interface has not shown them, and that a failed read never renders as "nothing
 * happened".
 *
 * `AccountRecovery` is the opposite problem: it holds the one value that ends a user's dependency
 * on this platform, and it must not reveal it until somebody deliberately asks.
 */

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
/*
  `SignInPrompt` reads the current path so signing in returns the reader to the post they were
  on. Mocked here rather than rendered for real: this file is about what Comments and FollowButton
  withhold from a signed-out reader, and routing is not that.
*/
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
  /*
   * Reading the inbox is signed, so nothing loads until it is asked for. The click is the whole
   * point — a personal inbox that fetched on mount would be readable by naming an address.
   */
  async function loadInbox() {
    render(<Notifications />);
    fireEvent.click(screen.getByText('Load alerts'));
  }

  it('does not render a failed read as an empty inbox', async () => {
    /*
     * Identical on screen, opposite in meaning. "Nothing has happened" is a fact somebody can rely
     * on; "we could not look" is not, and a creator who missed a payment because of it would have
     * no reason to check.
     */
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
  it('shows comments it read', async () => {
    mockJson({ comments: [{ id: '1', author: '0xabc', text: 'Hello World!', createdAtMs: 1 }] });
    render(<Comments postId="p1" />);
    await waitFor(() => expect(screen.getByText('Hello World!')).toBeTruthy());
  });

  it('offers sign-in rather than a comment box to a signed-out reader', async () => {
    // Commenting needs a signature proving control of the address, so there is nothing to type
    // into until somebody is signed in.
    signer = null;
    mockJson({ comments: [] });
    render(<Comments postId="p1" />);
    // The prompt, not a comment box: commenting needs a signature, so there is nothing to type into.
    const link = await screen.findByRole('link', { name: /sign in/i });
    expect(link.getAttribute('href')).toBe('/signin?next=%2F');
    expect(screen.queryByLabelText('Write a comment')).toBeNull();
  });
});

describe('AccountRecovery', () => {
  it('shows nothing at all to a wallet user', () => {
    /*
     * A wallet session has no salt and never depended on this deployment for anything. Rendering a
     * recovery panel would imply a risk they do not carry.
     */
    signer = { address: '0xda78', kind: 'wallet', label: 'W', signPersonalMessage: vi.fn() };
    const { container } = render(<AccountRecovery />);
    expect(container.innerHTML).toBe('');
  });

  it('does not reveal the salt until it is asked for', () => {
    /*
     * Reading it spends a fresh Google-signed token, and the act of asking should be as deliberate
     * as the value deserves. A panel that fetched on mount would put it in every screenshot of
     * somebody showing a colleague their profile.
     */
    render(<AccountRecovery />);
    expect(screen.getByText(/Show my recovery details/i)).toBeTruthy();
    expect(exportRecovery).not.toHaveBeenCalled();
  });

  it('states plainly that losing access is the risk, not theft', () => {
    // The honest framing. This deployment can compute the address; it cannot spend from it.
    render(<AccountRecovery />);
    expect(screen.getByText(/cannot spend from your address/i)).toBeTruthy();
  });

  it('reveals all five values together when asked', async () => {
    /*
     * A salt alone recovers nothing — the address is a function of iss, aud, sub and the salt. One
     * block, one copy button, because somebody who kept only the interesting-looking number would
     * discover that with no working deployment left to ask.
     */
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
    // Google tokens are short-lived by design. "Sign in again" is the remedy, and calling it an
    // error would send somebody looking for a broken thing.
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
    /*
     * The count arrives as a prop from the page's own chain read. Fetching it here would render a
     * zero first and correct it a moment later, which reads as a creator losing followers.
     */
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
    // Following is a signed statement. There is nothing to record for somebody who cannot sign.
    signer = null;
    mockJson({});
    render(<FollowButton handle="alice" initialFollowing={false} initialCount={0} />);
    expect(screen.getByRole('link', { name: /sign in/i })).toBeTruthy();
    // No Follow button at all, rather than one that fails when pressed.
    expect(screen.queryByRole('button', { name: /follow/i })).toBeNull();
  });

  it('signs a statement naming the creator before recording anything', async () => {
    /*
     * The statement names the action and the target, so a captured signature cannot be replayed
     * onto a different creator. Verified server-side against a statement rebuilt from the request,
     * never taken from it.
     */
    mockJson({ ok: true, count: 1 });
    render(<FollowButton handle="alice" initialFollowing={false} initialCount={0} />);
    // The button, not the follower-count label that also contains the word.
    fireEvent.click(screen.getAllByText(/Follow/i).map((n) => n.closest('button')).find(Boolean)!);
    await waitFor(() => expect(signer?.signPersonalMessage).toHaveBeenCalled());
    const signed = new TextDecoder().decode(
      (signer?.signPersonalMessage.mock.calls[0]?.[0] ?? new Uint8Array()) as Uint8Array,
    );
    expect(signed).toContain('alice');
    expect(signed).toMatch(/follow/i);
  });
});
