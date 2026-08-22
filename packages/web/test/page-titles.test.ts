// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A page's title must not repeat the site's name.
 *
 * `app/layout.tsx` sets `template: '%s · Weir'`, so every page title gets the suffix appended. Three
 * pages carried it themselves as well and rendered "Recovery details · Weir · Weir" in the browser
 * tab and in every link preview — the kind of defect nobody reports because it looks like a typo
 * rather than a bug.
 */
function pages(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) pages(full, out);
    else if (entry === 'page.tsx' || entry === 'layout.tsx') out.push(full);
  }
  return out;
}

describe('page titles', () => {
  const app = resolve(process.cwd(), 'app');
  const files = pages(app).filter((f) => !f.endsWith(`${app}/layout.tsx`));

  it('found the pages at all', () => {
    expect(files.length).toBeGreaterThanOrEqual(20);
  });

  it('leaves the site name to the template', () => {
    const offenders = files.filter((file) => /title: *['"][^'"]*·\s*Weir['"]/.test(readFileSync(file, 'utf8')));
    expect(offenders.map((f) => f.slice(app.length + 1))).toEqual([]);
  });

  it('is the layout that owns the suffix', () => {
    // Guards the guard: with no template, the rule above would be wrong rather than merely unmet.
    expect(readFileSync(resolve(app, 'layout.tsx'), 'utf8')).toContain('template:');
  });
});
