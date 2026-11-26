// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
//
// Every JSON route reads its body the same way, or says here why not.
//
// `request.json()` throws on a body that is not JSON, and a route that calls it inside its
// function-level `try` has that throw land in a `catch` built for server failures: it writes to
// error_events — the table the hourly alarm reads — and answers 500. Until 2026-11-25 thirty-five
// routes did exactly that, so any anonymous caller could add rows to the alarm's table and lie to
// a well-behaved client about whose mistake the request was.
//
// The fix was one reader (readJsonBody) and a mechanical change to those routes. This is what
// keeps the next route from reintroducing the pattern: a route that parses JSON with anything
// else has to be listed below, and what is listed has to answer a bad body as 400 itself.

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

/*
  Routes that still parse with `request.json()`, each inside its own `try` whose `catch` answers
  400. They never had the defect, so they were left alone rather than rewritten for symmetry. A
  file leaves this list when it takes up readJsonBody; a file should not be added to it.
*/
const READS_INSIDE_ITS_OWN_TRY: string[] = [
  'app/api/access-codes/route.ts',
  'app/api/access-codes/redeem/route.ts',
  'app/api/agents/declare/pending/route.ts',
  'app/api/agents/declare/route.ts',
  'app/api/agents/mind/route.ts',
  'app/api/agents/seeking/offers/route.ts',
  'app/api/agents/seeking/route.ts',
  'app/api/site-mode/route.ts',
];

/** True when the call sits in a `try { … } catch { … 400 … }` the route wrote itself. */
function guarded(lines: string[], at: number): boolean {
  const opensBehind = lines.slice(Math.max(0, at - 3), at).some((line) => /\btry\s*\{\s*$/.test(line));
  if (!opensBehind) return false;
  const closes = lines.slice(at + 1, at + 5).findIndex((line) => /^\s*\}\s*catch\b/.test(line));
  if (closes === -1) return false;
  return lines.slice(at + 2 + closes, at + 5 + closes).some((line) => /400/.test(line));
}

describe('how a route reads a JSON body', () => {
  const routes = walk('app/api').filter((f) => f.endsWith('/route.ts'));
  const direct = new Map<string, number[]>();

  for (const route of routes) {
    const lines = readFileSync(join(web, route), 'utf8').split('\n');
    const at = lines.flatMap((line, i) => (line.includes('request.json(') ? [i] : []));
    if (at.length > 0) direct.set(route, at);
  }

  it('finds the routes at all, so a broken glob cannot pass silently', () => {
    expect(routes.length).toBeGreaterThan(70);
    expect(routes.filter((r) => readFileSync(join(web, r), 'utf8').includes('readJsonBody(')).length).toBeGreaterThanOrEqual(35);
  });

  it('leaves no route parsing JSON with anything but the shared reader, beyond those listed', () => {
    const surprises = [...direct.keys()].filter((route) => !READS_INSIDE_ITS_OWN_TRY.includes(route));
    expect(surprises).toEqual([]);
  });

  it('finds every listed route, so a fixed one is removed from the list', () => {
    const fixed = READS_INSIDE_ITS_OWN_TRY.filter((route) => !direct.has(route));
    expect(fixed).toEqual([]);
  });

  it('holds the listed routes to answering a bad body as 400 themselves', () => {
    for (const route of READS_INSIDE_ITS_OWN_TRY) {
      const lines = readFileSync(join(web, route), 'utf8').split('\n');
      for (const at of direct.get(route) ?? []) {
        expect(guarded(lines, at), `${route}:${at + 1}`).toBe(true);
      }
    }
  });
});
