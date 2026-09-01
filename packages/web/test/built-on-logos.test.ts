// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
/**
 * The "Built on" marks are real files, named consistently, and decorative.
 *
 * # Why this file exists
 *
 * Two places render a "Built on" list — the feed's home rail and the shell's right rail — and both
 * used to show a letter in a box where a partner's mark belongs. The owner supplied the marks. A
 * path typed into a list is a claim that a file exists; a broken image on the front page is what
 * that claim looks like when it stops being true, and nothing in a render test notices a 404.
 *
 * So every `logo:` path in either list is checked against the disk, the two lists are checked
 * against each other so the site does not name four partners in one place and three in another,
 * and the image is checked to be decorative — the partner's name is the link text beside it, and an
 * `alt` repeating it would read the name twice to a screen reader.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..');
const LISTS = {
  feed: join(ROOT, 'components', 'feed', 'FeedView.tsx'),
  rail: join(ROOT, 'components', 'shell', 'RightRail.tsx'),
};

/** Every `{ name, logo }` pair in a source file's BUILT_ON list. */
function partnersIn(path: string): Array<{ name: string; logo: string }> {
  const source = readFileSync(path, 'utf8');
  const block = source.slice(source.indexOf('BUILT_ON = ['), source.indexOf('];', source.indexOf('BUILT_ON = [')));
  return Array.from(block.matchAll(/name: '([^']+)'[^\n]*?logo: '([^']+)'/g)).map((m) => ({
    name: m[1] as string,
    logo: m[2] as string,
  }));
}

describe('the partner marks', () => {
  for (const [where, path] of Object.entries(LISTS)) {
    it(`in the ${where} list are files that are actually served`, () => {
      const partners = partnersIn(path);
      // A list with no logos would pass every existence check below by having nothing to check.
      expect(partners.length).toBeGreaterThanOrEqual(4);
      for (const { name, logo } of partners) {
        expect(logo.startsWith('/brand/built-on/'), `${name}: ${logo} is outside the brand directory`).toBe(true);
        expect(existsSync(join(ROOT, 'public', logo)), `${name}: ${logo} is not on disk`).toBe(true);
      }
    });
  }

  it('name the same partners in both places', () => {
    // The feed used to list three and the rail four. One site, one answer to "built on what".
    const feed = partnersIn(LISTS.feed).map((p) => p.name).sort();
    const rail = partnersIn(LISTS.rail).map((p) => p.name).sort();
    expect(feed).toEqual(rail);
    expect(feed).toEqual(['Seal', 'Sui', 'Walrus', 'zkLogin']);
  });

  it('use the same file for the same partner in both places', () => {
    const feed = new Map(partnersIn(LISTS.feed).map((p) => [p.name, p.logo]));
    for (const { name, logo } of partnersIn(LISTS.rail)) {
      expect(feed.get(name), `${name} points at a different file in the two lists`).toBe(logo);
    }
  });
});

describe('the image is decorative', () => {
  for (const [where, path] of [
    ['home list', join(ROOT, 'components', 'design', 'Home.tsx')],
    ['right rail', LISTS.rail],
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
