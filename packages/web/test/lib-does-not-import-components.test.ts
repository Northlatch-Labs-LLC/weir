// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Claude
/**
 * `lib/` must never import from `components/`.
 *
 * # The outage this exists to prevent
 *
 * On 2026-09-06, `lib/structured-data.ts` imported the `SOCIAL` constant from
 * `components/shell/SiteFooter.tsx` to fill JSON-LD's `sameAs`. The root layout imports the
 * structured data for its metadata, so the layout's metadata came to depend on a component module.
 *
 * In the server bundle that module had not finished initialising when `generateMetadata` ran.
 * `SOCIAL` was `undefined`, and EVERY server-rendered page answered 500:
 *
 *     TypeError: c.SOCIAL.map is not a function
 *       at a.s.themeColor (.next/server/chunks/ssr/[root-of-the-server]__1s-ig2e.js)
 *
 * What makes it worth a guard is what did NOT catch it. The types were correct, so `tsc` passed.
 * No test renders the layout's metadata through the bundler, so 3,483 tests passed. The failure is
 * at request time, not build time, so `next build` passed. It reached production and was found by
 * the site being down.
 *
 * # The rule
 *
 * Components may import from `lib/`. `lib/` may not import from `components/`. A value both need
 * lives in `lib/` — `lib/social-links.ts` is that value, and its own comment records why.
 *
 * # Mutation this must catch
 *
 * Point any file under `lib/` at `@/components/...` or a relative `../components/...` and this
 * goes red, naming the file and the import.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const LIB = join(process.cwd(), 'lib');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return full.endsWith('.ts') || full.endsWith('.tsx') ? [full] : [];
  });
}

/**
 * Runtime imports only.
 *
 * `import type { X } from '@/components/...'` is erased by the compiler and creates no module
 * dependency at all, so it cannot cause the initialisation-order failure this file guards. Flagging
 * it would make the rule wider than the hazard, and a rule wider than its hazard gets exceptions
 * added to it until it means nothing. `lib/site-map.ts` holds exactly such a type import and is
 * correct as written.
 */
const SPECIFIERS = /(?<!\bimport\s+type\s)(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;

describe('lib/ does not import from components/', () => {
  const offenders = walk(LIB).flatMap((file) => {
    const source = readFileSync(file, 'utf8');
    const hits: string[] = [];
    for (const line of source.split('\n')) {
      if (/^\s*(?:\/\/|\*)/.test(line)) continue;
      if (/^\s*import\s+type\s/.test(line)) continue;
      for (const match of line.matchAll(SPECIFIERS)) {
        const spec = match[1];
        if (spec !== undefined && spec.includes('components/')) {
          hits.push(`${file.slice(process.cwd().length + 1)} -> ${spec}`);
        }
      }
    }
    return hits;
  });

  it('has no module under lib/ importing a component', () => {
    expect(offenders).toEqual([]);
  });

  it('would catch the import that took the site down', () => {
    const line = "import { SOCIAL } from '@/components/shell/SiteFooter';";
    expect([...line.matchAll(SPECIFIERS)].some((m) => m[1]?.includes('components/') === true)).toBe(true);
  });

  it('leaves a type-only import alone, because it is erased before it can run', () => {
    const line = "import type { IconName } from '@/components/design/icons';";
    expect(/^\s*import\s+type\s/.test(line)).toBe(true);
  });
});
