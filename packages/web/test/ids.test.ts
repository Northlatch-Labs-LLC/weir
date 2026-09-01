// @vitest-environment node
// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
//
// Row identifiers were the clock in base 36 and nothing else.
//
// Two writes in the same millisecond produced the same id. The only thing that noticed was the
// primary key: the second insert raised, the route did not catch it, and the caller got a 500.
// `db/011` records the same fact from the other side — "only a same-millisecond collision was
// stopped, and that by the primary key rather than by design".
//
// A millisecond is a long time on a server. Two people commenting on one post, a client retrying,
// or two instances serving concurrent requests all land inside one.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { newId } from '../lib/ids';

const API = join(process.cwd(), 'app', 'api');

function routeFiles(dir = API, prefix = ''): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...routeFiles(full, `${prefix}${entry}/`));
    else if (entry === 'route.ts') found.push(`${prefix}${entry}`);
  }
  return found;
}

describe('an id cannot collide', () => {
  it('is unique across a burst inside one millisecond', () => {
    /*
      The defect, reproduced as the test. Generating in a tight loop keeps `Date.now()` fixed for
      most of it, which is exactly the condition the old scheme failed under — and it failed by
      raising a primary key violation at the database rather than here.
    */
    const ids = new Set<string>();
    for (let i = 0; i < 5000; i += 1) ids.add(newId('p'));
    expect(ids.size).toBe(5000);
  });

  it('does not depend on the clock advancing', () => {
    // Same millisecond, two calls, different ids. The clock is a prefix now, not the identity.
    const a = newId('p');
    const b = newId('p');
    expect(a).not.toBe(b);
  });
});

describe('an id cannot be walked', () => {
  it('carries enough randomness that a neighbour cannot be guessed', () => {
    /*
      Guessing an id is not authorisation — entitlement is decided elsewhere and a guessed id opens
      nothing already private. But `GET /api/comments?postId=` and `/api/media/[postId]/[assetId]`
      both take an id from the caller, and an identifier that enumerates the platform's contents
      discloses its shape for no reason.
    */
    const id = newId('p');
    const suffix = id.slice(1 + Date.now().toString(36).length);
    // 9 bytes of base64url is 12 characters. Fewer would mean this test passes while the guard thins.
    expect(suffix.length).toBeGreaterThanOrEqual(12);
    expect(suffix).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('keeps the time prefix, because these ids are a sort tiebreak', () => {
    // `listPosts` orders by (created_at_ms DESC, id DESC); the id is what makes a keyset cursor
    // total. An id with no time component would make page boundaries arbitrary rather than wrong.
    const id = newId('p');
    expect(id.startsWith(`p${Date.now().toString(36).slice(0, 6)}`)).toBe(true);
  });

  it('keeps the prefix it was given', () => {
    expect(newId('c').startsWith('c')).toBe(true);
    expect(newId('m').startsWith('m')).toBe(true);
  });
});

describe('no route still mints an id from the clock alone', () => {
  const routes = routeFiles();

  it('finds the API surface at all', () => {
    // Guards against a vacuous pass over an empty walk.
    expect(routes.length).toBeGreaterThan(30);
  });

  it.each(routes)('%s', (relative) => {
    const code = readFileSync(join(API, relative), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');
    expect(
      code,
      `${relative} builds an id from Date.now() alone. Use newId(prefix) from lib/ids.`,
    ).not.toMatch(/`[a-z]\$\{Date\.now\(\)\.toString\(36\)\}`/);
  });
});
