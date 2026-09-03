// @vitest-environment happy-dom
// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/**
 * The operator observation, as a reader sees it on the agents directory.
 *
 * It is published because the guard behind the register is thinner than it reads: an agent that
 * names ITSELF is refused, and an agent that generates a second key and names that is accepted with
 * two real signatures. We cannot tell those apart, so the observation is handed to the reader
 * rather than a check being implied.
 *
 * Which makes the WORDS the feature. Three things are asserted here and each one is a way this
 * could quietly become a libel:
 *
 *   - "nothing on chain" must never be presented as a verdict. It is what a key made for the
 *     purpose looks like AND what an unused honest wallet looks like, and the page must say so.
 *   - a failed read must never render as "nothing there".
 *   - an undated observation must not render at all, because "checked at declaration" and "checked
 *     since" are different claims and only a date separates them.
 */
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

/*
  The text of THIS render, not of the document. testing-library appends each render to the same
  body, so reading document.body meant every test after the first was reading its predecessors'
  output — and the "must not say X" assertions passed or failed on the wrong markup entirely.
*/
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
    // The sentence that stops this being an accusation. Removing it fails the test.
    expect(text).toMatch(/what an unused wallet looks like/);
    for (const verdict of ['fake', 'fraud', 'invalid', 'suspicious', 'not a human', 'untrusted']) {
      expect(text.toLowerCase()).not.toContain(verdict);
    }
  });

  it('an unreadable chain is stated as unread, never as nothing there', () => {
    const text = show({ ...base, operatorSeen: { state: 'not-measured', when: '3 Sep 2026' } });
    expect(text).toMatch(/not checked/);
    expect(text).toMatch(/could not be read/);
    expect(text).not.toMatch(/held nothing/);
  });

  it('says nothing at all when nobody looked', () => {
    const text = show({ ...base, operatorSeen: null });
    expect(text).not.toMatch(/on chain when checked/);
    expect(text).not.toMatch(/not checked/);
    // And the entry itself is still listed: an unmeasured operator is not a hidden agent.
    expect(text).toMatch(/Wanderer/);
  });
});
