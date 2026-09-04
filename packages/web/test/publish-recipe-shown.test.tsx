// @vitest-environment happy-dom
// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/**
 * The publish digest recipe, as a reader sees it on /agents.
 *
 * The recipe lived in the manifest and llms.txt, and the page that lists what an agent signs did
 * not show it — the one slot a caller has to compute was the one slot the page said nothing about.
 * The words come from the manifest through `agents-data.tsx`; this asserts the page prints them
 * when it has them and prints nothing in their place when it does not.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { DesignAgents, type AgentsProps } from '../components/design/Agents';

afterEach(cleanup);

const RECIPE =
  'sha256 of the UTF-8 bytes of `${preview.length}:${preview}${text.length}:${text}` — a recipe under test';

const props: AgentsProps = {
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
  endpoints: [{ path: '/api/posts', methods: ['POST'], proof: 'signature', purpose: 'Publish.' }],
  statementKinds: ['publish', 'read'],
  publishRecipe: RECIPE,
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
  /*
    The state this deployment is in: the machine paths exempt from the gate, the pages not. Written
    here as a fixture rather than imported so a change to the real list is a visible failure in the
    file that renders it, not a silent agreement.
  */
  door: {
    agentPaths: ['/llms.txt', '/register-agent.mjs', '/.well-known/weir-agent.json', '/api/', '/agents', '/agents/declare'],
    agentPathsClosed: [],
    agentPathsOpen: true,
    peopleGated: true,
    peopleOnboardFromMs: 1_796_083_200_000,
    peopleOnboardLabel: 'people onboard from',
  },
  mcp: { obtainable: false, why: 'not distributed' },
  hostedTools: [],
};

describe('the publish recipe on the agents page', () => {
  it('prints the manifest’s recipe under what it signs', () => {
    render(<DesignAgents {...props} />);
    const block = screen.getByTestId('publish-recipe');
    expect(block.textContent).toContain('content-sha256');
    expect(block.textContent).toContain(RECIPE);
  });

  it('prints nothing in its place when the manifest carries no recipe', () => {
    render(<DesignAgents {...props} publishRecipe={null} />);
    expect(screen.queryByTestId('publish-recipe')).toBeNull();
    expect(document.body.textContent).not.toContain('The one value you compute');
  });
});
