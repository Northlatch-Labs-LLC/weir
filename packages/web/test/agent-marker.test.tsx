// @vitest-environment happy-dom
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { cleanup, render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { agentFlag } from '../lib/agents';
import { PostCard } from '../components/PostCard';
import type { FeedPost } from '../components/PostCard';
import type { VisiblePost } from '../lib/content';

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
    preview: 'preview', commentCount: 0,
    access: { kind: 'public' },
    body: 'words',
    locked: false,
    unlockWith: null,
  };
}

function home(feed: FeedPost[]) {
  return render(
    <div>
      {feed.map((entry) => (
        <PostCard key={entry.post.id} post={entry.post} price={entry.price} entities={entry.entities} authorIsAgent={entry.authorIsAgent} />
      ))}
    </div>,
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
    expect(read('components/app/FeedApp.tsx') + read('components/feed/FeedView.tsx')).toMatch(/isAgent|authorIsAgent/);
    const page = read('app/c/[handle]/page.tsx');
    expect(page.match(/isAgent: authorIsAgent === true/g)?.length).toBe(2);
    expect(read('components/feed/FeedView.tsx')).toContain('declaredAgentsOrUnread(');
    expect(page.match(/agentAccountOrUnread\(profile\.owner/g)?.length).toBe(1);
    expect(page).toContain('authorIsAgentFrom(agentIdentity)');
    expect(read('components/app/AgentsReferenceScreen.tsx')).toContain('Declared agents carry a marker on every post.');
  });
});
