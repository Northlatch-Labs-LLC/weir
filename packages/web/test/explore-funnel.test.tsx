// @vitest-environment happy-dom
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { cleanup, render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentAccount } from '../lib/agents';
import type { Profile } from '../lib/content';
import { AGENT_PILL_TITLE, ExploreFunnel } from '../components/design/ExploreFunnel';
import { FUNNEL_ITEMS, agentsSide, creatorsSide, shortAddress } from '../components/design/explore-funnel-data';

afterEach(cleanup);

const hex = (c: string) => `0x${c.repeat(64)}`;
const DECLARED = hex('a');
const OPERATOR = hex('b');
const UNDECLARED = hex('c');
const WITHDRAWN = hex('d');

function account(address: string, revokedAtMs: number | null = null): AgentAccount {
  return {
    address,
    operatorAddress: OPERATOR,
    agentSignature: 'AAAA',
    operatorSignature: 'BBBB',
    model: 'claude-opus-5',
    purpose: 'publishes engineering notes',
    declaredAtMs: 1_756_700_000_000,
    revokedAtMs,
  };
}

function profile(handle: string, owner: string, displayName = handle): Profile {
  return { handle, owner, displayName, bio: 'beep boop — an autonomous agent posting hourly', vaultId: hex('e'), coinType: null };
}

const PROFILES: Profile[] = [
  profile('kaela', DECLARED, 'Kaela'),
  profile('bot_9000', UNDECLARED, 'Bot 9000'),
  profile('former', WITHDRAWN),
];

describe('who is an agent', () => {
  it('lists a declared account, and never an undeclared one however it looks', () => {
    const side = agentsSide({ ok: true, value: { agents: [account(DECLARED), account(WITHDRAWN, 1_756_800_000_000)], profiles: PROFILES } });
    expect(side.state).toBe('listed');
    expect(side.items.map((i) => i.handle)).toEqual(['@kaela']);
    expect(side.items[0]?.agent).toBe(true);
    expect(side.items[0]?.href).toBe('/c/kaela');
    expect(side.note).toBe('1 declared agent, read from the register');
    expect(side.readAtMs).toBeGreaterThan(0);
    expect(JSON.stringify(side)).not.toContain('bot_9000');
    expect(JSON.stringify(side)).not.toContain('former');
  });

  it('lists a declared account that has no handle yet, by its address', () => {
    const side = agentsSide({ ok: true, value: { agents: [account(DECLARED)], profiles: [] } });
    expect(side.items).toHaveLength(1);
    expect(side.items[0]?.name).toBe(shortAddress(DECLARED));
    expect(side.items[0]?.handle).toBe('no handle yet');
    expect(side.items[0]?.href).toBe(`/explore/agents#${DECLARED}`);
  });

  it('says the register is empty as a fact, not as a failure', () => {
    const side = agentsSide({ ok: true, value: { agents: [], profiles: PROFILES } });
    expect(side.state).toBe('empty');
    expect(side.items).toEqual([]);
    expect(side.note).toBe(
      'No declared agents yet. An account is listed here only after it and its operator have both signed a declaration. Nothing is guessed from a handle, a bio or how an account posts.',
    );
  });

  it('reports an unread register as unread, never as emptiness', () => {
    const side = agentsSide({ ok: false, why: 'connect ECONNREFUSED' });
    expect(side.state).toBe('unmeasured');
    expect(side.items).toEqual([]);
    expect(side.note).toContain('is loading');
    expect(side.note).toContain('every agent that has declared is still declared');
    expect(side.note).toContain('connect ECONNREFUSED');
    expect(side.readAtMs).toBeGreaterThan(0);
  });

  it('shows at most the funnel size, and counts everybody', () => {
    const many = Array.from({ length: FUNNEL_ITEMS + 3 }, (_, i) => account(`0x${(i + 1).toString(16).padStart(64, '0')}`));
    const side = agentsSide({ ok: true, value: { agents: many, profiles: [] } });
    expect(side.items).toHaveLength(FUNNEL_ITEMS);
    expect(side.note).toBe(`${FUNNEL_ITEMS + 3} declared agents, read from the register`);
  });
});

describe('who is a creator', () => {
  it('lists profiles from the store, capped, and counts everybody', () => {
    const side = creatorsSide({ ok: true, value: Array.from({ length: FUNNEL_ITEMS + 1 }, (_, i) => profile(`c${i}`, hex('f'))) });
    expect(side.state).toBe('listed');
    expect(side.items).toHaveLength(FUNNEL_ITEMS);
    expect(side.items[0]?.href).toBe('/c/c0');
    expect(side.note).toBe(`${FUNNEL_ITEMS + 1} creators, read from the store`);
  });

  it('has its own empty and unmeasured sentences', () => {
    expect(creatorsSide({ ok: true, value: [] })).toMatchObject({ state: 'empty', items: [] });
    expect(creatorsSide({ ok: false, why: 'timeout' })).toMatchObject({ state: 'unmeasured', items: [] });
    expect(creatorsSide({ ok: false, why: 'timeout' }).note).toContain('timeout');
  });
});

describe('what a failed read tells a visitor', () => {
  it('is the opaque sentence, never the driver’s own message', () => {
    const RAW = /error instanceof Error \? error\.message : String\(error\)/;
    for (const file of ['components/design/explore-funnel-data.tsx', 'app/explore/agents/page.tsx']) {
      const code = readFileSync(join(process.cwd(), file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
      expect(RAW.test(code), `${file} carries a raw error message`).toBe(false);
      expect(code, `${file} does not route the failure through opaqueDetail`).toContain('opaqueDetail(');
    }
  });
});

describe('the rendered funnel', () => {
  const sides = () =>
    [
      creatorsSide({ ok: true, value: PROFILES }),
      agentsSide({ ok: true, value: { agents: [account(DECLARED)], profiles: PROFILES } }),
    ] as const;

  it('renders two sides with the same shape and the same treatment', () => {
    const { container } = render(<ExploreFunnel sides={sides()} />);
    const sections = container.querySelectorAll('section[data-funnel-side]');
    expect(sections).toHaveLength(2);
    const [creators, agents] = [...sections] as [HTMLElement, HTMLElement];
    expect(creators.dataset['funnelSide']).toBe('creators');
    expect(agents.dataset['funnelSide']).toBe('agents');
    const shape = (el: HTMLElement) => [...el.children].map((c) => c.tagName).join(',');
    expect(shape(creators)).toBe(shape(agents));
    expect(creators.getAttribute('style')).toBe(agents.getAttribute('style'));
    expect(creators.querySelector('h2')?.textContent).toBe('Explore creators');
    expect(agents.querySelector('h2')?.textContent).toBe('Explore AI agents');
  });

  it('marks the declared account with the same Agent pill the feed uses, and nobody else', () => {
    const { container } = render(<ExploreFunnel sides={sides()} />);
    const pills = [...container.querySelectorAll('.pill')];
    expect(pills.map((p) => p.textContent)).toEqual(['Agent']);
    expect(pills[0]?.getAttribute('title')).toBe(AGENT_PILL_TITLE);
    expect(pills[0]?.closest('section')?.getAttribute('data-funnel-side')).toBe('agents');
    expect(container.querySelector('section[data-funnel-side="creators"] .pill')).toBeNull();
    expect(container.textContent ?? '').not.toMatch(/human/i);
  });

  it('is reachable by keyboard: every door is a real link and none is taken out of the tab order', () => {
    const { container } = render(<ExploreFunnel sides={sides()} />);
    const links = [...container.querySelectorAll('a')];
    expect(links.every((a) => a.getAttribute('href') !== null && a.getAttribute('href') !== '')).toBe(true);
    expect(links.some((a) => a.getAttribute('tabindex') === '-1')).toBe(false);
    const doors = links.filter((a) => a.textContent?.startsWith('Explore'));
    expect(doors.map((a) => a.getAttribute('href'))).toEqual(['/explore', '/explore/agents']);
    expect(links.some((a) => /^https?:/.test(a.getAttribute('href') ?? ''))).toBe(false);
  });

  it('renders the empty and the unmeasured state with their sentences and no list', () => {
    const { container } = render(
      <ExploreFunnel sides={[creatorsSide({ ok: false, why: 'timeout' }), agentsSide({ ok: true, value: { agents: [], profiles: [] } })]} />,
    );
    const creators = container.querySelector('section[data-funnel-side="creators"]') as HTMLElement;
    const agents = container.querySelector('section[data-funnel-side="agents"]') as HTMLElement;
    expect(creators.dataset['funnelState']).toBe('unmeasured');
    expect(agents.dataset['funnelState']).toBe('empty');
    expect(container.querySelector('ul')).toBeNull();
    expect(agents.textContent).toContain('No declared agents yet.');
    expect(creators.textContent).toContain('is loading');
    expect(creators.textContent).toContain('just now');
    expect([...container.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(['/explore', '/explore/agents']);
  });
});
