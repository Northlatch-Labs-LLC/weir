// Built-by: @projectx.sui · Co-authored-by: Claude
/**
 * An entitlement is never resolved for an address the caller merely named.
 *
 * # The defect this pins
 *
 * `readEntitlements(reader)` asks the chain which `Subscription` and `Unlock` objects `reader`
 * owns, and `canRead` decides from the answer. Both are correct. Neither has any way of knowing
 * whether the caller *is* `reader`.
 *
 * Four call sites took that address straight out of the URL — `?reader=0x…` — with nothing proving
 * it. Anybody could name somebody else's address and be handed their entitlements:
 *
 *   1. `VaultOpened` / `PaymentSettled` events are public, so buyers are trivially enumerable.
 *   2. `GET /?reader=<a buyer>` renders the feed with `body` **and `assetIds`** released.
 *   3. `GET /api/media/<post>/<asset>?reader=<that buyer>` decrypts the Walrus blob and serves it.
 *   4. `GET /api/comments?postId=…&reader=<that buyer>` returns the paid discussion.
 *
 * No wallet, no signature, no purchase. The encryption at rest did not help: this server holds the
 * key and `readAsset` decrypts before responding, so the route is the only gate there is.
 *
 * # Why the original reasoning missed it
 *
 * Two comments in the codebase argued this was safe, on the grounds that naming an address cannot
 * forge ownership of anything. That is true, and it is not the question. The attacker never forges
 * ownership — they borrow the entitlement of somebody who genuinely has it. A confused deputy.
 *
 * # The invariant, stated so it cannot be satisfied by accident
 *
 * Every argument reaching `readEntitlements` must be **proved in the same file**, by one of:
 *
 *   - `provenReader…()` — resolved from the signed read-session cookie, or
 *   - `verifyAction({ address: X … })` — that exact address signed this exact request.
 *
 * A literal `null` is always fine: it means "anonymous", which grants nothing.
 *
 * Asserted against the source because these are async server components and route handlers that
 * read the chain and the store; standing both up here would test the infrastructure rather than the
 * rule. This is the approach `creator-page.test.ts` takes, for the same reason.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const APP = join(import.meta.dirname, '..', 'app');

/** Every `.ts`/`.tsx` file under `app/`. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry) ? [path] : [];
  });
}

/** A path as it reads in a failure message: `app/api/media/[postId]/[assetId]/route.ts`. */
function label(path: string): string {
  return path.slice(path.lastIndexOf('/app/') + 1);
}

/**
 * The argument expressions passed to `readEntitlements` in one file.
 *
 * `?? null` is stripped: `readEntitlements(reader ?? null)` is a call on `reader`, and the fallback
 * only decides what happens when there is no reader at all.
 */
function entitlementArguments(source: string): string[] {
  return [...source.matchAll(/readEntitlements\(\s*([^)]*?)\s*\)/g)].map((match) =>
    (match[1] ?? '').replace(/\s*\?\?\s*null\s*$/, '').trim(),
  );
}

/** `const <name> = await provenReader…(` — resolved directly from the signed session cookie. */
function assignedFromSession(source: string, name: string): boolean {
  return new RegExp(`(?:const|let)\\s+${name}\\b[^;]*=\\s*await\\s+provenReader\\w*\\(`).test(
    source,
  );
}

/**
 * Is `name` proved somewhere in this file, rather than merely read off the request?
 *
 * Three shapes count, and nothing else does:
 *
 *   1. `const reader = await provenReaderFor(request)` — straight from the cookie.
 *   2. `const reader = fold(readerReading, …)` where `readerReading` came from the cookie. The
 *      session resolver returns a `Reading`, so a lookup that *failed* stays distinguishable from
 *      one that found nobody; the caller folds it to an address for the entitlement read and keeps
 *      the `Reading` to decide 503-versus-403. The fold is not a weakening — both of its branches
 *      yield either a proved address or `null`.
 *   3. `verifyAction({ address: name … })` — that exact address signed this exact request.
 *
 * Note what is deliberately *not* accepted: a fold over anything that did not come from the
 * session. Allowing that would let `fold(somethingFromTheUrl, …)` launder a claim into a proof —
 * the original defect wearing a combinator.
 */
function isProven(source: string, name: string): boolean {
  if (assignedFromSession(source, name)) return true;

  const foldedFrom = new RegExp(`(?:const|let)\\s+${name}\\b[^;]*=\\s*fold\\(\\s*(\\w+)`).exec(
    source,
  )?.[1];
  if (foldedFrom !== undefined && assignedFromSession(source, foldedFrom)) return true;

  return new RegExp(`verifyAction\\(\\s*\\{[^}]*address:\\s*${name}\\b`, 's').test(source);
}

const files = sources(APP).map((path) => ({ path, source: readFileSync(path, 'utf8') }));

const callSites = files.flatMap(({ path, source }) =>
  entitlementArguments(source).map((argument) => ({ path, source, argument })),
);

describe('entitlements are resolved only for a proven reader', () => {
  it('finds the call sites it is meant to be guarding', () => {
    // A regex that silently matched nothing would make every assertion below vacuously true —
    // which is the exact failure mode this file exists to prevent elsewhere.
    expect(callSites.length).toBeGreaterThan(0);
  });

  it.each(callSites.map((site) => [label(site.path), site] as const))(
    '%s resolves entitlements only for an address it proved',
    (_name, site) => {
      const { source, argument } = site;

      // Anonymous is always safe: it grants nothing.
      if (argument === 'null') return;

      expect(
        isProven(source, argument),
        `readEntitlements(${argument}) — "${argument}" is not proved in this file. It must come ` +
          `from provenReader…() (the signed read-session cookie), or be an address that ` +
          `verifyAction proved. An address taken from the URL is a claim, not an identity.`,
      ).toBe(true);
    },
  );
});

describe('the reader query parameter is never an authority', () => {
  it.each(
    files
      .filter(({ source }) => source.includes('readEntitlements('))
      .map(({ path, source }) => [label(path), source] as const),
  )('%s does not pass a URL-supplied reader into the entitlement read', (_name, source) => {
    /*
      Catches the shape directly rather than only its consequence. `?reader=` may go on existing as
      a hint to the interface about which account is connected — what it may never do again is
      decide what somebody is allowed to read.
    */
    const namesFromUrl = [
      ...source.matchAll(
        /(?:const|let)\s+(\w+)\s*=\s*[^;]*searchParams(?:\.get\(['"]reader['"]\)|\W[^;]*\breader\b)/g,
      ),
    ].map((match) => match[1] as string);

    for (const name of namesFromUrl) {
      expect(
        entitlementArguments(source),
        `"${name}" is read from the URL and passed to readEntitlements`,
      ).not.toContain(name);
    }
  });
});
