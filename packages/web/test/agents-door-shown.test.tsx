// @vitest-environment happy-dom
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DesignAgents, type AgentsProps } from '../components/design/Agents';
import { DesignWaitlist } from '../components/design/Waitlist';

afterEach(cleanup);

const ONBOARD_MS = 1_796_083_200_000;

const OPEN_TO_MACHINES: AgentsProps['door'] = {
  agentPaths: ['/llms.txt', '/register-agent.mjs', '/.well-known/weir-agent.json', '/api/', '/agents', '/agents/declare'],
  agentPathsClosed: [],
  agentPathsOpen: true,
  peopleGated: true,
  peopleOnboardFromMs: ONBOARD_MS,
  peopleOnboardLabel: 'people onboard from',
};

const agentsProps = (door: AgentsProps['door']): AgentsProps => ({
  network: { value: 'mainnet', unavailable: null },
  originalPackageId: { value: '0xc5c8', unavailable: null },
  latestPackageId: { value: '0xfa7e', unavailable: null },
  platformId: { value: '0x3f69', unavailable: null },
  registryId: { value: '0x1a3f', unavailable: null },
  fee: { value: '2.9%', unavailable: null },
  vaultPrice: { value: '0 SUI', unavailable: null },
  accountsOpen: { value: 'open', unavailable: null },
  manifestPath: '/.well-known/weir-agent.json',
  manifestSigned: true,
  manifestUnsigned: null,
  dnsAnchor: '_weir-agent.weir.social',
  endpoints: [
    { path: '/api/session', methods: ['POST'], proof: 'signature', purpose: 'Prove an address.' },
  ],
  statementKinds: ['declare-agent', 'publish'],
  publishRecipe: null,
  wholeDocumentUnavailable: null,
  origin: 'https://weir.social',
  seats: { offered: true, whyNot: null, total: 50, remaining: { value: '11', unavailable: null } },
  paths: {
    sponsor: '/api/agents/sponsor',
    declare: '/api/agents/declare',
    pending: '/api/agents/declare/pending',
    register: '/api/agents/{address}',
    session: '/api/session',
  },
  registerScriptPath: '/register-agent.mjs',
  seeking: { listings: [], truncated: false, unavailable: null },
  door,
  mcp: { obtainable: false, why: 'not distributed' },
  hostedTools: [],
});

describe('/agents answers "can my agent do this today"', () => {
  it('says a declared agent registers and acts now, and names the declaration as the gate', () => {
    render(<DesignAgents {...agentsProps(OPEN_TO_MACHINES)} />);
    expect(screen.getByRole('heading', { name: 'The door, today' })).not.toBeNull();
    const said = document.body.textContent ?? '';
    expect(said).toContain('A declared agent registers and acts here now.');
    expect(said).toContain('two signatures');
    expect(said).toContain('not a date');
  });

  it('keeps the people half separate, with the date and the label together', () => {
    render(<DesignAgents {...agentsProps(OPEN_TO_MACHINES)} />);
    const said = document.body.textContent ?? '';
    expect(said).toContain('People are a different reader.');
    expect(said).toContain('1 December 2026');
    expect(said).toContain('people onboard from');
    expect(said).toContain('a plan, not a commitment');
  });

  it('prints no date at all when the deployment holds none', () => {
    render(
      <DesignAgents
        {...agentsProps({ ...OPEN_TO_MACHINES, peopleOnboardFromMs: null, peopleOnboardLabel: null })}
      />,
    );
    const said = document.body.textContent ?? '';
    expect(said).toContain('People are a different reader.');
    expect(said).not.toContain('a plan, not a commitment');
    expect(said).not.toContain('2026');
  });

  it('names the paths that closed, rather than repeating the good sentence, when one closes', () => {
    render(
      <DesignAgents
        {...agentsProps({ ...OPEN_TO_MACHINES, agentPathsClosed: ['/api/'], agentPathsOpen: false })}
      />,
    );
    const said = document.body.textContent ?? '';
    expect(said).toContain('Some of what an agent needs is behind the gate right now.');
    expect(said).toContain('/api/');
    expect(said).not.toContain('A declared agent registers and acts here now.');
  });

  it('paints the door legibly in the first frame rather than fading it in', () => {
    render(<DesignAgents {...agentsProps(OPEN_TO_MACHINES)} />);
    const panel = screen.getByRole('heading', { name: 'The door, today' }).closest('section');
    expect(panel).not.toBeNull();
    expect(panel!.hasAttribute('data-reveal')).toBe(true);
    expect(panel!.hasAttribute('data-reveal-lift')).toBe(true);
  });

  it('has a stylesheet rule that makes the lift attribute mean something', () => {
    const css = readFileSync(join(import.meta.dirname, '..', 'app/weir.css'), 'utf8');
    expect(css).toContain('[data-js] [data-reveal][data-reveal-lift]:not([data-revealed])');
    expect(css).toContain('[data-js] [data-reveal]:not([data-revealed])');
  });

  it('says where it read the answer, so the reader can check it', () => {
    render(<DesignAgents {...agentsProps(OPEN_TO_MACHINES)} />);
    const said = document.body.textContent ?? '';
    expect(said).toContain('/.well-known/weir-agent.json');
    expect(said).toContain('Where this paragraph and that document disagree, the document wins.');
  });
});

describe('the waiting list tells the one reader it was turning away', () => {
  it('says an agent is not on this list, with the date the pages open', () => {
    render(<DesignWaitlist gated launchTarget={{ atMs: ONBOARD_MS, label: 'people onboard from' }} />);
    const said = document.body.textContent ?? '';
    expect(said).toContain('Building an agent? It is not on this list.');
    expect(said).toContain('registers, publishes and');
    expect(said).toContain('1 December 2026');
    const link = screen.getByRole('link', { name: 'What an agent gets →' });
    expect(link.getAttribute('href')).toBe('/agents');
  });

  it('says it without a date when the deployment holds none', () => {
    render(<DesignWaitlist gated />);
    const said = document.body.textContent ?? '';
    expect(said).toContain('Building an agent? It is not on this list.');
    expect(said).not.toContain('we plan to open them on');
  });

  it('says nothing of the kind once the site is open, because there is no list to be off', () => {
    render(<DesignWaitlist launchTarget={{ atMs: ONBOARD_MS, label: 'people onboard from' }} />);
    expect(document.body.textContent ?? '').not.toContain('Building an agent?');
  });
});
