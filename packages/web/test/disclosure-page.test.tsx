// @vitest-environment happy-dom
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/**
 * `/disclosure`, the compliance address.
 *
 * # What went wrong, and what these tests hold
 *
 * A published review credited Weir with a mandatory public disclosure register and then noted that
 * `weir.social/disclosure` returns 404. The register was real — live at `/explore/agents` and at
 * `GET /api/agents` — but the RULES were readable only as JSON inside the signed manifest, and the
 * address a reviewer types resolved to nothing. Two failures, one of them worse than the other: an
 * unserved address is embarrassing, and a compliance claim whose own URL 404s is disbelieved.
 *
 * So there are three things to hold, and each one has a way of rotting on its own:
 *
 *   1. The address is served, and served publicly — a page behind the waiting-list gate would be
 *      a 307 to a reviewer with no account, which is a 404 wearing better clothes.
 *   2. The page's clauses ARE the manifest's clauses. Not "the same words", which drift the first
 *      time somebody edits one and not the other — the same object. Every assertion below reads
 *      the text out of `manifestFrom` and demands it in the rendered markup, so an edit to the
 *      terms that skips this page turns these red.
 *   3. A register that could not be read never renders as zero declarations.
 */

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DesignDisclosure } from '../components/design/Disclosure';
import { AGENT_DISCLOSURE, AGENT_MANIFEST_REVISION } from '../lib/agent-manifest';
import { ALWAYS_OPEN } from '../lib/front-door';
import { DESTINATIONS } from '../lib/site-map';

afterEach(cleanup);

/** The whole visible text of the page, with the whitespace React inserts between nodes collapsed. */
function renderedText(register: { standing: number | null; why: string }): string {
  render(<DesignDisclosure register={register} />);
  return (document.body.textContent ?? '').replace(/\s+/g, ' ');
}

/** The clauses as they will be served, collapsed the same way, so the two are comparable. */
function collapse(text: string): string {
  return text.replace(/\s+/g, ' ');
}

describe('the address is served, and open', () => {
  it('is in the list of paths that answer without an account', () => {
    /*
      The mutation this guards: adding the page and forgetting the front door. The route would
      exist, `next build` would emit it, every test below would pass, and the reader it was written
      for — no account, not asking for one — would be redirected to the waiting list.
    */
    expect(ALWAYS_OPEN).toContain('/disclosure');
  });

  it('has a place on the site map, so the walk over app/ does not fail', () => {
    const destination = DESTINATIONS.get('/disclosure');
    expect(destination).toBeDefined();
    expect(destination?.label.length).toBeGreaterThan(0);
  });
});

describe('the page renders the manifest’s own clauses', () => {
  it('shows every rule an agent is held to, in the manifest’s words', () => {
    const text = renderedText({ standing: 3, why: '' });
    for (const clause of [
      AGENT_DISCLOSURE.requirement,
      AGENT_DISCLOSURE.userAgent,
      AGENT_DISCLOSURE.principal,
      AGENT_DISCLOSURE.impersonation,
      AGENT_DISCLOSURE.backoff,
      AGENT_DISCLOSURE.basis,
      AGENT_DISCLOSURE.notEnforced,
    ]) {
      expect(text).toContain(collapse(clause));
    }
  });

  it('lists what a machine actually checks, and nothing it does not', () => {
    const text = renderedText({ standing: 3, why: '' });
    for (const item of AGENT_DISCLOSURE.enforced) expect(text).toContain(collapse(item));
    // The honest half. A page that published the enforced list alone would read as a promise.
    expect(text).toContain(collapse(AGENT_DISCLOSURE.notEnforced));
  });

  /*
    That the served manifest carries this very object — identity, not equal strings — is asserted in
    `test/agent-manifest.test.ts`, next to the `inputs()` fixture that builds a manifest. It belongs
    there rather than here: the claim is about the manifest, and equal-looking copies are exactly
    what it refuses.
  */

  it('did not move the manifest revision, because it changed no served character', () => {
    // Extracting the block is a refactor of where the terms live, not an edit to the terms.
    expect(AGENT_MANIFEST_REVISION).toBe(22);
  });
});

describe('the register count is a reading', () => {
  it('says how many declarations stand when the register answered', () => {
    const text = renderedText({ standing: 4, why: '' });
    expect(text).toContain('4');
    expect(text).toContain('declarations stand');
  });

  it('says "declaration stands" for exactly one', () => {
    expect(renderedText({ standing: 1, why: '' })).toContain('declaration stands');
  });

  it('reports a failed read as a failed read, and never as zero', () => {
    const text = renderedText({ standing: null, why: 'detail-abc123' });
    expect(text).toContain('could not be read');
    expect(text).toContain('detail-abc123');
    /*
      The number that must not appear. A page that folded the failure into a count would tell a
      regulator that nobody has declared, which is a claim this deployment did not measure and
      cannot make — and it is exactly the sentence a reviewer would quote back.
    */
    expect(text).not.toContain('0 declarations');
    expect(text).not.toContain('declarations stand');
  });

  it('points at the two machine-readable forms of the register', () => {
    const text = renderedText({ standing: 2, why: '' });
    expect(text).toContain('/api/agents');
    expect(screen.getByRole('link', { name: /directory/i })).toHaveProperty('href');
  });
});
