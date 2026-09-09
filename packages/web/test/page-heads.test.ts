// Built-by: @projectx.sui · Co-authored-by: Claude
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

    it(`/${relative} names itself`, () => {
      const source = readFileSync(page, 'utf8');

      /*
        Two mechanisms, one guarantee.

        `PageHead` is the legacy one. A page rebuilt onto the application frame hands its content to
        a screen in `components/app/`, and that screen mounts `ColumnHeader`, which renders the
        `h1`. Following the import keeps this assertion about the thing it has always been about —
        does this route produce a heading — rather than about which component produced it.

        Accepting only `PageHead` would have failed three rebuilt routes that DO have headings, and
        the cure for that would have been to skip them, which is how a guard quietly stops guarding.
      */
      if (source.includes('<PageHead')) {
        expect(source).toContain("from '@/components/design/PageHead'");
        return;
      }

      const screen = /from '@\/(components\/app\/[A-Za-z]+)'/.exec(source)?.[1];
      expect(screen, `${relative} mounts neither a PageHead nor a screen from components/app`).toBeDefined();
      const screenSource = readFileSync(resolve(process.cwd(), `${screen}.tsx`), 'utf8');
      expect(screenSource, `${screen} renders no ColumnHeader, so /${relative} has no heading`).toContain('<ColumnHeader');
    });
  }
});

describe('the page head itself', () => {
  const head = readFileSync(resolve(process.cwd(), 'components/design/PageHead.tsx'), 'utf8');

  /*
    `PageHead` renders semantics and no shell: a header, an h1 and a lede, under one class.

    There are two shells now. A page inside the application column wants the compact sticky title
    bar; the same page inside the public document — `/security`, the agent pages, the legal pages —
    wants a display heading, because it is the first thing on something being read rather than a
    label on a column being navigated. Rendering the difference here would mean this component
    knowing which shell it is in, which it cannot; `.w-column .w-phead` and `.w-doc .w-phead` decide.
  */
  it('renders a real h1, and lets the shell decide what it looks like', () => {
    expect(head).toMatch(/<h1[\s>]/);
    expect(head).toContain('className="w-phead"');
  });

  it('carries no shell of its own', () => {
    /*
      The regression this guards: a component that draws its own chrome renders two headers on one
      of the two shells. It draws a header element and nothing around it.
    */
    expect(head).not.toContain('<ColumnHeader');
    expect(head).not.toContain('w-rail');
  });

  it('is styled for both shells', () => {
    /*
      Half of this change lives in CSS, and a missing half is exactly the inversion that made
      `/agents/build` unreadable — a 20px page title above 48px section headings.
    */
    const sheet = readFileSync(resolve(process.cwd(), '../ui/src/theme/weir-ui.css'), 'utf8');
    expect(sheet).toContain('.w-column .w-phead');
    expect(sheet).toContain('.w-doc .w-phead');
  });

  it('keeps the whole heading, accent included', () => {
    /*
      `accent` always held the second half of the sentence — `title="Say what you are"`
      `accent="say so."` — so a head that rendered only `title` would silently truncate the
      heading on twenty pages.
    */
    expect(head).toContain('accent === undefined ? title : `${title} ${accent}`');
  });

  it('draws no display hero of its own any more', () => {
    /*
      The regression this guards: a page hero three lines tall, inside a 640px column, meant a
      reader opening their earnings met sixty-point type before a single figure.

      Scoped to `PageHead`'s own body rather than the file, which also exports `PageSection` — a section
      heading inside a page legitimately still carries the gradient, and asserting against the whole
      file would fail for the wrong reason.
    */
    const body = head.slice(head.indexOf('export function PageHead'), head.indexOf('export function PageSection'));
    expect(body).not.toContain('weir-pagehead__title');
    expect(body).not.toContain('weir-grad');
    // And the h1 is not sized in this file: the shell decides, so a page cannot carry one size into
    // a shell built for the other.
    expect(body).not.toMatch(/fontSize|font-size/);
  });
});
