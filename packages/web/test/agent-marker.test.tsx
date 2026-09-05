// @vitest-environment happy-dom
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/**
 * "Declared agents carry a marker on every post." — `/agents` has said so since the register
 * shipped, and until this change nothing in the product delivered it: `PostCard` drew the pill for
 * an `authorIsAgent` nobody passed. This file is the mechanism behind the sentence.
 *
 * Two layers. `agentFlag` is the pure rule — an author is marked iff the register answered and the
 * author's owner is in the answer; an unread register or an unknown owner marks nobody in EITHER
 * direction. `DesignHome` is where the flag becomes a pill, asserted on the rendered card.
 */

import { cleanup, render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { agentFlag } from '../lib/agents';
import { DesignHome, type DesignFeedPost } from '../components/design/Home';
import type { VisiblePost } from '../lib/content';

// The card's buy control asks who is signed in; nobody is, and that is the whole of what it needs.
vi.mock('@/components/SignerProvider', () => ({ useSigner: () => ({ signer: null }) }));
vi.mock('@/components/SignIn', () => ({ SignIn: () => <div>sign in</div> }));

afterEach(cleanup);

const web = process.cwd();
const read = (p: string): string => readFileSync(join(web, p), 'utf8');

const hex = (c: string) => `0x${c.repeat(64)}`;
const DECLARED = hex('a');
const OTHER = hex('b');

describe('agentFlag — the rule', () => {
  const answered = new Set([DECLARED]);

  it('marks the owner the register named', () => {
    expect(agentFlag(answered, DECLARED)).toBe(true);
  });

  it('says no for an owner the register did not name', () => {
    expect(agentFlag(answered, OTHER)).toBe(false);
  });

  it('says nothing when nobody looked, in either direction', () => {
    expect(agentFlag(undefined, DECLARED)).toBeUndefined();
    expect(agentFlag(undefined, OTHER)).toBeUndefined();
  });

  it('says nothing for an author with no owner, or an owner that is not an address', () => {
    expect(agentFlag(answered, undefined)).toBeUndefined();
    expect(agentFlag(answered, 'not-an-address')).toBeUndefined();
  });

  it('matches on the canonical address, not the spelling', () => {
    // A short-form or upper-case spelling of the declared address is the same key.
    expect(agentFlag(answered, DECLARED.toUpperCase().replace('0X', '0x'))).toBe(true);
  });
});

function post(id: string, authorHandle: string): VisiblePost {
  return {
    id,
    vaultId: hex('e'),
    authorHandle,
    createdAtMs: 1_756_700_000_000,
    title: `Post ${id}`,
    preview: 'preview',
    access: { kind: 'public' },
    body: 'words',
    locked: false,
    unlockWith: null,
  };
}

function home(feed: DesignFeedPost[]) {
  return render(
    <DesignHome
      signedIn={false}
      myHandle={null}
      feed={feed}
      feedTabs={[{ href: '/feed', label: 'Everything', current: true }]}
      feedEmptyMessage="No posts yet."
      creators={[]}
      creatorCount="0 creators"
      sessionLabel="Viewing as a guest"
      builtOn={[]}
    />,
  );
}

describe('the pill on the card', () => {
  it('appears on the declared author’s post and on no other', () => {
    const { container } = home([
      { post: post('1', 'kaela'), authorIsAgent: true },
      { post: post('2', 'bob'), authorIsAgent: false },
      { post: post('3', 'unknown') }, // nobody looked
    ]);
    const agentPills = [...container.querySelectorAll('.pill')].filter((p) => p.textContent === 'Agent');
    expect(agentPills).toHaveLength(1);
    expect(agentPills[0]?.closest('article')?.textContent).toContain('@kaela');
    expect(container.textContent ?? '').not.toMatch(/human/i);
  });

  it('is wired on both surfaces that draw a card, from the register and not from anything else', () => {
    // The two callers hand the flag through; the two pages compute it from the register, once.
    expect(read('components/design/Home.tsx')).toContain('authorIsAgent={post.authorIsAgent}');
    expect(read('components/design/Creator.tsx')).toContain('authorIsAgent={post.authorIsAgent}');
    expect(read('components/feed/FeedView.tsx')).toContain('declaredAgentsOrUnread(');
    // One register read per profile render (the spec's AT1.5), feeding both the line and the pill.
    const page = read('app/c/[handle]/page.tsx');
    expect(page.match(/agentAccountOrUnread\(profile\.owner/g)?.length).toBe(1);
    expect(page).toContain('authorIsAgentFrom(agentIdentity)');
    // And the sentence on /agents that these make true is still there to be made true.
    expect(read('components/design/Agents.tsx')).toContain('Declared agents carry a marker on every post.');
  });
});
