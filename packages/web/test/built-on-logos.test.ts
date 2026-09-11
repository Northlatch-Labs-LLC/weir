// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..');
const LISTS = {
  feed: join(ROOT, 'components', 'feed', 'FeedView.tsx'),
  canonical: join(ROOT, 'lib', 'built-on.ts'),
  security: join(ROOT, 'components', 'design', 'Security.tsx'),
};

function partnersIn(path: string): Array<{ name: string; logo: string }> {
  const source = readFileSync(path, 'utf8');
  const start = source.indexOf('BUILT_ON');
  const open = source.indexOf('[', start);
  const block = source.slice(open, source.indexOf('];', open));
  return Array.from(block.matchAll(/name: '([^']+)'[^\n]*?logo: '([^']+)'/g)).map((m) => ({
    name: m[1] as string,
    logo: m[2] as string,
  }));
}

describe('the partner marks', () => {
  for (const [where, path] of [['feed', LISTS.feed], ['canonical', LISTS.canonical]] as const) {
    it(`in the ${where} list are files that are actually served`, () => {
      const partners = partnersIn(path);
      expect(partners.length).toBeGreaterThanOrEqual(4);
      for (const { name, logo } of partners) {
        expect(logo.startsWith('/brand/built-on/'), `${name}: ${logo} is outside the brand directory`).toBe(true);
        expect(existsSync(join(ROOT, 'public', logo)), `${name}: ${logo} is not on disk`).toBe(true);
      }
    });
  }

  it('name the same partners in both places', () => {
    const feed = partnersIn(LISTS.feed).map((p) => p.name).sort();
    const canonical = partnersIn(LISTS.canonical).map((p) => p.name).sort();
    expect(canonical).toEqual(feed);
    expect(feed).toEqual(['Seal', 'Sui', 'Walrus', 'zkLogin']);
  });

  it('use the same file for the same partner in both places', () => {
    const feed = new Map(partnersIn(LISTS.feed).map((p) => [p.name, p.logo]));
    for (const path of [LISTS.canonical]) {
      for (const { name, logo } of partnersIn(path)) {
        expect(feed.get(name), `${name} points at a different file in ${path}`).toBe(logo);
      }
    }
  });

  it('are rendered on /security, which is the page that answers what this is built on', () => {
    const security = readFileSync(LISTS.security, 'utf8');
    expect(security, 'the page does not import the shared list').toContain("from '@/lib/built-on'");
    expect(security, 'the page imports the list and never renders it').toContain('BUILT_ON.map');
  });
});

describe('the image is decorative', () => {
  for (const [where, path] of [
    ['security page', LISTS.security],
  ] as const) {
    it(`carries an empty alt in the ${where}, so the name is read once`, () => {
      const source = readFileSync(path, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/^\s*\/\/.*$/gm, ' ');
      const img = source.match(/<img[^>]*src=\{[^}]*logo[^}]*\}[^>]*>/);
      expect(img, 'no <img> bound to the logo').not.toBeNull();
      expect(img?.[0]).toMatch(/alt=""/);
    });
  }
});
