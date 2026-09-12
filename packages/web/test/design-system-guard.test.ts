// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
/**
 * One design system.
 *
 * The prototype under `components/design/` is being retired screen by screen. This guard holds
 * the line at each step: nothing new may reach for that folder, and the counts that measure how
 * far a screen is from the token system may only go down. The ceilings below are the numbers
 * measured on the day a screen moved; lower them when you lower the count, never raise them.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const web = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|css)$/.test(name)) out.push(p);
  }
  return out;
}

const count = (files: string[], re: RegExp): number =>
  files.reduce((n, f) => n + (readFileSync(f, 'utf8').match(re) ?? []).length, 0);

/*
  The four wrappers that still render a prototype screen. Each one leaves this list when its screen
  is rebuilt on `packages/ui`; the list never grows.
*/
const STILL_ON_THE_PROTOTYPE = [
  'components/data/agents-data.tsx',
  'components/data/chests-data.tsx',
  'components/data/security-data.tsx',
  'components/feed/FeedView.tsx',
];

describe('nothing new renders from components/design', () => {
  const importers = [...walk(join(web, 'app')), ...walk(join(web, 'components')), ...walk(join(web, 'lib'))]
    .filter((f) => !f.includes('/components/design/'))
    .filter((f) => /components\/design\//.test(readFileSync(f, 'utf8')))
    .map((f) => relative(web, f))
    .sort();

  it('is imported only by the wrappers that have not moved yet', () => {
    expect(importers).toEqual([...STILL_ON_THE_PROTOTYPE].sort());
  });

  it('is not imported by any route', () => {
    expect(importers.filter((f) => f.startsWith('app/'))).toEqual([]);
  });
});

describe('the doors and their pieces carry no hardcoded design values', () => {
  const moved = [
    'components/app/SigninPanel.tsx',
    'components/app/SigninScreen.tsx',
    'components/app/WaitlistPanel.tsx',
    'components/app/WaitlistScreen.tsx',
    'components/app/AgentRecordView.tsx',
    'components/app/AgentRecordScreen.tsx',
    'components/app/Countdown.tsx',
    'components/app/ExploreFunnel.tsx',
  ].map((f) => join(web, f));

  it('use no inline style, no hex, no token fallback', () => {
    expect(count(moved, /style=\{/g)).toBe(0);
    expect(count(moved, /#[0-9a-fA-F]{3,8}\b/g)).toBe(0);
    expect(count(moved, /var\(--[a-z0-9-]+,\s*#/g)).toBe(0);
  });
});

describe('the counts only go down', () => {
  const app = walk(join(web, 'components', 'app'));
  const shell = walk(join(web, 'components', 'shell'));

  it('inline styles under components/app stay at or under the ceiling', () => {
    expect(count(app, /style=\{/g)).toBeLessThanOrEqual(200);
  });
  it('components/app and components/shell carry no token fallbacks and no hex', () => {
    expect(count([...app, ...shell], /var\(--[a-z0-9-]+,\s*#/g)).toBe(0);
    expect(count([...app, ...shell], /#[0-9a-fA-F]{3,8}\b/g)).toBe(0);
  });
  it('the prototype folder shrinks: at most the seven files batch two owns', () => {
    const left = readdirSync(join(web, 'components', 'design')).filter((f) => /\.tsx?$/.test(f)).sort();
    expect(left).toEqual(['Agents.tsx', 'Chests.tsx', 'Creator.tsx', 'Disclosure.tsx', 'ExploreAgents.tsx', 'Home.tsx', 'Security.tsx']);
  });
});
