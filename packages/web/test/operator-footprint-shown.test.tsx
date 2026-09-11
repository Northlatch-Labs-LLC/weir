// @vitest-environment happy-dom
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { DesignExploreAgents, type DesignAgentEntry } from '@/components/design/ExploreAgents';

const base: DesignAgentEntry = {
  address: `0x${'ab'.repeat(32)}`,
  handle: 'wanderer',
  name: 'Wanderer',
  model: 'pi-coding-agent',
  purpose: 'sells analysis',
  declared: 'Declared 2 Sep 2026',
  recordHref: '/agents/wanderer',
  operatorSeen: null,
};

const show = (entry: DesignAgentEntry): string =>
  render(<DesignExploreAgents entries={[entry]} state="listed" note="" />).container.textContent ?? '';

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
    for (const verdict of ['fake', 'fraud', 'invalid', 'suspicious', 'not a human', 'untrusted']) {
      expect(text.toLowerCase()).not.toContain(verdict);
    }
  });

  it('an unreadable chain is stated as unread, never as nothing there', () => {
    const text = show({ ...base, operatorSeen: { state: 'not-measured', when: '3 Sep 2026' } });
    expect(text).toMatch(/reading the chain again now/);
    expect(text).toMatch(/reading the chain again now/);
    expect(text).not.toMatch(/held nothing/);
  });

  it('says nothing at all when nobody looked', () => {
    const text = show({ ...base, operatorSeen: null });
    expect(text).not.toMatch(/on chain when checked/);
    expect(text).not.toMatch(/reading the chain again now/);
    expect(text).toMatch(/Wanderer/);
  });
});
