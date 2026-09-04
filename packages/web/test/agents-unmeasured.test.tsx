// @vitest-environment happy-dom
// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/**
 * The failure path of `/agents`, rendered.
 *
 * # Why this test exists separately from the others
 *
 * A live run of the page proves the success path: every figure was read and every figure appeared.
 * It proves nothing at all about what happens when a read fails, because nothing failed — and the
 * failure path is the one that matters, since that is where a page quietly invents a number.
 *
 * So this renders the component with the reads deliberately broken and asserts three things that
 * a careless implementation gets wrong:
 *
 *   1. It says "not measured" in words, rather than rendering an empty cell or a dash that a
 *      reader parses as zero.
 *   2. It shows the REASON, so an operator can tell "this deployment is not configured" from
 *      "the chain did not answer just now" — opposite next actions.
 *   3. It does NOT print a plausible figure anywhere. A page that falls back to 2.9% when the
 *      chain read failed is worse than one that crashes, because the number gets believed.
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DesignAgents, type AgentsProps } from '../components/design/Agents';

afterEach(cleanup);

/** Everything measured — the shape a healthy deployment produces. */
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
  // The calls to action. Present and healthy here; `test/agents-ctas.test.tsx` is where they are
  // exercised, this file is about the measured figures above.
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
  mcp: { obtainable: false, why: 'not distributed' },
};

/** Every chain read failed. This is what an outage must look like on the page. */
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
  it('shows the measured figures and never says "not measured"', () => {
    render(<DesignAgents {...healthy} />);
    expect(screen.getByText('2.9%')).toBeTruthy();
    expect(screen.getByText('29 SUI')).toBeTruthy();
    expect(screen.queryByText('not measured')).toBeNull();
  });
});

describe('when the reads fail', () => {
  it('says "not measured" in words for every figure', () => {
    render(<DesignAgents {...broken} />);
    // Eight facts are rendered through <Fact>; all eight are broken in this fixture.
    expect(screen.getAllByText('not measured').length).toBe(8);
  });

  it('shows the reason beside it, so an outage is distinguishable from a misconfiguration', () => {
    render(<DesignAgents {...broken} />);
    expect(screen.getAllByText('the node did not answer').length).toBeGreaterThan(0);
    expect(
      screen.getAllByText('the platform object was not read on this request').length,
    ).toBeGreaterThan(0);
  });

  it('invents no figure anywhere — this is the whole point', () => {
    /*
      The mutation this guards against: someone adds `?? '2.9%'` or `?? 0` to "tidy up the empty
      state". The page would then be indistinguishable from a healthy one during an outage, and an
      operator would size a decision on a fee nobody read. If this assertion ever fails, read the
      diff before touching the test.
    */
    const { container } = render(<DesignAgents {...broken} />);
    const text = container.textContent ?? '';
    expect(text).not.toContain('2.9%');
    expect(text).not.toContain('29 SUI');
    expect(text).not.toContain('mainnet');
    /*
      And every fact rendered SOMETHING. The first version of this assertion banned a bare dash by
      regex and matched the em-dashes in ordinary prose instead — the page is full of them. The
      precise property is the one that matters anyway: a broken fixture has eight broken facts, so
      there must be exactly eight "not measured" labels and no fact left silently blank.
    */
    expect(screen.getAllByText('not measured').length).toBe(8);
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
    expect(screen.getByText(/could not build its agent manifest/i)).toBeTruthy();
    expect(screen.getByText('this deployment is not configured for a chain')).toBeTruthy();
  });
});

describe('the signature section tells the truth in both states', () => {
  it('describes how to verify when the manifest is signed', () => {
    render(<DesignAgents {...healthy} />);
    expect(screen.getByText(/Signature — live/)).toBeTruthy();
  });

  it('says it is unsigned, and why, when no key is configured', () => {
    render(
      <DesignAgents
        {...healthy}
        manifestSigned={false}
        manifestUnsigned="PROJECTX_SOCIAL_AGENT_MANIFEST_KEY is not set"
      />,
    );
    expect(screen.getByText(/Signature — not configured/)).toBeTruthy();
    expect(screen.getByText(/is not set/)).toBeTruthy();
    // It must not still be telling agents the document proves origin.
    expect(screen.getByText(/cannot tell this document apart/i)).toBeTruthy();
  });
});
