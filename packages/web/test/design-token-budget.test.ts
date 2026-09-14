// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
/**
 * The design-token budget.
 *
 * This test reads source because the alternative — no guard — already failed: the `style={` count
 * under `components/` rose by 16 and the `style={` count under `app/` rose by 15 in two days, in
 * commits that were not about styling. A count nobody measures is a count nobody lowers.
 *
 * Every number below was measured on the day the last design-token fallbacks were deleted. Each is
 * a ceiling: lower it when the real count falls, never raise it.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const web = process.cwd();

function skip(name: string): boolean {
  return (
    name === 'node_modules' ||
    name === '.next' ||
    name === '.vercel' ||
    name.startsWith('.next-')
  );
}

function walk(dir: string, file: RegExp, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (skip(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, file, out);
    else if (file.test(name)) out.push(full);
  }
  return out;
}

function count(files: string[], pattern: RegExp): number {
  return files.reduce((n, f) => n + (readFileSync(f, 'utf8').match(pattern) ?? []).length, 0);
}

const WHY = 'this number may only be lowered, never raised. A token needs no fallback: if one is missing, add it to packages/ui/src/theme/weir-ui.css instead.';

function ratchet(what: string, measured: number, budget: number): void {
  expect(
    measured,
    `${what} rose by ${measured - budget} to ${measured}; the budget is ${budget}, and ${WHY}`,
  ).toBeLessThanOrEqual(budget);
}

function none(what: string, measured: number): void {
  expect(measured, `${what} is ${measured}, not 0 — ${WHY}`).toBe(0);
}

describe('the design-token budget', () => {
  const components = walk(resolve(web, 'components'), /\.tsx$/);
  const app = walk(resolve(web, 'app'), /\.tsx$/);
  const ui = walk(resolve(web, '..', 'ui', 'src'), /\.tsx$/);
  const stylesheets = [resolve(web, 'app', 'weir.css'), resolve(web, 'app', 'globals.css')];

  it('found the source it measures', () => {
    expect(components.length).toBeGreaterThan(50);
    expect(app.length).toBeGreaterThan(20);
    expect(ui.length).toBeGreaterThan(0);
  });

  it('inline styles under components/ stay at or under 478', () => {
    ratchet('style={} in components/**/*.tsx', count(components, /style=\{/g), 478);
  });

  it('inline styles under app/ stay at or under 73', () => {
    ratchet('style={} in app/**/*.tsx', count(app, /style=\{/g), 73);
  });

  it('token fallbacks to a hex in the stylesheets stay at or under 64', () => {
    ratchet(
      'var(--name, #hex) in app/weir.css + app/globals.css',
      count(stylesheets, /var\(--[a-z0-9-]+,\s*#/g),
      64,
    );
  });

  it('no .tsx in app/, components/ or ../ui/src carries a token fallback to a hex', () => {
    none(
      'var(--name, #hex) in app/**, components/** and ../ui/src/**',
      count([...app, ...components, ...ui], /var\(--[a-z0-9-]+,\s*#/g),
    );
  });

  it('components/ carries no hex colour at all', () => {
    none('#rrggbb in components/**/*.tsx', count(components, /#[0-9a-fA-F]{6}/g));
  });
});
