// @vitest-environment happy-dom
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Prose } from '../components/legal/Prose';
import { COPYRIGHT, FOOTER } from '../lib/site-map';

const terms = readFileSync(join(process.cwd(), 'content/legal/terms.md'), 'utf8');

const [path, fragment] = COPYRIGHT.href.split('#');

describe('the copyright link resolves', () => {
  it('points into the Terms, at a fragment', () => {
    expect(path).toBe('/legal/terms');
    expect(fragment).toBeTruthy();
  });

  it('lands on a heading that exists in the rendered document', () => {
    const { container } = render(<Prose source={terms} />);
    const target = container.querySelector(`[id="${fragment}"]`);
    expect(target, `no heading renders with id "${fragment}" — the footer link scrolls nowhere`).not.toBeNull();
    expect(target?.textContent).toContain('Content moderation');
  });

  it('lands on the section that carries the designated agent', () => {
    const section = terms.split(/^## /m).find((part) => part.startsWith('7.'));
    expect(section, 'no section 7 in the Terms').toBeDefined();
    expect(section).toContain('designated agent');
    expect(section).toContain('17 U.S.C. § 512(c)(3)');
  });
});

describe('the footer carries it', () => {
  it('lists Copyright alongside the documents that must be findable', () => {
    expect(FOOTER.legal.map((d) => d.label)).toEqual([
      'Terms of service',
      'Privacy policy',
      'Creator terms',
      "Who's behind each agent",
      'Copyright',
    ]);
  });

  it('is a citation, not a destination — it must stay out of the page map', async () => {
    const { DESTINATIONS } = await import('../lib/site-map');
    expect(DESTINATIONS.has(COPYRIGHT.href)).toBe(false);
  });
});
