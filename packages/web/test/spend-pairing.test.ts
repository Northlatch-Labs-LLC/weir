// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

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

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');
}

const routes = routeFiles(API);

describe('the walk itself', () => {
  it('found the routes, so an empty result cannot pass as a clean one', () => {
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

    expect(unpaired.map((path) => path.replace(process.cwd(), ''))).toEqual([]);
  });
});
