
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
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
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tarball-dirty-'));
  const scratchFile = path.join(REPO_ROOT, 'packages', 'agent-runtime', '.tarball-test-scratch');
  try {
    execFileSync('sh', ['-c', `echo scratch > ${JSON.stringify(scratchFile)}`]);
    const result = spawnSync(SCRIPT, [], { encoding: 'utf8', cwd: PKG_DIR });
    assert.notEqual(result.status, 0, 'a dirty tree under packages/agent-runtime must refuse the build');
    assert.match(result.stderr, /refused/);
  } finally {
    rmSync(scratchFile, { force: true });
    rmSync(dir, { recursive: true, force: true });
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
