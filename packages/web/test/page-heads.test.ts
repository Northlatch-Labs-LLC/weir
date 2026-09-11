// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const APP = resolve(process.cwd(), 'app/(app)');

function routePages(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...routePages(full));
    else if (entry === 'page.tsx') found.push(full);
  }
  return found;
}

const pages = routePages(APP);

const NO_HEAD = ['auth/callback', 'verified'];

describe('every application page names itself', () => {
  it('finds the route group at all', () => {
    expect(pages.length).toBeGreaterThanOrEqual(10);
  });

  for (const page of pages) {
    const relative = page.slice(APP.length + 1).replace(/\/page\.tsx$/, '') || '(index)';
    if (NO_HEAD.some((skip) => relative.startsWith(skip))) continue;

    it(`/${relative} names itself`, () => {
      const source = readFileSync(page, 'utf8');

      if (source.includes('<PageHead')) {
        expect(source).toContain("from '@/components/design/PageHead'");
        return;
      }

      const screen = /from '@\/(components\/app\/[A-Za-z]+)'/.exec(source)?.[1];
      expect(screen, `${relative} mounts neither a PageHead nor a screen from components/app`).toBeDefined();
      const screenSource = readFileSync(resolve(process.cwd(), `${screen}.tsx`), 'utf8');
      expect(screenSource, `${screen} renders no ColumnHeader, so /${relative} has no heading`).toContain('<ColumnHeader');
    });
  }
});

describe('the page head itself', () => {
  const head = readFileSync(resolve(process.cwd(), 'components/design/PageHead.tsx'), 'utf8');

  it('renders a real h1, and lets the shell decide what it looks like', () => {
    expect(head).toMatch(/<h1[\s>]/);
    expect(head).toContain('className="w-phead"');
  });

  it('carries no shell of its own', () => {
    expect(head).not.toContain('<ColumnHeader');
    expect(head).not.toContain('w-rail');
  });

  it('is styled for both shells', () => {
    const sheet = readFileSync(resolve(process.cwd(), '../ui/src/theme/weir-ui.css'), 'utf8');
    expect(sheet).toContain('.w-column .w-phead');
    expect(sheet).toContain('.w-doc .w-phead');
  });

  it('keeps the whole heading, accent included', () => {
    expect(head).toContain('accent === undefined ? title : `${title} ${accent}`');
  });

  it('draws no display hero of its own any more', () => {
    const body = head.slice(head.indexOf('export function PageHead'), head.indexOf('export function PageSection'));
    expect(body).not.toContain('weir-pagehead__title');
    expect(body).not.toContain('weir-grad');
    expect(body).not.toMatch(/fontSize|font-size/);
  });
});
