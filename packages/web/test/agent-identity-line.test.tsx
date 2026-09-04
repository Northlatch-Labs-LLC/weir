// @vitest-environment happy-dom
// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/**
 * The identity line for a declared agent, on the creator page.
 *
 * # The rule, and the three states
 *
 * A profile says "Declared agent" only for a LIVE row of the declaration register. No row, or a
 * withdrawn row, says nothing — not "human", not "unverified" — because the register proves a
 * declaration was made and never that one was not. An unread register says one quiet sentence
 * with no claim in it, so it is still told apart from "nobody has said" by anyone who looks.
 *
 * `agentIdentityFor` is the pure rule; `DesignCreator` is where it becomes a line. Both are
 * asserted, and the line and the pill on every post come from the same answer, so they cannot
 * disagree (`authorIsAgentFrom`).
 */

import { cleanup, render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentAccount } from '../lib/agents';
import { REGISTER_UNREAD_LINE, agentIdentityFor, authorIsAgentFrom, type DesignAgentIdentity } from '../lib/agent-identity';
import { AGENT_PILL_TITLE } from '../components/design/ExploreFunnel';

vi.mock('next/navigation', () => ({ usePathname: () => '/c/kaela', useSearchParams: () => new URLSearchParams() }));
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
vi.mock('@/components/SignIn', () => ({ SignIn: () => <div>sign in</div> }));

const { DesignCreator } = await import('@/components/design/Creator');

afterEach(cleanup);

const ADDRESS = `0x${'a'.repeat(64)}`;
function account(revokedAtMs: number | null = null): AgentAccount {
  return {
    address: ADDRESS,
    operatorAddress: `0x${'b'.repeat(64)}`,
    agentSignature: 'AAAA',
    operatorSignature: 'BBBB',
    model: 'claude-opus-5',
    purpose: 'publishes engineering notes <b>and nothing else</b>',
    declaredAtMs: Date.UTC(2026, 8, 1, 12),
    revokedAtMs,
  };
}

describe('agentIdentityFor — the rule', () => {
  it('a live row is declared, with the record path and the signed instant', () => {
    const id = agentIdentityFor(account());
    expect(id).toEqual({
      state: 'declared',
      model: 'claude-opus-5',
      purpose: 'publishes engineering notes <b>and nothing else</b>',
      declared: 'Declared Sep 1, 2026',
      recordPath: `/api/agents/${ADDRESS}`,
    });
  });
  it('no row is none', () => {
    expect(agentIdentityFor(null)).toEqual({ state: 'none' });
  });
  it('a withdrawn row is none — not declared, and nothing invented until D-6 is ruled', () => {
    expect(agentIdentityFor(account(Date.UTC(2026, 8, 2)))).toEqual({ state: 'none' });
  });
  it('an unread register is unread, never none', () => {
    expect(agentIdentityFor(undefined)).toEqual({ state: 'unread' });
  });
  it('gives the pill exactly the same answer', () => {
    expect(authorIsAgentFrom(agentIdentityFor(account()))).toBe(true);
    expect(authorIsAgentFrom(agentIdentityFor(null))).toBe(false);
    expect(authorIsAgentFrom(agentIdentityFor(account(1)))).toBe(false);
    expect(authorIsAgentFrom(agentIdentityFor(undefined))).toBeUndefined();
  });
});

function page(agent?: DesignAgentIdentity) {
  return render(
    <DesignCreator
      signedIn={false}
      myHandle={null}
      profile={{ handle: 'kaela', displayName: 'Kaela', bio: 'writes', initials: 'ka', meta: '@kaela · 3 followers', sui: 'kaela', ...(agent === undefined ? {} : { agent }) }}
      tiers={[]}
      stats={[]}
      profilePosts={[]}
      viewingLabel="No posts yet."
      tiersHref={undefined}
      tiersLabel="No vault"
      subscribeSlot={<button type="button">Follow</button>}
      depositSlot={<div />}
      tipSlot={<div />}
      depositLine=""
      depositNote=""
      tab="posts"
      perks={[]}
      tabHref={{ posts: '/c/kaela', membership: '/c/kaela?tab=membership' }}
    />,
  );
}

const identityBlock = (container: HTMLElement) => container.querySelector('.weir-identity') as HTMLElement;

describe('the line on the page', () => {
  it('a declared agent gets the line, the same pill as its posts, and the record to verify it against', () => {
    const { container } = page(agentIdentityFor(account()));
    const block = identityBlock(container);
    const line = block.querySelector('[data-agent-identity="declared"]') as HTMLElement;
    expect(line).not.toBeNull();
    expect(line.textContent).toContain('Declared agent · verified by two signatures');
    const pill = line.querySelector('.pill');
    expect(pill?.textContent).toBe('Agent');
    expect(pill?.getAttribute('title')).toBe(AGENT_PILL_TITLE);
    const links = [...line.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(links.every((h) => h === `/api/agents/${ADDRESS}`)).toBe(true);
    expect(links.some((h) => /^https?:/.test(h ?? ''))).toBe(false);
  });

  it('renders the parties’ signed words as text, never as markup', () => {
    const { container } = page(agentIdentityFor(account()));
    const line = identityBlock(container).querySelector('[data-agent-identity="declared"]') as HTMLElement;
    expect(line.textContent).toContain('Purpose: publishes engineering notes <b>and nothing else</b>.');
    expect(line.querySelector('b')).toBeNull();
    expect(line.textContent).toContain('Model: claude-opus-5.');
    expect(line.textContent).toContain('Declared Sep 1, 2026.');
  });

  it('does not show the operator’s address — D-2 is not ruled', () => {
    const { container } = page(agentIdentityFor(account()));
    expect(container.textContent ?? '').not.toContain('b'.repeat(64));
  });

  it('an undeclared account gets no line containing "agent" — and neither does a caller that did not look', () => {
    for (const agent of [agentIdentityFor(null), undefined]) {
      const { container } = page(agent);
      const block = identityBlock(container);
      expect(block.querySelector('[data-agent-identity]')).toBeNull();
      expect(block.textContent ?? '').not.toMatch(/agent/i);
      expect(block.textContent ?? '').not.toMatch(/human|unverified|unknown/i);
      cleanup();
    }
  });

  it('a withdrawn declaration renders exactly what an undeclared account renders', () => {
    const { container } = page(agentIdentityFor(account(Date.UTC(2026, 8, 2))));
    expect(identityBlock(container).querySelector('[data-agent-identity]')).toBeNull();
  });

  it('an unread register says so in one sentence with no claim in it', () => {
    const { container } = page(agentIdentityFor(undefined));
    const block = identityBlock(container);
    const line = block.querySelector('[data-agent-identity="unread"]') as HTMLElement;
    expect(line.textContent).toBe(REGISTER_UNREAD_LINE);
    expect(block.textContent ?? '').not.toMatch(/agent/i);
    expect(REGISTER_UNREAD_LINE).not.toMatch(/agent/i);
  });

  it('paints with theme tokens only, so both themes render it', () => {
    const source = readFileSync(join(process.cwd(), 'components', 'design', 'Creator.tsx'), 'utf8');
    const start = source.indexOf('data-agent-identity="declared"');
    const end = source.indexOf('{REGISTER_UNREAD_LINE}');
    const block = source.slice(start, end);
    for (const m of block.matchAll(/color: '([^']+)'/g)) expect(m[1]).toMatch(/^var\(--/);
  });
});
