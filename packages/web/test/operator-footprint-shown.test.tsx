// @vitest-environment happy-dom
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { AgentsDirectoryScreen, type AgentEntryView } from '@/components/app/AgentsDirectoryScreen';

vi.mock('next/navigation', () => ({
  usePathname: () => '/c/nova',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/components/SignerProvider', () => ({
  useSigner: () => ({
    signer: null,
    signOut: vi.fn(),
    signInWithGoogle: vi.fn(),
    wallets: [],
    unusableWallets: [],
    connectWallet: vi.fn(),
    accountChoice: null,
    chooseAccount: vi.fn(),
    cancelAccountChoice: vi.fn(),
    error: null,
    session: { network: 'mainnet', available: true },
  }),
}));

afterEach(cleanup);

const base: AgentEntryView = {
  address: `0x${'ab'.repeat(32)}`,
  handle: 'wanderer',
  name: 'Wanderer',
  model: 'pi-coding-agent',
  purpose: 'sells analysis',
  declared: 'Declared 2 Sep 2026',
  recordHref: '/agents/wanderer',
  operatorSeen: null,
};

const show = (entry: AgentEntryView): string =>
  render(<AgentsDirectoryScreen entries={[entry]} state="listed" note="" viewerAddress={null} viewerHandle={null} />).container.textContent ?? '';

describe('what the directory says about an operator', () => {
  it('says an operator held funds, with the date it was checked', () => {
    expect(show({ ...base, operatorSeen: { state: 'seen', when: '3 Sep 2026' } })).toMatch(
      /held funds on chain when checked, 3 Sep 2026/,
    );
  });

  it('reports nothing on chain WITHOUT calling it a forgery', () => {
    const text = show({ ...base, operatorSeen: { state: 'unseen', when: '3 Sep 2026' } });
    expect(text).toMatch(/held nothing on chain when checked, 3 Sep 2026/);
    expect(text).toMatch(/what an unused wallet looks like/);
    for (const verdict of ['fake', 'forged', 'fraud', 'suspicious', 'invalid']) {
      expect(text.toLowerCase()).not.toContain(verdict);
    }
  });

  it('an unreadable chain is stated as unread, never as nothing there', () => {
    const text = show({ ...base, operatorSeen: { state: 'not-measured', when: '3 Sep 2026' } });
    expect(text).toMatch(/reading the chain again now/);
    expect(text).not.toMatch(/held nothing/);
  });

  it('says nothing at all when nobody looked', () => {
    const text = show(base);
    expect(text).not.toMatch(/on chain when checked/);
    expect(text).not.toMatch(/reading the chain again now/);
    expect(text).toMatch(/Wanderer/);
  });
});
