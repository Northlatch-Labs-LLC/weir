// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DIRECT_SIGNING_PATHS, type SigningPathKind } from '../src/direct-signing-paths';

/*
  The register claim, enforced in both directions.

  Every file in the workspace's non-browser source that contains a signing call —
  signTransaction, signAndExecuteTransaction, signPersonalMessage, signTransactionBlock —
  must be named in DIRECT_SIGNING_PATHS with a kind and a reason, and every name in the
  register must still be found by this scan. A new signing path fails the suite until it is
  registered; a register entry whose file stopped signing fails too. Nothing is exempt, not
  even the paths the old guard used to call blind spots.

  Reach and limits, stated: the scan reads syntax, not semantics. It skips test files,
  build output, and the browser bundle — packages/web/components is guarded separately by
  packages/web/test/signing-guard.test.ts, which asserts every signTransaction argument is
  a quote's bytes and every personal-message signer builds an action: statement. A signing
  call hidden behind an injected port (the room's SignerPort) or assembled from a string is
  outside a syntax scan's reach; the register makes a new path visible, it cannot prove
  none exists.
*/

/*
  Anchored to this file's own location, not to process.cwd(). Vitest is invoked from the workspace
  root here, so a cwd-relative root resolved two levels above it and scanned a directory outside the
  repository — the walk then threw ENOENT before a single assertion ran, which reads as a broken
  suite rather than an unguarded signing path. Three levels up from packages/signer/test is the
  repository root wherever the runner happens to be standing.
*/
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.git',
  '.next',
  '.vercel',
  'coverage',
  'test',
  'tests',
  '__tests__',
]);

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.|\.spec\./.test(entry) && !/\.d\.ts$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

const STRINGS = /'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g;
const CALLS =
  /(?:[A-Za-z_$][\w$]*\.)+\s*(signTransaction|signAndExecuteTransaction|signPersonalMessage|signTransactionBlock)\s*\(/g;

function scan(full: string): string[] {
  const code = readFileSync(full, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(STRINGS, '');
  return [...code.matchAll(CALLS)].map((m) => `${String(m[1])} via ${m[0]?.trim() ?? ''}`);
}

const relOf = (full: string) => relative(REPO, full).split('\\').join('/');

const scanned = walk(join(REPO, 'packages'))
  .map((full) => ({ full, rel: relOf(full) }))
  .filter(({ rel }) => !rel.startsWith('packages/web/components/'));

const signing = scanned
  .map(({ full, rel }) => ({ rel, calls: scan(full) }))
  .filter(({ calls }) => calls.length > 0);

const register = new Map(DIRECT_SIGNING_PATHS.map((entry) => [entry.path, entry]));

const unregistered = signing.filter(({ rel }) => !register.has(rel));

const ghosts = DIRECT_SIGNING_PATHS.filter((entry) => {
  const known = scanned.some(({ rel }) => rel === entry.path);
  if (!known) return true;
  return scan(join(REPO, entry.path)).length === 0;
});

const KINDS: SigningPathKind[] = ['gate', 'custody', 'direct', 'through-gate', 'probe', 'wallet', 'tooling'];

describe('the signing-path register matches the scan, both ways', () => {
  it('the scan found its own reach, so a broken walk cannot pass on nothing', () => {
    expect(scanned.length).toBeGreaterThan(50);
    expect(signing.length).toBeGreaterThanOrEqual(10);
    expect(signing.reduce((n, { calls }) => n + calls.length, 0)).toBeGreaterThanOrEqual(20);
  });

  it('every file that signs is registered', () => {
    expect(unregistered).toEqual([]);
  });

  it('every register entry is found by the scan — no exceptions, not even the old blind spots', () => {
    expect(ghosts.map((entry) => entry.path)).toEqual([]);
  });

  it('every entry carries a known kind and a reason that says why', () => {
    const unknownKinds = DIRECT_SIGNING_PATHS.filter((entry) => !KINDS.includes(entry.kind));
    expect(unknownKinds.map((entry) => entry.path)).toEqual([]);
    const thin = DIRECT_SIGNING_PATHS.filter((entry) => entry.why.trim().length <= 40);
    expect(thin.map((entry) => entry.path)).toEqual([]);
  });

  it('exactly one file is the gate', () => {
    const gates = DIRECT_SIGNING_PATHS.filter((entry) => entry.kind === 'gate');
    expect(gates.map((entry) => entry.path)).toEqual(['packages/signer/src/policy-signer.ts']);
  });

  it('the gate does not overclaim: it is not written up as the only path to a signature', () => {
    const doc = readFileSync(join(REPO, 'packages/signer/src/policy-signer.ts'), 'utf8');
    expect(doc).not.toMatch(/only path|only way to a signature|nothing else can (sign|produce a signature)/);
  });

  it('the register still states what must come through the gate', () => {
    expect(JSON.stringify(DIRECT_SIGNING_PATHS)).toMatch(/spending a budget|another party's funds|capability/);
  });
});
