// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const LIB = join(process.cwd(), 'lib');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return walk(full);
    return full.endsWith('.ts') || full.endsWith('.tsx') ? [full] : [];
  });
}

const SPECIFIERS = /(?<!\bimport\s+type\s)(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;

describe('lib/ does not import from components/', () => {
  const offenders = walk(LIB).flatMap((file) => {
    const source = readFileSync(file, 'utf8');
    const hits: string[] = [];
    for (const line of source.split('\n')) {
      if (/^\s*(?:\/\/|\*)/.test(line)) continue;
      if (/^\s*import\s+type\s/.test(line)) continue;
      for (const match of line.matchAll(SPECIFIERS)) {
        const spec = match[1];
        if (spec !== undefined && spec.includes('components/')) {
          hits.push(`${file.slice(process.cwd().length + 1)} -> ${spec}`);
        }
      }
    }
    return hits;
  });

  it('has no module under lib/ importing a component', () => {
    expect(offenders).toEqual([]);
  });

  it('would catch the import that took the site down', () => {
    const line = "import { SOCIAL } from '@/components/shell/SiteFooter';";
    expect([...line.matchAll(SPECIFIERS)].some((m) => m[1]?.includes('components/') === true)).toBe(true);
  });

  it('leaves a type-only import alone, because it is erased before it can run', () => {
    const line = "import type { IconName } from '@/components/app/icons';";
    expect(/^\s*import\s+type\s/.test(line)).toBe(true);
  });
});
