// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
//
// Every exported handler consults a limiter.
//
// `GET /api/creator/perks` was the one handler of sixty that did not: two Postgres round trips per
// call, unauthenticated, on a `handle` with no bound on its length. Against a small pool that is a
// way to hold connections without holding an account.
//
// Fixing that one route would leave the same gap open for the next route somebody adds, and the
// gap is invisible — nothing fails, nothing is slow in development, and the handler looks exactly
// like its neighbours. So this asserts the RULE rather than the instance: a handler that reaches
// the database or the chain and consults no limiter fails here, by name, before it ships.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const API = join(process.cwd(), 'app', 'api');

/** Source with comments stripped, so a mention in prose is never mistaken for a call. */
function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/** Every `route.ts` under app/api, by path relative to app/api. */
function routeFiles(dir = API, prefix = ''): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      found.push(...routeFiles(full, `${prefix}${entry}/`));
    } else if (entry === 'route.ts') {
      found.push(`${prefix}${entry}`);
    }
  }
  return found;
}

/*
  Handlers that deliberately consult no limiter, each with the reason it is exempt.

  An allowlist rather than a blanket rule, because "this one is fine" is a claim that should have to
  be written down and read by whoever adds the next one. An entry here is a decision; a route
  missing from both lists is a mistake.
*/
const EXEMPT: Readonly<Record<string, string>> = {
  /*
    Empty, and that is the finding: every handler in this API limits. The mechanism is kept rather
    than deleted because the next route that genuinely needs no limiter should have to write down
    why, here, where a reviewer sees it — and because an exemption that later grows a limiter is
    caught by the assertion below rather than quietly becoming a lie.

    The first draft of this file assumed `deployment/route.ts` was exempt. It is not; it limits like
    everything else, and this test said so.
  */
};

describe('every API handler consults a limiter', () => {
  const routes = routeFiles();

  it('finds the API surface at all', () => {
    // Guards against a vacuous pass: if the walk returns nothing, every assertion below holds
    // trivially and this file would report the codebase as perfect.
    expect(routes.length).toBeGreaterThan(30);
  });

  it.each(routes)('%s', (relative) => {
    const code = codeOf(readFileSync(join(API, relative), 'utf8'));
    const handlers = [...code.matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\b/g)].map(
      (m) => m[1],
    );
    if (handlers.length === 0) return;

    const exemptBecause = EXEMPT[relative];
    const limited = /\brateLimit\(|\bquotaLimit\(|\bsimulateLimit\(/.test(code);

    if (exemptBecause !== undefined) {
      // An exemption that has grown a limiter is not a failure, but the note is now wrong.
      expect(limited, `${relative} is listed as exempt but now limits: remove the exemption`).toBe(
        false,
      );
      return;
    }

    expect(
      limited,
      `${relative} exports ${handlers.join(', ')} and consults no limiter. Add rateLimit()/quotaLimit()/simulateLimit(), ` +
        'or add it to EXEMPT with the reason it needs none.',
    ).toBe(true);
  });
});

describe('the perks read is bounded before it reaches the database', () => {
  const code = codeOf(readFileSync(join(API, 'creator', 'perks', 'route.ts'), 'utf8'));

  it('limits the GET, not only the POST', () => {
    // The POST was limited from the start. The read was the one that was not, and the read is the
    // one anybody can call.
    const get = code.indexOf('export async function GET');
    const post = code.indexOf('export async function POST');
    const firstLimit = code.indexOf('rateLimit(');
    expect(get).toBeGreaterThan(-1);
    expect(firstLimit).toBeGreaterThan(get);
    expect(firstLimit).toBeLessThan(post === -1 ? Number.MAX_SAFE_INTEGER : post);
  });

  it('refuses a handle that is not handle-shaped before querying', () => {
    /*
      The COMPARISON, not the identifier. The first version of this asserted `/MAX_HANDLE_LEN/`,
      which the import line satisfies on its own — so deleting the check entirely left the assertion
      passing. A mutation proved it. An assertion matched by an import is matched by nothing that
      runs.
    */
    expect(code).toMatch(/handle\.length\s*>\s*MAX_HANDLE_LEN/);
  });
});

describe('the simulate class goes through the durable ceiling', () => {
  /*
    `rateLimit` counts in a module-level Map, and its own header says so: "Serverless multiplies
    instances, and each instance counts on its own." For most routes that is an acceptable first
    line. For these it is not the limit at all — each one builds a transaction and calls a fullnode
    WE PAY FOR, so a ceiling of twenty a minute is twenty times however many instances happen to be
    warm, and traffic is what makes them warm.

    `simulateLimit` runs the cheap Map first and then spends a row in Postgres, which is the ceiling
    that holds across instances.

    # Why this is asserted as an inverse and a floor rather than per route

    The obvious shape — find every route in the class, require each to call the guard — cannot be
    written, because after the fix the routes no longer contain the word `simulate` anywhere except
    in the call itself. Selecting them by that call and then asserting they make it is circular: it
    would pass on an empty set and on a codebase where the guard had been deleted from every one.

    So: NO route may reach the per-process limiter for this budget, which catches the old shape
    coming back one route at a time; and the guard must appear at least twenty times, which catches
    it being stripped out wholesale. Neither can be satisfied by an import line.
  */
  const all = routeFiles().map((relative) => ({
    relative,
    code: codeOf(readFileSync(join(API, relative), 'utf8')),
  }));

  it('found the routes, so an empty result cannot pass as a clean one', () => {
    expect(all.length).toBeGreaterThan(30);
  });

  it('no route reaches the per-process limiter for this budget', () => {
    /*
      Matched as a CALL carrying the budget name. An assertion matched by an import is matched by
      nothing that runs — that mistake has already been made once in this file and a mutation caught
      it, which is why the comparison rather than the identifier is matched here too.
    */
    const direct = all
      .filter(({ code }) => /\brateLimit\(\s*\w+\s*,\s*'simulate'\s*\)/.test(code))
      .map(({ relative }) => relative);

    expect(direct).toEqual([]);
  });

  it('the durable guard is actually wired, in the numbers this class has', () => {
    // A floor, not an exact count: a route legitimately leaving the class should not fail this.
    // Deleting the guard from all of them, which is the failure that matters, cannot pass it.
    const wired = all.filter(({ code }) => /\bsimulateLimit\s*\(/.test(code));

    expect(wired.length).toBeGreaterThanOrEqual(20);
  });
});
