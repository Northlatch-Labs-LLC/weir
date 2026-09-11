// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const API = join(process.cwd(), 'app', 'api');

function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

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
    const get = code.indexOf('export async function GET');
    const post = code.indexOf('export async function POST');
    const firstLimit = code.indexOf('rateLimit(');
    expect(get).toBeGreaterThan(-1);
    expect(firstLimit).toBeGreaterThan(get);
    expect(firstLimit).toBeLessThan(post === -1 ? Number.MAX_SAFE_INTEGER : post);
  });

  it('refuses a handle that is not handle-shaped before querying', () => {
    expect(code).toMatch(/handle\.length\s*>\s*MAX_HANDLE_LEN/);
  });
});

describe('the simulate class goes through the durable ceiling', () => {
  const all = routeFiles().map((relative) => ({
    relative,
    code: codeOf(readFileSync(join(API, relative), 'utf8')),
  }));

  it('found the routes, so an empty result cannot pass as a clean one', () => {
    expect(all.length).toBeGreaterThan(30);
  });

  it('no route reaches the per-process limiter for this budget', () => {
    const direct = all
      .filter(({ code }) => /\brateLimit\(\s*\w+\s*,\s*'simulate'\s*\)/.test(code))
      .map(({ relative }) => relative);

    expect(direct).toEqual([]);
  });

  it('the durable guard is actually wired, in the numbers this class has', () => {
    const wired = all.filter(({ code }) => /\bsimulateLimit\s*\(/.test(code));

    expect(wired.length).toBeGreaterThanOrEqual(20);
  });
});
