// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
//
// Rebuild `packages/sdk/dist` when it is older than `packages/sdk/src`, before any test runs.
//
// # Why this exists as a vitest globalSetup rather than a package script
//
// `packages/sdk/dist` is gitignored, so it holds whatever was last compiled ON THIS MACHINE and it
// does NOT change when you switch branches. Testing against a stale one produces results for a
// mixture of two commits. The symptom is the dangerous part: a correct implementation fails with a
// plausible assertion error, which reads exactly like a real defect. That happened four times on
// one machine on 2026-09-01, three of them to the person who had written the warning about it.
//
// The root `test` script builds the SDK first, which covers `pnpm test`. It does not cover
// `npx vitest run` inside a single package — and running one package's tests directly is the
// ordinary thing to do while working on that package. A globalSetup is reached by BOTH paths,
// because vitest loads it from the config no matter how vitest was invoked.
//
// # Why mtime is sufficient here, given that mtime is usually a poor signal
//
// The failure mode is specifically a branch switch. Git writes the files it changes, so their
// mtimes move to the checkout time and land ahead of `dist`. If a branch switch does NOT touch
// the SDK's sources, their mtimes do not move, `dist` is still built from those exact bytes, and
// nothing needs to happen — which is the same conclusion a content hash would reach, without a
// hash of every file on every run.
//
// In CI the build has already run in an earlier step, so `dist` is newer and this is a no-op.
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const sdk = join(repoRoot, 'packages', 'sdk');

/** Newest mtime under `dir`, or null when the directory does not exist. */
function newestMtimeMs(dir) {
  if (!existsSync(dir)) return null;
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    const t = statSync(join(entry.parentPath ?? entry.path, entry.name)).mtimeMs;
    if (t > newest) newest = t;
  }
  return newest;
}

export default function assertSdkFresh() {
  const src = newestMtimeMs(join(sdk, 'src'));
  if (src === null) return; // Not a checkout that carries the SDK; nothing to guarantee.

  const dist = newestMtimeMs(join(sdk, 'dist'));
  if (dist !== null && dist >= src) return;

  // Say it out loud. A silent rebuild would hide the very confusion this exists to end: the next
  // person to hit a stale-dist failure should see that the guard is what saved them.
  process.stderr.write(
    dist === null
      ? '[sdk-freshness] packages/sdk/dist is missing — building it before the tests run.\n'
      : '[sdk-freshness] packages/sdk/src is newer than dist — rebuilding before the tests run.\n',
  );

  execFileSync('pnpm', ['--filter', '@projectx-social/sdk', 'build'], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
}
