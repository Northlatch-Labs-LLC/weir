
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_DIR = path.join(__dirname, '..');
const SCRIPT = path.join(PKG_DIR, 'scripts', 'make-source-tarball.sh');
const OUT_TGZ = path.join(PKG_DIR, 'agent-runtime-src.tgz');
const OUT_SHA = path.join(PKG_DIR, 'agent-runtime-src.sha');
const REPO_ROOT = execFileSync('git', ['-C', PKG_DIR, 'rev-parse', '--show-toplevel'], {
  encoding: 'utf8',
}).trim();

function runBuild() {
  const result = spawnSync(SCRIPT, [], { encoding: 'utf8', cwd: PKG_DIR });
  assert.equal(result.status, 0, `build failed: ${result.stderr}`);
  return result;
}

function tarEntries(tgzPath) {
  const out = execFileSync('tar', ['-tf', tgzPath], { encoding: 'utf8' });
  return out.split('\n').filter(Boolean);
}

function tarLongListing(tgzPath) {
  return execFileSync('tar', ['-tvf', tgzPath], { encoding: 'utf8' });
}

function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function gitTrackedFiles() {
  const out = execFileSync(
    'git',
    ['-C', REPO_ROOT, 'ls-tree', '-r', '--name-only', 'HEAD', '--', 'packages/agent-runtime'],
    { encoding: 'utf8' },
  );
  return out.split('\n').filter(Boolean);
}

test('git status is clean before the build test runs (precondition, not the subject)', () => {
  const status = execFileSync(
    'git',
    ['-C', REPO_ROOT, 'status', '--porcelain', '--', 'packages/agent-runtime'],
    { encoding: 'utf8' },
  );
  assert.equal(status, '', 'the committed tree must be clean for a meaningful tarball test');
});

test('the tarball entry set equals git ls-tree, exactly (set equality, not a denylist)', () => {
  runBuild();
  const entries = tarLongListing(OUT_TGZ);
  const names = tarEntries(OUT_TGZ);

  const fileNames = names.filter((n) => !n.endsWith('/') && n !== 'SOURCE_COMMIT');
  const tracked = gitTrackedFiles();

  assert.deepEqual(
    new Set(fileNames),
    new Set(tracked),
    'the archived file set must be exactly the committed tree, no more, no fewer',
  );
  assert.equal(fileNames.length, tracked.length, 'no duplicate or collapsed entries');

  for (const name of names) {
    assert.doesNotMatch(name, /(^|\/)\._[^/]*$/, `AppleDouble file leaked into the archive: ${name}`);
    assert.doesNotMatch(name, /(^|\/)\.DS_Store$/, `.DS_Store leaked into the archive: ${name}`);
    assert.doesNotMatch(name, /(^|\/)\.git\//, `.git/ internals leaked into the archive: ${name}`);
  }

  assert.doesNotMatch(entries, /PaxHeader/, 'no synthesized extended-attribute entries expected');
});

test('SOURCE_COMMIT inside the tarball names the shipped commit', () => {
  runBuild();
  const sha = execFileSync('git', ['-C', REPO_ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const inside = execFileSync('tar', ['-xOf', OUT_TGZ, 'SOURCE_COMMIT'], { encoding: 'utf8' }).trim();
  assert.equal(inside, sha);

  assert.ok(existsSync(OUT_SHA), 'sidecar agent-runtime-src.sha must exist');
  assert.equal(readFileSync(OUT_SHA, 'utf8').trim(), sha);
});

test('the refusal fires on a dirty tree, before anything is built', () => {
  /*
    In its own repository, not this one. The refusal is proved by making a tree dirty, and this
    package's other test files run as concurrent processes that shell out to the same script: a
    scratch file dropped in the real tree for the length of one spawn is enough to refuse a build
    those tests are in the middle of, which is how B6 in host-fixes.test.mjs failed in CI for a
    reason that had nothing to do with it. The script reads its repository from its own location,
    so a scratch repository holding a copy of it refuses for exactly the same reason, and nothing
    outside the temporary directory is touched.
  */
  const root = mkdtempSync(path.join(os.tmpdir(), 'tarball-dirty-'));
  try {
    const scripts = path.join(root, 'packages', 'agent-runtime', 'scripts');
    mkdirSync(scripts, { recursive: true });
    const script = path.join(scripts, 'make-source-tarball.sh');
    copyFileSync(SCRIPT, script);
    chmodSync(script, 0o755);

    const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' });
    git('init', '-q');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'test');
    git('add', '-A');
    git('commit', '-qm', 'the script, committed');

    writeFileSync(path.join(root, 'packages', 'agent-runtime', 'uncommitted.txt'), 'scratch\n');
    const result = spawnSync(script, [], { encoding: 'utf8', cwd: path.dirname(scripts) });

    assert.notEqual(result.status, 0, 'a dirty tree under packages/agent-runtime must refuse the build');
    assert.match(result.stderr, /refused/);
    assert.match(result.stderr, /uncommitted.txt/, 'the refusal names what made the tree dirty');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('two builds of the same committed tree are byte-identical', () => {
  runBuild();
  const first = sha256(OUT_TGZ);
  const firstBytes = readFileSync(OUT_TGZ).length;

  runBuild();
  const second = sha256(OUT_TGZ);
  const secondBytes = readFileSync(OUT_TGZ).length;

  assert.equal(first, second, `sha256 mismatch across builds: ${first} vs ${second}`);
  assert.equal(firstBytes, secondBytes);
});
