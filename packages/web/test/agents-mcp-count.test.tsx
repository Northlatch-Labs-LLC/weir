// @vitest-environment happy-dom
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { cleanup, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DesignAgents, type AgentsProps } from '../components/design/Agents';

afterEach(cleanup);

const source = readFileSync(join(import.meta.dirname, '..', 'components/design/Agents.tsx'), 'utf8');

const HOSTED = ['weir_search', 'weir_quote', 'weir_read', 'weir_authorship', 'weir_agents', 'weir_seeking'];

const props: AgentsProps = {
  network: { value: 'mainnet', unavailable: null },
  originalPackageId: { value: '0xc5c8', unavailable: null },
  latestPackageId: { value: '0xdc6d', unavailable: null },
  platformId: { value: '0x3f69', unavailable: null },
  registryId: { value: '0x1a3f', unavailable: null },
  fee: { value: '2.9%', unavailable: null },
  vaultPrice: { value: '0 SUI', unavailable: null },
  accountsOpen: { value: 'open', unavailable: null },
  manifestPath: '/.well-known/weir-agent.json',
  manifestSigned: true,
  manifestUnsigned: null,
  dnsAnchor: '_weir-agent.weir.social',
  endpoints: [],
  statementKinds: [],
  wholeDocumentUnavailable: null,
  origin: 'https://weir.social',
  seats: { offered: true, whyNot: null, total: 50, remaining: { value: '39', unavailable: null } },
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
  mcp: {
    obtainable: true,
    hosted: 'https://mcp.weir.social/mcp',
    command: '{"mcpServers":{"weir":{"url":"https://mcp.weir.social/mcp"}}}',
  },
  hostedTools: HOSTED,
  publishRecipe: null,
  custody: null,
};

function rendered(): string {
  return document.body.textContent ?? '';
}

describe('the tool count is taken from the table, not typed above it', () => {
  it('prints as many tool rows as it claims tools', () => {
    const { container } = render(<DesignAgents {...props} />);
    const names = [...container.querySelectorAll('td')]
      .map((td) => td.textContent ?? '')
      .filter((t) => /^weir_[a-z]+$/.test(t));
    expect(names.length).toBeGreaterThan(0);
    expect(rendered()).toContain(`${names.length} tools in the package`);
  });

  it('never RENDERS a tool count spelled as a word, which is what nothing can check', () => {
    render(<DesignAgents {...props} />);
    expect(rendered()).not.toMatch(/\b(six|seven|eight|nine|ten|eleven|twelve)\s+tools\b/i);
    expect(source).toContain('{MCP_TOOLS.length} tools in');
  });
});

describe('the hosted list is the manifest’s, not a remembered one', () => {
  it('names exactly the tools the manifest says the hosted server registers', () => {
    render(<DesignAgents {...props} />);
    const text = rendered();
    for (const tool of HOSTED) expect([tool, text.includes(tool)]).toEqual([tool, true]);
    expect(text).toContain(`${HOSTED.length} of them on the hosted server`);
    expect(text).not.toContain('read-only: search, quote, read, balance');
  });

  it('marks a row hosted iff the manifest named it, so the count above is checkable by eye', () => {
    const { container } = render(<DesignAgents {...props} />);
    const rows = [...container.querySelectorAll('tr')].filter((tr) =>
      /^weir_[a-z]+$/.test(tr.querySelector('td')?.textContent ?? ''),
    );
    const hosted = rows.filter((tr) => (tr.textContent ?? '').includes('hosted'));
    expect(hosted.map((tr) => tr.querySelector('td')?.textContent).sort()).toEqual([...HOSTED].sort());
  });

  it('names no hosted tool at all when the manifest published no list', () => {
    render(<DesignAgents {...props} hostedTools={[]} />);
    const text = rendered();
    expect(text).toContain('published no tool list');
    expect(text).not.toContain('of them on the hosted server');
  });

  it('sends a buyer to the published package rather than promising a future one', () => {
    render(<DesignAgents {...props} />);
    expect(rendered()).toContain('npm i @projectx-social/mcp');
    expect(source).not.toContain('once it is published');
  });
});

describe('the page stops promising it cannot disagree with the manifest', () => {
  it('says which parts are read and which are ours, and which wins', () => {
    render(<DesignAgents {...props} />);
    const text = rendered();
    expect(text).toContain('read from the deployment when this page renders');
    expect(text).toContain('where they disagree with the manifest, the manifest wins');
    expect(source).not.toContain('this page cannot disagree with the document your agent fetches');
  });

  it('prints no gas figure and no machine-edition cut-off date', () => {
    render(<DesignAgents {...props} />);
    const text = rendered();
    expect(text).not.toContain('fraction of a cent');
    expect(text).not.toMatch(/after September 2026/);
    expect(text).toContain('We print no gas figure here');
    expect(screen.getAllByRole('heading').length).toBeGreaterThan(0);
  });
});
