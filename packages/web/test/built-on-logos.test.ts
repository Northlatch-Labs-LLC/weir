// Built-by: @projectx.sui · Co-authored-by: Claude
/**
 * The "Built on" marks are real files, named consistently, and decorative.
 *
 * # Why this file exists
 *
 * The feed's home rail renders a "Built on" list, and
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
  /*
    The canonical list, and the page that renders it at full size.

    This used to point at the footer, where the marks were one column of six on every page — the
    place a partner's mark goes to be ignored. The list moved to `lib/built-on.ts` so no rendering
    owns the data, and `/security` renders it: that page exists to answer what this is built on,
    and there the one-line notes can actually be read.
  */
  canonical: join(ROOT, 'lib', 'built-on.ts'),
  security: join(ROOT, 'components', 'design', 'Security.tsx'),
};

/** Every `{ name, logo }` pair in a source file's BUILT_ON list. */
function partnersIn(path: string): Array<{ name: string; logo: string }> {
  const source = readFileSync(path, 'utf8');
  // Tolerant of the declaration's shape: the canonical list is a typed export, the two renderings
  // are plain consts, and all three are the same data.
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
      // A list with no logos would pass every existence check below by having nothing to check.
      expect(partners.length).toBeGreaterThanOrEqual(4);
      for (const { name, logo } of partners) {
        expect(logo.startsWith('/brand/built-on/'), `${name}: ${logo} is outside the brand directory`).toBe(true);
        expect(existsSync(join(ROOT, 'public', logo)), `${name}: ${logo} is not on disk`).toBe(true);
      }
    });
  }

  it('name the same partners in both places', () => {
    /*
      The feed used to list three and the shell's right rail four. One site, one answer to "built
      on what". That rail is deleted — it was part of the chrome the application replaced — so the
      list it carried is no longer one of the places to agree with, and the third arm of this
      comparison went with it.
    */
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
    /*
      They used to be checked into the footer, on every page. That guaranteed they were *seen* and
      guaranteed nobody read them: five logos beside the legal links. The claim this now holds is
      the one worth holding — that the page a reader goes to for this question actually renders the
      list, from the shared file, rather than naming the partners in prose.
    */
    const security = readFileSync(LISTS.security, 'utf8');
    expect(security, 'the page does not import the shared list').toContain("from '@/lib/built-on'");
    expect(security, 'the page imports the list and never renders it').toContain('BUILT_ON.map');
  });
});

describe('the image is decorative', () => {
  /*
    The feed's own copy of this list is gone.

    It stood in the rail beside the posts, a second rendering of what the footer already carries on
    every page including the shut door — and the test above is what guarantees that. Five partner
    logos next to a feed answer a question nobody reading posts is asking, so the rail is now the
    creators and nothing else.

    The case is removed rather than the assertion weakened: there is no image in `Home.tsx` to have
    an alt attribute, which is a different fact from an image whose alt went unchecked.
  */
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
