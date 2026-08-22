// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
/**
 * Every application page names itself.
 *
 * # The defect this pins
 *
 * Nothing looked broken. Each page still had prose, panels and working controls; they were simply
 * documents with no title, which is what somebody navigating by heading is handed. That is exactly
 * the class of regression a screenshot cannot catch and a route returning 200 does not contradict.
 *
 * # Why the source, and why not a render
 *
 * These are async server components that read the session, the chain and the store; rendering one
 * here would mean standing up all three. What is being defended is that each page *mounts a page
 * head at all*, which is visible in the source — the same approach `creator-page.test.ts` takes.
 *
 * A rendered check would be better and exists at a different level: the routes are probed for
 * `h1` count during verification. This is the cheap one that runs on every commit.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const APP = resolve(process.cwd(), 'app/(app)');

/** Every `page.tsx` under the application route group. */
function routePages(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...routePages(full));
    else if (entry === 'page.tsx') found.push(full);
  }
  return found;
}

const pages = routePages(APP);

/**
 * The one page that legitimately has no head of its own.
 *
 * `/auth/callback` is a redirect target: a visitor is on it for the moment it takes to exchange a
 * Google token, and it renders its own status. Giving it a page head would title a screen nobody
 * reads, and delay the thing they are waiting for behind it.
 */
// `verified` redirects to `names`; a redirect renders no heading because it renders nothing.
const NO_HEAD = ['auth/callback', 'verified'];

describe('every application page names itself', () => {
  it('finds the route group at all', () => {
    // Guards the guard. A rename that emptied this list would make every assertion below vacuous
    // and the suite would stay green while the thing it defends disappeared.
    expect(pages.length).toBeGreaterThanOrEqual(10);
  });

  for (const page of pages) {
    const relative = page.slice(APP.length + 1).replace(/\/page\.tsx$/, '') || '(index)';
    if (NO_HEAD.some((skip) => relative.startsWith(skip))) continue;

    it(`/${relative} mounts a page head`, () => {
      const source = readFileSync(page, 'utf8');
      expect(source).toContain('<PageHead');
      expect(source).toContain("from '@/components/design/PageHead'");
    });
  }
});

describe('the page head itself', () => {
  const head = readFileSync(resolve(process.cwd(), 'components/design/PageHead.tsx'), 'utf8');

  it('renders an h1, not a styled div', () => {
    /*
      The whole point. A `div` with heading-sized type looks identical and carries none of the
      document structure — which is the state these pages were already in, by accident.
    */
    expect(head).toMatch(/<h1[\s>]/);
  });

  it('keeps the accent out of the heading text itself', () => {
    expect(head).toContain('{title}');
    expect(head).toContain('weir-grad');
  });
});
