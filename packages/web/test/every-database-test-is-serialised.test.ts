// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
/**
 * A database-backed test file that is not in the serialised list runs in parallel with the others
 * and erases their rows. The list in `vitest.database-files.ts` is literal, so this test is what
 * keeps it true: it finds every test file that calls `useTestDatabase()` and requires the two sets
 * to be equal — nothing missing, nothing stale.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DATABASE_TEST_FILES } from '../vitest.database-files';

const ROOT = join(import.meta.dirname, '..');

function testFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...testFiles(full));
    else if (/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe('every test that uses the shared database is serialised', () => {
  it('names exactly the files that call useTestDatabase()', () => {
    // A file that IMPORTS the helper and calls it — not one that merely mentions the name, which
    // this file does in its own comments.
    const usesIt = (src: string): boolean => /helpers\/database['"]/.test(src) && /\buseTestDatabase\(\)/.test(src);
    const found = testFiles(join(ROOT, 'test'))
      .filter((f) => usesIt(readFileSync(f, 'utf8')))
      .map((f) => relative(ROOT, f))
      .sort();
    expect(found).toEqual([...DATABASE_TEST_FILES].sort());
  });

  it('is a list of paths that exist, so a renamed file cannot silently leave the project', () => {
    for (const f of DATABASE_TEST_FILES) expect(() => statSync(join(ROOT, f))).not.toThrow();
  });
});
