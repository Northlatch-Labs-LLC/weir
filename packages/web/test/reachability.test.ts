// Built-by: @projectx.sui · Co-authored-by: Claude
/**
 * Nothing ships that nothing can reach.
 *
 * # The defect class this exists for
 *
 * Every failure below was found by running the product, never by reading it or by the test suite,
 * and each one was fully typed, commented and green:
 *
 *   - `/api/studio/upload` had no caller, and stored bytes to a serverless disk that evaporates.
 *   - `/api/checkout/unlock` had no caller, so a locked post showed a price and no way to pay it.
 *   - `/api/checkout/tip` had no caller, while a comment in the creator setup told creators
 *     "tips and one-off unlocks already work".
 *   - `profiles.stake_vault_id` was read in three places and written by none, which switched off
 *     the "free support" badge for everybody.
 *
 * The shape is always the same: code that is correct in isolation and connected to nothing. A type
 * checker cannot see it, because every individual piece type-checks. A unit test cannot see it,
 * because the piece under test is fine. Only the absence of a caller gives it away.
 *
 * # How this stays honest
 *
 * The allowlist is exact, not a floor. An entry that becomes reachable fails the test just as
 * loudly as a new unreachable route does — otherwise the list grows quietly and the guard becomes
 * a record of things nobody intends to fix. Every entry states why it is there and what would
 * remove it.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const web = join(import.meta.dirname, '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(join(web, dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(web, rel)).isDirectory()) walk(rel, out);
    else out.push(rel);
  }
  return out;
}

/**
 * Every source file that could plausibly call something. Tests are deliberately excluded.
 *
 * **Comments are stripped before anything is matched.** They were not, and the omission was found
 * the honest way: a new module's docstring mentioned `/api/studio/upload` while explaining what
 * gates it, and this suite promptly reported the route as wired up. Nothing called it. A prose
 * mention is not a caller, and a guard that cannot tell the difference can be silenced by writing
 * about the dead code instead of deleting it.
 */
const sources = ['app', 'components', 'lib']
  .flatMap((d) => walk(d))
  .filter((f) => f.endsWith('.ts') || f.endsWith('.tsx'))
  .map((f) => ({
    file: f,
    text: readFileSync(join(web, f), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, ''),
  }));

/**
 * Routes with no caller anywhere in the application.
 *
 * Each one is a live gap, not a style problem: an endpoint the product cannot reach is either a
 * feature that was never wired up or one that was wired up and then orphaned. Removing an entry
 * from this list means building the client that calls it.
 */
const UNREACHABLE_ROUTES: string[] = [
  /*
    Empty, and that is the point of the exactness check below rather than a claim anybody made.

    `studio/upload` was the last entry. It was unreachable for two compounding reasons: no composer
    control called it, and `storeAsset` wrote bytes to a per-instance serverless disk that was
    discarded with the instance — so wiring it up first would have produced uploads that vanished
    silently. Both are fixed: the bytes go to Walrus, and `StudioComposer.attachMedia` is the
    caller. The read side was always wired, which is why the gallery would render an image nobody
    could ever put there.

    A new entry here is a new gap. Adding one is a decision to ship something nothing can reach.
  */
];

describe('every API route has a caller', () => {
  const routes = walk('app/api')
    .filter((f) => f.endsWith('/route.ts'))
    .map((f) => f.replace('app/api/', '').replace('/route.ts', ''));

  it('finds the routes at all, so a broken glob cannot pass silently', () => {
    expect(routes.length).toBeGreaterThan(30);
  });

  const unreachable = routes.filter((route) => {
    /*
      Dynamic segments are matched on the static prefix. A caller writes
      `/api/media/${postId}/${assetId}`, which shares no literal with `media/[postId]/[assetId]`
      beyond `api/media/` — matching the whole path would report every dynamic route as dead.
    */
    const stem = route.split('/[')[0] ?? route;
    const needle = `api/${stem}`;
    return !sources.some(
      ({ file, text }) => !file.startsWith('app/api/') && text.includes(needle),
    );
  });

  it('has no unreachable route that is not already known', () => {
    const surprises = unreachable.filter((r) => !UNREACHABLE_ROUTES.includes(r));
    expect(surprises).toEqual([]);
  });

  it('has no known-unreachable route that has since been wired up', () => {
    // Exact, not a floor. A list that only ever grows stops being a guard and becomes a graveyard.
    const fixed = UNREACHABLE_ROUTES.filter((r) => !unreachable.includes(r));
    expect(fixed).toEqual([]);
  });
});

/**
 * Columns the application declares and never writes.
 *
 * `profiles.stake_vault_id` was exactly this: declared, read in three places, written by nothing,
 * and populated for zero rows in production while a feature quietly depended on it. A column that
 * is never written is either a missing write or a column that should not exist.
 */
describe('every database column is written by something', () => {
  const schema = readdirSync(join(web, 'db'))
    .filter((f) => f.endsWith('.sql'))
    .map((f) => readFileSync(join(web, 'db', f), 'utf8'))
    .join('\n');

  const libText = sources
    .filter(({ file }) => file.startsWith('lib/'))
    .map(({ text }) => text)
    .join('\n');

  /** Columns declared across every `CREATE TABLE`, minus ones dropped by a later migration. */
  const declared = new Set<string>();
  for (const block of schema.matchAll(/CREATE TABLE IF NOT EXISTS \w+ \(([\s\S]*?)\n\);/g)) {
    for (const line of (block[1] ?? '').split('\n')) {
      const name = line.trim().match(/^([a-z_]+)\s+(text|bigint|boolean|integer|bytea|bigserial)/);
      if (name?.[1] !== undefined) declared.add(name[1]);
    }
  }
  for (const dropped of schema.matchAll(/DROP COLUMN IF EXISTS (\w+)/g)) {
    declared.delete(dropped[1] ?? '');
  }

  /*
    Columns written only by SQL inside the application, never by a name in TypeScript. `id` and the
    timestamps are set by literals in statements rather than carried as fields, so requiring them to
    appear as identifiers would flag every table.
  */
  const WRITTEN_BY_SQL_ONLY = ['id', 'created_at_ms', 'registered_at_ms'];

  it('finds the schema at all', () => {
    expect(declared.size).toBeGreaterThan(10);
  });

  it('writes every column it declares', () => {
    const orphans = [...declared]
      .filter((c) => !WRITTEN_BY_SQL_ONLY.includes(c))
      .filter((c) => !libText.includes(c));
    expect(orphans).toEqual([]);
  });
});
