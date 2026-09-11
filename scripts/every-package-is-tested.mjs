// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PACKAGES = join(ROOT, 'packages');

const EXEMPT = new Map([]);

const missing = [];
for (const entry of readdirSync(PACKAGES)) {
  const manifest = join(PACKAGES, entry, 'package.json');
  try {
    if (!statSync(manifest).isFile()) continue;
  } catch {
    continue;
  }
  const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
  const hasTest = typeof pkg.scripts?.test === 'string' && pkg.scripts.test.trim() !== '';
  if (!hasTest && !EXEMPT.has(entry)) missing.push(entry);
}

if (missing.length > 0) {
  console.error('every-package-is-tested: these packages declare no test script:\n');
  for (const name of missing) console.error(`  packages/${name}`);
  console.error(
    '\n`pnpm -r test` runs the packages that have one and says nothing about the rest, so a run\n' +
      'covering the others is reported exactly like a run covering all of them.\n\n' +
      'Give it a test script, or add it to EXEMPT in this file with the reason. Both are decisions.\n' +
      'An absent script is not.',
  );
  process.exit(1);
}

console.log(`every-package-is-tested: OK (${readdirSync(PACKAGES).length} packages, none silent)`);
