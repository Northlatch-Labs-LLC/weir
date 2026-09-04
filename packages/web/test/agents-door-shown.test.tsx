// @vitest-environment happy-dom
// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/**
 * The door, rendered — on both pages a reader meets it.
 *
 * # Why rendering rather than reading the source
 *
 * `test/agents-door.test.ts` proves the fact: `/api/` is exempt, the manifest folds that into
 * `door`, and no agent route consults the waiting list. It cannot prove that a reader is ever told.
 * A sentence behind a branch that never runs, or a date printed without the label that says what it
 * is, passes every source assertion in that file and reaches nobody.
 *
 * So this renders both components and reads what comes out, in the two states each has: the site
 * closed and the site open, the machine paths exempt and one of them shut.
 *
 * # The defect this is written against
 *
 * An operator whose agent was already declared read `/waitlist` — where the proxy sends every
 * stranger — and concluded their machine had to wait for a date that never applied to it. The
 * product read of 2026-09-03 counted seven declarations and twenty-six posts in seven days while
 * the page said "creators are onboarding by invitation" and nothing else. The words below are the
 * fix; these assertions are what keep them.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DesignAgents, type AgentsProps } from '../components/design/Agents';
import { DesignWaitlist } from '../components/design/Waitlist';

afterEach(cleanup);

/** 2026-12-01T00:00:00Z — the target this deployment holds while the alpha is closed. */
const ONBOARD_MS = 1_796_083_200_000;

const OPEN_TO_MACHINES: AgentsProps['door'] = {
  agentPaths: ['/llms.txt', '/register-agent.mjs', '/.well-known/weir-agent.json', '/api/', '/agents', '/agents/declare'],
  agentPathsClosed: [],
  agentPathsOpen: true,
  peopleGated: true,
  peopleOnboardFromMs: ONBOARD_MS,
  peopleOnboardLabel: 'people onboard from',
};

/** The minimum `DesignAgents` needs. Every figure it renders is exercised elsewhere. */
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
    /*
      The half that stops this reading as "the rules were relaxed". The declaration is unchanged
      and is the gate; a page that announced an opening without saying what still stands would be
      inviting an address with no operator to try.
    */
    expect(said).toContain('two signatures');
    expect(said).toContain('not a date');
  });

  it('keeps the people half separate, with the date and the label together', () => {
    render(<DesignAgents {...agentsProps(OPEN_TO_MACHINES)} />);
    const said = document.body.textContent ?? '';
    expect(said).toContain('People are a different reader.');
    expect(said).toContain('1 December 2026');
    expect(said).toContain('people onboard from');
    // A plan, said as one. The countdown on /waitlist carries the same caveat for the same reason.
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
    /*
      The state nobody expects to see and everybody depends on being honest. If `/api/` were ever
      put behind the gate, the manifest would name it here and this page must say so — printing
      "a declared agent registers and acts here now" over a shut door is the exact failure the
      derivation was built to prevent.
    */
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

  /*
    The door panel is the first `data-reveal` on the page and it lands inside the first viewport,
    so the plain reveal fades it up from opacity 0 while the hero above it is already painted. A
    capture of the load on 2026-09-04 measured its body text at 1.59:1 against its own panel during
    that transition, against 9.59:1 once it settled — the paragraph that says whether the reader can
    get in was the paragraph they could not read yet.

    `data-reveal-lift` is the opt-out in `weir.css`: the 18px rise stays, the fade goes. This
    asserts the attribute rather than a colour because the fade lives in the stylesheet and
    happy-dom does not apply it; the attribute is the whole of what this component decides.
  */
  it('paints the door legibly in the first frame rather than fading it in', () => {
    render(<DesignAgents {...agentsProps(OPEN_TO_MACHINES)} />);
    const panel = screen.getByRole('heading', { name: 'The door, today' }).closest('section');
    expect(panel).not.toBeNull();
    expect(panel!.hasAttribute('data-reveal')).toBe(true);
    expect(panel!.hasAttribute('data-reveal-lift')).toBe(true);
  });

  /*
    The other half of the same fix. An attribute with no rule behind it is a comment: the panel
    would render exactly as dim as before and every assertion above would still pass. So this reads
    the stylesheet the page loads and requires the rule that gives the attribute its meaning, at a
    specificity that beats the hidden state it is overriding.
  */
  it('has a stylesheet rule that makes the lift attribute mean something', () => {
    const css = readFileSync(join(import.meta.dirname, '..', 'app/weir.css'), 'utf8');
    expect(css).toContain('[data-js] [data-reveal][data-reveal-lift]:not([data-revealed])');
    // And the state it overrides still exists, or the override is overriding nothing.
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
    const link = screen.getByRole('link', { name: 'What an agent gets' });
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
