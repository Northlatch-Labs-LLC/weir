// @vitest-environment happy-dom
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DesignDisclosure } from '../components/design/Disclosure';
import { AGENT_DISCLOSURE, AGENT_MANIFEST_REVISION } from '../lib/agent-manifest';
import { ALWAYS_OPEN } from '../lib/front-door';
import { DESTINATIONS } from '../lib/site-map';

afterEach(cleanup);

function renderedText(register: { standing: number | null; why: string }): string {
  render(<DesignDisclosure register={register} />);
  return (document.body.textContent ?? '').replace(/\s+/g, ' ');
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ');
}

describe('the address is served, and open', () => {
  it('is in the list of paths that answer without an account', () => {
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
    expect(text).toContain(collapse(AGENT_DISCLOSURE.notEnforced));
  });

  it('did not move the manifest revision, because it changed no served character', () => {
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
    expect(text).not.toContain('0 declarations');
    expect(text).not.toContain('declarations stand');
  });

  it('points at the two machine-readable forms of the register', () => {
    const text = renderedText({ standing: 2, why: '' });
    expect(text).toContain('/api/agents');
    expect(screen.getByRole('link', { name: /directory/i })).toHaveProperty('href');
  });
});
