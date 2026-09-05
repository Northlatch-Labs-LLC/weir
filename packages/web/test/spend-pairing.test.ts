// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Claude
/**
 * Every route that defers a signature's spend must actually spend it.
 *
 * # Why this test exists at all
 *
 * Splitting `verifyAction` into a proof and a claim fixed the transaction problem and moved the
 * guarantee out of the function and into its callers. `verifyActionDeferringSpend` returns a digest
 * that has NOT been recorded; only `spendSignature` records it. So a route that calls the first and
 * forgets the second has silently restored the behaviour of the commit before that split — a write
 * signature that can be replayed for the whole freshness window — and nothing reports it. Not the
 * type system: the proof is a valid `Reading` whether or not anyone spends it. Not the linter, not
 * the runtime, and not a route test, which would pass because the route still works. It works
 * exactly as well as an unprotected route does.
 *
 * This is the cost of making a guard shareable: its edges travel with its guarantees, and they
 * arrive at the second caller without the reasoning that made the first one safe. There is one
 * deferring route today and it pairs correctly. This file is for the second one.
 *
 * # Why it reads the source
 *
 * The property is "these two calls appear together", which is a fact about the code rather than
 * about any single execution. No amount of exercising route one says anything about route two, and
 * route two does not exist yet — which is the point.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const API = join(process.cwd(), 'app', 'api');

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return routeFiles(path);
    return entry === 'route.ts' ? [path] : [];
  });
}

/*
  Comments stripped before anything is matched.

  A docblock naming `spendSignature` — this one nearly did — would satisfy a raw text search and
  report a route as paired because somebody described the pairing rather than performed it. That
  failure has already been made twice on this codebase, in both directions: a comment matched as
  code, and code missed because it sat inside one.
*/
function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');
}

const routes = routeFiles(API);

describe('the walk itself', () => {
  it('found the routes, so an empty result cannot pass as a clean one', () => {
    // Without this, a wrong path or a rename turns every assertion below into a vacuous truth, and
    // the suite goes green by having examined nothing.
    expect(routes.length).toBeGreaterThan(20);
  });

  it('is reading route files, not whatever else lives under app/api', () => {
    expect(routes.every((path) => path.endsWith(`${'/'}route.ts`))).toBe(true);
  });
});

describe('a route that defers the spend', () => {
  it('pairs verifyActionDeferringSpend with spendSignature in the same file', () => {
    const unpaired = routes.filter((path) => {
      const source = code(path);
      return (
        /\bverifyActionDeferringSpend\s*\(/.test(source) && !/\bspendSignature\s*\(/.test(source)
      );
    });

    /*
      Matched as CALLS, not as imports. An import that is never invoked is the exact shape of this
      mistake — a route copied from `posts/route.ts`, its transaction dropped during an edit, its
      import list untouched — and a check that accepted the import would pass on it.
    */
    expect(unpaired.map((path) => path.replace(process.cwd(), ''))).toEqual([]);
  });
});
