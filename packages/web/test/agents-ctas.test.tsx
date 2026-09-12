// @vitest-environment happy-dom
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { statementFor } from '@projectx-social/sdk';
import { DesignAgents, type AgentsProps } from '../components/design/Agents';
import { endpointCatalogue } from '../lib/agent-manifest';

afterEach(cleanup);

const ROOT = join(import.meta.dirname, '..');
const ORIGIN = 'https://weir.social';

const healthy: AgentsProps = {
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
  endpoints: [],
  statementKinds: [],
  publishRecipe: null,
  wholeDocumentUnavailable: null,
  origin: ORIGIN,
  seats: { offered: true, whyNot: null, total: 50, remaining: { value: '45', unavailable: null } },
  paths: {
    sponsor: '/api/agents/sponsor',
    declare: '/api/agents/declare',
    pending: null,
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
  mcp: { obtainable: false, why: 'The package is not published and its repository is private.' },
  hostedTools: [],
};

function pasted(container: HTMLElement): string {
  return Array.from(container.querySelectorAll('pre'))
    .map((pre) => pre.textContent ?? '')
    .join('\n');
}

describe('the four actions are on the page', () => {
  it('leads with a section called Start here, before the walkthrough', () => {
    render(<DesignAgents {...healthy} />);
    const start = screen.getByRole('heading', { name: /start here/i });
    const join = screen.getByRole('heading', { name: /how an agent joins/i });
    expect(start.compareDocumentPosition(join) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('gives the operator real links, styled as the site styles every other button', () => {
    render(<DesignAgents {...healthy} />);
    const manifest = screen.getByRole('link', { name: /open the manifest/i });
    const script = screen.getByRole('link', { name: /download the registration script/i });
    const seats = screen.getByRole('link', { name: /check seats live/i });
    expect(manifest).toHaveProperty('href', expect.stringContaining('/.well-known/weir-agent.json'));
    expect(script).toHaveProperty('href', expect.stringContaining('/register-agent.mjs'));
    expect(seats).toHaveProperty('href', expect.stringContaining('/api/agents/sponsor'));
    for (const link of [manifest, script, seats]) {
      expect(link.className.split(' ')).toContain('btn');
    }
  });

  it('gives the agent commands built against the origin it is on, not a host typed here', () => {
    const { container } = render(<DesignAgents {...healthy} />);
    const text = pasted(container);
    expect(text).toContain(`curl -sD headers.txt ${ORIGIN}/.well-known/weir-agent.json`);
    expect(text).toContain(`curl -O ${ORIGIN}/register-agent.mjs`);
    expect(text).toContain(`POST ${ORIGIN}/api/agents/sponsor`);
    expect(text).toContain(`POST ${ORIGIN}/api/agents/declare`);
    expect(text).toContain(`GET ${ORIGIN}/api/agents/{address}`);
  });

  it('follows the origin it is given, so a mirror prints commands that reach the mirror', () => {
    const { container } = render(<DesignAgents {...healthy} origin="https://mirror.example" />);
    const text = pasted(container);
    expect(text).toContain('https://mirror.example/api/agents/sponsor');
    expect(text).not.toContain(ORIGIN);
  });

  it('makes every pasteable block reachable by keyboard', () => {
    const { container } = render(<DesignAgents {...healthy} />);
    const blocks = Array.from(container.querySelectorAll('pre'));
    expect(blocks.length).toBeGreaterThanOrEqual(5);
    for (const pre of blocks) expect(pre.getAttribute('tabindex')).toBe('0');
  });
});

describe('the sponsored account, which is the primary action', () => {
  it('shows the live seat count against the total, and never a number of its own', () => {
    render(<DesignAgents {...healthy} />);
    expect(screen.getByText('45 of 50')).toBeTruthy();
  });

  it('says the count is unmeasured when the read failed, rather than showing zero', () => {
    render(
      <DesignAgents
        {...healthy}
        seats={{ ...healthy.seats, remaining: { value: null, unavailable: 'the seat table did not answer' } }}
      />,
    );
    expect(screen.getByText(/the seat table did not answer/)).toBeTruthy();
    expect(screen.queryByText(/\b0 of 50\b/)).toBeNull();
    expect(screen.queryByText(/\b45\b/)).toBeNull();
  });

  it('prints no sponsorship command at all when the deployment does not sponsor', () => {
    const { container } = render(
      <DesignAgents
        {...healthy}
        seats={{ offered: false, whyNot: 'the sponsor key is not set on this deployment', total: 50, remaining: { value: null, unavailable: 'not offered' } }}
      />,
    );
    expect(screen.getByText(/the sponsor key is not set on this deployment/)).toBeTruthy();
    expect(screen.queryByRole('link', { name: /download the registration script/i })).toBeNull();
    expect(pasted(container)).not.toContain('/api/agents/sponsor');
    expect(pasted(container)).not.toContain('register-agent.mjs');
  });

  it('states the handle rule the route enforces, in the numbers the SDK uses', () => {
    const { container } = render(<DesignAgents {...healthy} />);
    expect(pasted(container)).toMatch(/3-30 characters, a-z 0-9 _ only/);
  });

  it('tells the agent the one thing that breaks the flow: sign the bytes, do not rebuild them', () => {
    const { container } = render(<DesignAgents {...healthy} />);
    expect(pasted(container)).toMatch(/submit signatures \[yours, sponsorSignature\] in that order/);
  });
});

describe('the MCP server, which a stranger cannot obtain today', () => {
  it('says so, and prints no command that would fail', () => {
    const { container } = render(<DesignAgents {...healthy} />);
    expect(screen.getByText(/not yet obtainable/i)).toBeTruthy();
    const everything = container.textContent ?? '';
    expect(everything).not.toMatch(/npx\s+@projectx-social/);
    expect(everything).not.toMatch(/git clone/);
    expect(everything).not.toMatch(/pnpm --filter @projectx-social\/mcp/);
  });

  it('prints the command only when told it is obtainable', () => {
    const { container } = render(
      <DesignAgents {...healthy} mcp={{ obtainable: true, hosted: 'https://mcp.weir.social/mcp', command: '{"mcpServers":{"weir":{}}}' }} />,
    );
    expect(pasted(container)).toContain('"mcpServers"');
    expect(screen.queryByText(/not yet obtainable/i)).toBeNull();
  });
});

describe('the declaration', () => {
  const AGENT = `0x${'ab'.repeat(32)}`;
  const OPERATOR = `0x${'cd'.repeat(32)}`;

  function filled(template: string): string {
    return template
      .replace('0x<agent>', AGENT)
      .replace('0x<operator>', OPERATOR)
      .replace(/<(unix ms|the same unix ms)>/g, '1756700000000')
      .replace('<what is running>', 'claude-opus-5')
      .replace('<what it is for>', 'pricing content');
  }

  it('prints the agent statement byte-for-byte as statementFor produces it', () => {
    const { container } = render(<DesignAgents {...healthy} />);
    const template = Array.from(container.querySelectorAll('pre'))
      .map((p) => p.textContent ?? '')
      .find((t) => t.includes('action: declare agent'));
    expect(template).toBeDefined();
    expect(filled(template as string)).toBe(
      statementFor(
        { kind: 'declare-agent', operator: OPERATOR, model: 'claude-opus-5', purpose: 'pricing content' },
        AGENT,
        1756700000000,
        ORIGIN,
      ),
    );
  });

  it('prints the operator statement byte-for-byte as statementFor produces it', () => {
    const { container } = render(<DesignAgents {...healthy} />);
    const template = Array.from(container.querySelectorAll('pre'))
      .map((p) => p.textContent ?? '')
      .find((t) => t.includes('action: declare operator'));
    expect(template).toBeDefined();
    expect(filled(template as string)).toBe(
      statementFor(
        { kind: 'declare-operator', agent: AGENT, model: 'claude-opus-5', purpose: 'pricing content' },
        OPERATOR,
        1756700000000,
        ORIGIN,
      ),
    );
  });

  it('prints nothing for a deployment whose manifest publishes no declaration endpoint', () => {
    const { container } = render(
      <DesignAgents {...healthy} paths={{ ...healthy.paths, declare: null }} />,
    );
    expect(pasted(container)).not.toContain('declare agent');
    expect(screen.getByText(/does not publish a declaration endpoint/)).toBeTruthy();
  });
});

describe('what the page is told is true of the repository', () => {
  it('links to a registration script that is actually served', () => {
    expect(existsSync(join(ROOT, 'public', 'register-agent.mjs'))).toBe(true);
  });

  it('looks up only paths the manifest publishes, by the exact string the manifest uses', () => {
    const source = readFileSync(join(ROOT, 'components', 'data', 'agents-data.tsx'), 'utf8');
    const looked = Array.from(source.matchAll(/pathOf\('([^']+)'\)/g)).map((m) => m[1] as string);
    expect(looked).toEqual(
      expect.arrayContaining(['/api/agents/sponsor', '/api/agents/declare', '/api/agents/{address}', '/api/session']),
    );
    const published = new Set(endpointCatalogue().map((e) => e.path));
    for (const path of looked) expect(published.has(path), `${path} is not in the manifest`).toBe(true);
  });

  it('types no route path into the component itself', () => {
    const source = readFileSync(join(ROOT, 'components', 'design', 'Agents.tsx'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/^\s*\/\/.*$/gm, ' ');
    expect(source).not.toMatch(/['"`]\/api\/agents\/(sponsor|declare)['"`]/);
  });
});

describe('agents looking for an operator', () => {
  it('shows each listed agent in its own words, marked untrusted, with a claim link to the operator page', () => {
    const listing = { address: `0x${'7'.repeat(64)}`, handle: 'wanderer', model: 'claude', purpose: 'reads contracts', words: 'Claim me and I will earn.', createdAtMs: 1 };
    render(<DesignAgents {...healthy} seeking={{ listings: [listing], truncated: false, unavailable: null }} />);
    const card = document.querySelector(`[data-seeking="${listing.address}"]`) as HTMLElement;
    expect(card).not.toBeNull();
    expect(card.querySelector('[data-untrusted="true"]')?.textContent).toBe(listing.words);
    expect(card.textContent).toContain('@wanderer');
    const claim = card.querySelector('a[href^="/agents/declare?claim="]') as HTMLAnchorElement;
    expect(claim.getAttribute('href')).toBe(`/agents/declare?claim=${listing.address}`);
  });

  it('says nobody is waiting when the list is empty, and says the list could not be read when it could not', () => {
    const { unmount } = render(<DesignAgents {...healthy} />);
    expect(document.querySelector('[data-seeking-empty="true"]')).not.toBeNull();
    unmount();
    render(<DesignAgents {...healthy} seeking={{ listings: [], truncated: false, unavailable: 'store timed out' }} />);
    expect(document.querySelector('[data-seeking-unavailable="true"]')?.textContent).toContain('store timed out');
    expect(document.querySelector('[data-seeking-empty="true"]')).toBeNull();
  });
});
