// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
/**
 * The front door: who may close it, and what stays reachable when it is closed.
 *
 * # Why these particular assertions
 *
 * The gate is small and every way it can be wrong is expensive:
 *
 * # What is asserted here and what is not
 *
 * The chain read is exercised against mainnet by `scripts/verify-site-admin.ts`, deliberately kept
 * out of this suite: `vitest.config.ts` says unit tests only, because a suite that fails when a
 * fullnode is slow is a suite people learn to ignore.
 *
 * What is left is the part that is pure logic and pure source, and it is the part most likely to be
 * broken by a well-meaning edit later.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const PROXY = readFileSync(resolve(process.cwd(), 'proxy.ts'), 'utf8');
/*
  The exemption list moved to `lib/front-door.ts` on 2026-09-04, when the agent manifest became its
  second reader. Read here so the assertion below keeps asserting the list rather than the file it
  used to live in; the proxy is separately checked to consult it.
*/
const DOOR = readFileSync(resolve(process.cwd(), 'lib/front-door.ts'), 'utf8');
const ADMIN = readFileSync(resolve(process.cwd(), 'lib/site-admin.ts'), 'utf8');
const MODE = readFileSync(resolve(process.cwd(), 'lib/site-mode.ts'), 'utf8');
const ROUTE = readFileSync(resolve(process.cwd(), 'app/api/site-mode/route.ts'), 'utf8');

/**
 * Source with comments removed.
 *
 * These files explain at length *why* there is no allowlist and why the authority is not
 * `PlatformCap` — so a naive search for those words matches the prose arguing against them and
 * fails a correct implementation. Asserting on the code means the documentation can stay as
 * detailed as it needs to be.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('the gate', () => {
  it('is a proxy, because middleware is deprecated in Next 16', () => {
    /*
      `middleware.js` was renamed to `proxy.js` in Next 16 and the bundled docs say so. Recreating
      it under the old name would produce a file the framework never calls — a gate that silently
      does nothing, which is the worst possible failure for this particular feature.
    */
    expect(PROXY).toContain('export async function proxy');
  });

  it('lets the waiting list, sign-in and the API through', () => {
    for (const path of ['/waitlist', '/signin', '/auth/callback', '/api/']) {
      expect(DOOR).toContain(`'${path}'`);
    }
    // And the gate actually reads that list, rather than carrying one of its own.
    expect(PROXY).toContain("from '@/lib/front-door'");
    expect(PROXY).toContain('isAlwaysOpen(pathname)');
  });

  it('lets the site administrator through, so closing cannot lock them out', () => {
    expect(PROXY).toContain('isSiteAdmin');
  });

  it('identifies that administrator from a proved session, never from ?reader=', () => {
    // `?reader=` is a claim anybody can type. A switch guarded by a query parameter is not guarded.
    expect(PROXY).toContain('provenReaderFor');
    expect(PROXY).not.toContain('searchParams.get');
  });

  it('redirects temporarily, so a reopened site is not cached shut', () => {
    /*
      308 would be cached by browsers and outlive the switch being turned off — readers stranded on
      the waiting list after the site reopened, with nothing on the server able to correct it.
    */
    expect(PROXY).toContain('307');
    expect(PROXY).not.toMatch(/redirect\([^)]*,\s*308\)/);
  });

  it('gates by exclusion, so a page added later is covered by default', () => {
    expect(PROXY).toMatch(/matcher/);
    expect(PROXY).toContain('?!_next/static');
  });
});

describe('who may close the site', () => {
  it('is asked of the chain, not of a table or an environment variable', () => {
    expect(ADMIN).toContain('listOwnedObjects');
    // A role column or an allowlist is a second answer to a question the chain already settles.
    expect(code(ADMIN)).not.toMatch(/ADMIN_ADDRESS|allowlist|isAdmin\s*=\s*\[/);
  });

  it('checks the Publisher belongs to THIS package', () => {
    expect(ADMIN).toContain('0x2::package::Publisher');
    expect(ADMIN).toContain('samePackage');
    expect(ADMIN).toContain('config.value.packageId');
  });

  it('treats a failed read as "no", never as permission', () => {
    expect(ADMIN).toMatch(/catch\s*{[^}]*return false/s);
  });

  it('is not the PlatformCap', () => {
    /*
      Deliberate. Protocol authority governs fees, pauses and the treasury and belongs in cold
      custody; requiring it here would mean either a multisig ceremony to close a landing page, or
      keeping that capability somewhere convenient *so that* the landing page stays operable.

      The prose says `PlatformCap` when explaining the distinction, so this asserts on the code
      rather than the comments.
    */
    expect(code(ADMIN)).not.toContain('PlatformCap');
  });
});

describe('the API', () => {
  it('proves both who is asking and whether they may', () => {
    expect(ROUTE).toContain('provenReaderFor');
    expect(ROUTE).toContain('isSiteAdmin');
  });

  it('refuses a non-boolean rather than coercing it', () => {
    // `"false"` is a truthy string. A switch that closes the site because somebody sent the word
    // "false" is the kind of bug found by customers.
    expect(ROUTE).toContain("typeof waitlistMode !== 'boolean'");
  });

  it('answers a refusal identically whoever asked', () => {
    // Distinguishing "not signed in" from "signed in and not the administrator" tells an
    // unauthenticated caller which addresses are worth attacking.
    const refusals = ROUTE.match(/does not administer the site/g) ?? [];
    expect(refusals.length).toBe(1);
  });
});

describe('reading the mode', () => {
  it('fails open, and says why', () => {
    /*
      The one deliberate fail-open in this codebase. Everywhere else a failed read locks, because
      the thing protected is somebody's paid content. Here it is a marketing preference, and
      locking would turn a database blip into an outage of the whole live product.
    */
    expect(MODE).toContain('fail-open');
    expect(MODE).toMatch(/catch\s*{[\s\S]{0,200}return OPEN/);
  });

  it('does not check authority itself', () => {
    // Kept in the caller so it cannot be accidentally satisfied by whatever happens to be in scope.
    expect(MODE).not.toContain('isSiteAdmin');
  });
});
