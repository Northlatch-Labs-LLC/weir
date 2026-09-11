// @vitest-environment happy-dom
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DesignAgents, type AgentsProps } from '../components/design/Agents';

afterEach(cleanup);

const healthy: AgentsProps = {
  network: { value: 'mainnet', unavailable: null },
  originalPackageId: { value: '0xc5c8', unavailable: null },
  latestPackageId: { value: '0xfa7e', unavailable: null },
  platformId: { value: '0x3f69', unavailable: null },
  registryId: { value: '0x1a3f', unavailable: null },
  fee: { value: '2.9%', unavailable: null },
  vaultPrice: { value: '29 SUI', unavailable: null },
  accountsOpen: { value: 'open', unavailable: null },
  manifestPath: '/.well-known/weir-agent.json',
  manifestSigned: true,
  manifestUnsigned: null,
  dnsAnchor: '_weir-agent.weir.social',
  endpoints: [
    { path: '/api/session', methods: ['POST'], proof: 'signature', purpose: 'Prove an address.' },
  ],
  statementKinds: ['follow', 'read'],
  publishRecipe: null,
  wholeDocumentUnavailable: null,
  origin: 'https://weir.social',
  seats: { offered: true, whyNot: null, total: 50, remaining: { value: '45', unavailable: null } },
  paths: {
    sponsor: '/api/agents/sponsor',
    declare: '/api/agents/declare',
    pending: '/api/agents/declare/pending',
    register: '/api/agents/{address}',
    session: '/api/session',
  },
  registerScriptPath: '/register-agent.mjs',
  seeking: { listings: [], truncated: false, unavailable: null },
  door: {
    agentPaths: ['/llms.txt', '/register-agent.mjs', '/.well-known/weir-agent.json', '/api/', '/agents', '/agents/declare'],
    agentPathsClosed: [],
    agentPathsOpen: true,
    peopleGated: true,
    peopleOnboardFromMs: 1_796_083_200_000,
    peopleOnboardLabel: 'people onboard from',
  },
  mcp: { obtainable: false, why: 'not distributed' },
  hostedTools: ['weir_search', 'weir_quote', 'weir_read', 'weir_authorship', 'weir_agents', 'weir_seeking'],
};

const broken: AgentsProps = {
  ...healthy,
  network: { value: null, unavailable: 'the node did not answer' },
  originalPackageId: { value: null, unavailable: 'the node did not answer' },
  latestPackageId: { value: null, unavailable: 'the node did not answer' },
  platformId: { value: null, unavailable: 'the node did not answer' },
  registryId: { value: null, unavailable: 'the node did not answer' },
  fee: { value: null, unavailable: 'the platform object was not read on this request' },
  vaultPrice: { value: null, unavailable: 'the platform object was not read on this request' },
  accountsOpen: { value: null, unavailable: 'the platform object was not read on this request' },
};

describe('when every read succeeds', () => {
  it('shows the figures it read, and says nothing about reading', () => {
    render(<DesignAgents {...healthy} />);
    expect(screen.getByText('2.9%')).toBeTruthy();
    expect(screen.getByText('29 SUI')).toBeTruthy();
    expect(screen.queryByText('reading from the chain')).toBeNull();
  });
});

describe('when the reads fail', () => {
  it('says so in words for every figure it has not read', () => {
    render(<DesignAgents {...broken} />);
    expect(screen.getAllByText('reading from the chain').length).toBe(8);
  });

  it('shows the reason beside it, so an outage is distinguishable from a misconfiguration', () => {
    render(<DesignAgents {...broken} />);
    expect(screen.getAllByText('the node did not answer').length).toBeGreaterThan(0);
    expect(
      screen.getAllByText('the platform object was not read on this request').length,
    ).toBeGreaterThan(0);
  });

  it('invents no figure anywhere — this is the whole point', () => {
    const { container } = render(<DesignAgents {...broken} />);
    const text = container.textContent ?? '';
    expect(text).not.toContain('2.9%');
    expect(text).not.toContain('29 SUI');
    expect(text).not.toContain('mainnet');
    expect(screen.getAllByText('reading from the chain').length).toBe(8);
  });
});

describe('when the whole manifest could not be built', () => {
  it('says so at the top rather than rendering a page of blanks', () => {
    render(
      <DesignAgents
        {...broken}
        wholeDocumentUnavailable="this deployment is not configured for a chain"
      />,
    );
    expect(screen.getByText(/manifest is being read from the chain/i)).toBeTruthy();
    expect(screen.getByText('this deployment is not configured for a chain')).toBeTruthy();
  });
});

describe('the signature section tells the truth in both states', () => {
  it('describes how to verify when the manifest is signed', () => {
    render(<DesignAgents {...healthy} />);
    expect(screen.getByText(/Signature: live/)).toBeTruthy();
  });

  it('says it is unsigned, and why, when no key is configured', () => {
    render(
      <DesignAgents
        {...healthy}
        manifestSigned={false}
        manifestUnsigned="PROJECTX_SOCIAL_AGENT_MANIFEST_KEY is not set"
      />,
    );
    expect(screen.getByText(/Signature: not configured/)).toBeTruthy();
    expect(screen.getByText(/is not set/)).toBeTruthy();
    expect(screen.getByText(/cannot tell this document apart/i)).toBeTruthy();
  });
});
