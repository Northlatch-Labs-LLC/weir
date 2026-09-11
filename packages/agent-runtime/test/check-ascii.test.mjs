
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHECK_ASCII = path.join(__dirname, '..', 'scripts', 'check-ascii.py');

function runCheck(filePath) {
  return spawnSync('python3', [CHECK_ASCII, filePath], { encoding: 'utf8' });
}

test('a file carrying the v1 byte (0x80) fails the check', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'check-ascii-'));
  try {
    const fixture = path.join(dir, 'bad.yaml');
    const bytes = Buffer.concat([
      Buffer.from('#cloud-config\n# a comment with a stray byte: '),
      Buffer.from([0x80]),
      Buffer.from('\npackage_update: true\n'),
    ]);
    writeFileSync(fixture, bytes);

    const result = runCheck(fixture);
    assert.notEqual(result.status, 0, 'check-ascii.py must exit non-zero on a 0x80 byte');
    assert.match(result.stderr, /0x80/);
    assert.match(result.stderr, /offset 45/);
    assert.match(result.stderr, /line 2/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a clean ASCII file passes the check', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'check-ascii-'));
  try {
    const fixture = path.join(dir, 'good.yaml');
    writeFileSync(fixture, '#cloud-config\n# a plain ASCII comment\npackage_update: true\n', 'utf8');

    const result = runCheck(fixture);
    assert.equal(result.status, 0, `expected exit 0, got ${result.status}: ${result.stderr}`);
    assert.equal(result.stderr, '');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a missing file is a usage-style refusal, not a false pass', () => {
  const result = runCheck('/nonexistent/path/does-not-exist.yaml');
  assert.notEqual(result.status, 0);
});
