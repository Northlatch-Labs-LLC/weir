// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { fingerprintSrc, STAMP_FILE } from './sdk-src-fingerprint.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const sdkDir = join(repoRoot, 'packages', 'sdk');

export default function ensureSdkBuiltFromSource() {
  const expected = fingerprintSrc(sdkDir);
  if (expected === null) return;

  let recorded = null;
  try {
    recorded = readFileSync(join(sdkDir, STAMP_FILE), 'utf8').trim();
  } catch {
    // Missing, unreadable, never written, or wiped with `dist`. All mean the same thing: we cannot
    // show what `dist` was built from, so we do not get to assume it was this.
  }

  if (recorded === expected) return;

  process.stderr.write(
    recorded === null
      ? '[sdk-freshness] packages/sdk/dist carries no record of what it was built from — building it before the tests run.\n'
      : '[sdk-freshness] packages/sdk/dist was built from different sources than are on disk — rebuilding before the tests run.\n',
  );

  execFileSync('pnpm', ['--filter', '@projectx-social/sdk', 'build'], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
}
