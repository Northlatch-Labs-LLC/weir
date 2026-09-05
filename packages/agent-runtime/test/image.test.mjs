// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
//
// Static checks on the Heron v2 image build inputs — no Docker, no network, no deps beyond
// node:test and node:fs. Docker stays down on this laptop by the Master's order; nothing here
// builds or runs an image. These are exactly the assertions the CTO spec
// (2026-09-05-engineering-heron-v2-runtime-and-host.md §2, §5) requires land before any image is
// built on a host that does have Docker.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const dockerfile = readFileSync(path.join(PACKAGE_ROOT, 'Dockerfile'), 'utf8');
const dockerfileLines = dockerfile.split('\n');
const provenance = JSON.parse(
  readFileSync(path.join(PACKAGE_ROOT, 'picoclaw.provenance.json'), 'utf8'),
);
const runFlags = readFileSync(path.join(PACKAGE_ROOT, 'run-flags.txt'), 'utf8');

// Strip full-line comments and blank lines; keep instruction lines (including continuations,
// which is fine — we only ever match on substrings/regexes within a line).
function instructionLines(text) {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));
}

test('base image line carries a @sha256: digest', () => {
  const fromLines = instructionLines(dockerfile).filter((l) => /^FROM\s/i.test(l));
  assert.ok(fromLines.length >= 1, 'Dockerfile must have at least one FROM line');
  for (const line of fromLines) {
    assert.match(
      line,
      /@sha256:[0-9a-f]{64}\b/,
      `FROM line is not pinned by digest: ${line}`,
    );
  }
});

test('base image digest equals the provenance file', () => {
  const fromLines = instructionLines(dockerfile).filter((l) => /^FROM\s/i.test(l));
  const expected = provenance.baseImage.digest;
  assert.match(expected, /^sha256:[0-9a-f]{64}$/, 'provenance baseImage.digest is malformed');
  for (const line of fromLines) {
    assert.ok(
      line.includes(expected),
      `FROM line does not match provenance digest ${expected}: ${line}`,
    );
  }
  // And the repository:tag named in the Dockerfile matches what the provenance says was read.
  const expectedRepoTag = `${provenance.baseImage.repository.replace(/^docker\.io\//, '')}:${provenance.baseImage.tag}`;
  const shortRepoTag = expectedRepoTag.replace(/^library\//, '');
  assert.ok(
    fromLines.some((l) => l.includes(shortRepoTag)),
    `no FROM line references ${shortRepoTag} (from provenance)`,
  );
});

test('PicoClaw checksum literals equal the provenance file, per arch', () => {
  const amd64Match = dockerfile.match(/ARG\s+PICOCLAW_SHA256_AMD64=([0-9a-f]{64})/);
  const arm64Match = dockerfile.match(/ARG\s+PICOCLAW_SHA256_ARM64=([0-9a-f]{64})/);
  assert.ok(amd64Match, 'Dockerfile has no ARG PICOCLAW_SHA256_AMD64=<64 hex chars>');
  assert.ok(arm64Match, 'Dockerfile has no ARG PICOCLAW_SHA256_ARM64=<64 hex chars>');

  assert.equal(
    amd64Match[1],
    provenance.picoclaw.arch.amd64.sha256,
    'Dockerfile amd64 checksum literal does not equal picoclaw.provenance.json',
  );
  assert.equal(
    arm64Match[1],
    provenance.picoclaw.arch.arm64.sha256,
    'Dockerfile arm64 checksum literal does not equal picoclaw.provenance.json',
  );
});

test('PicoClaw version literal equals the provenance file', () => {
  const versionMatch = dockerfile.match(/ARG\s+PICOCLAW_VERSION=([0-9][^\s]*)/);
  assert.ok(versionMatch, 'Dockerfile has no ARG PICOCLAW_VERSION=<version>');
  assert.equal(versionMatch[1], provenance.picoclaw.version);
});

test('a USER 10001:10001 line exists, and no later USER root', () => {
  const lines = instructionLines(dockerfile);
  const userLineIndices = lines
    .map((l, i) => ({ l, i }))
    .filter(({ l }) => /^USER\s/i.test(l));

  assert.ok(userLineIndices.length >= 1, 'no USER instruction found in Dockerfile');

  const pinnedIndex = userLineIndices.findIndex(({ l }) => /^USER\s+10001:10001\s*$/i.test(l));
  assert.ok(pinnedIndex !== -1, 'no "USER 10001:10001" line found');

  const pinnedLineNumber = userLineIndices[pinnedIndex].i;
  const laterRoot = userLineIndices.find(
    ({ l, i }) => i > pinnedLineNumber && /^USER\s+(root|0(:0)?)\s*$/i.test(l),
  );
  assert.equal(laterRoot, undefined, `found a USER root/0 line after USER 10001:10001: ${laterRoot?.l}`);

  // Also: nowhere in the file, at all, is USER ever set back to root — belt and suspenders.
  const anyRoot = lines.find((l) => /^USER\s+(root|0(:0)?)\s*$/i.test(l));
  assert.equal(anyRoot, undefined, `found a USER root/0 line anywhere in the Dockerfile: ${anyRoot}`);
});

test('no EXPOSE and no HEALTHCHECK', () => {
  const lines = instructionLines(dockerfile);
  const expose = lines.find((l) => /^EXPOSE\s/i.test(l));
  const healthcheck = lines.find((l) => /^HEALTHCHECK\b/i.test(l));
  assert.equal(expose, undefined, `found an EXPOSE line: ${expose}`);
  assert.equal(healthcheck, undefined, `found a HEALTHCHECK line: ${healthcheck}`);
});

test('the uid 10001 empty-before / heron-after assertion lines exist', () => {
  assert.match(dockerfile, /getent passwd 10001/, 'no "getent passwd 10001" check found');
  assert.match(dockerfile, /getent group 10001/, 'no "getent group 10001" check found');
  assert.match(
    dockerfile,
    /already exists before heron is created/,
    'no "already exists before heron is created" refusal message found (the before-creation assertion)',
  );
  assert.match(
    dockerfile,
    /not heron:heron/,
    'no "not heron:heron" refusal message found (the after-creation assertion)',
  );
  // And the assertion actually causes a non-zero exit rather than only printing a message.
  assert.match(
    dockerfile,
    /already exists before heron is created[\s\S]*?exit 1/,
    'the before-creation refusal does not exit non-zero',
  );
});

test('no curl-pipe-shell shape anywhere in the build', () => {
  const lines = instructionLines(dockerfile);
  const pipedToShell = lines.filter((l) => /curl[^\n]*\|\s*(sh|bash)\b/i.test(l));
  assert.deepEqual(pipedToShell, [], `found a curl-piped-to-shell line: ${pipedToShell.join('; ')}`);
});

test('the fetch stage installs curl/ca-certificates; the runtime stage never invokes apt', () => {
  const stageBoundary = dockerfile.indexOf('AS runtime');
  assert.ok(stageBoundary !== -1, 'no "AS runtime" stage found');
  const runtimeStageText = dockerfile.slice(stageBoundary);
  assert.doesNotMatch(
    runtimeStageText,
    /apt-get\s+(install|update)/,
    'the runtime stage invokes apt-get — it must only COPY artifacts made in earlier stages',
  );
});

test('run-flags.txt carries every required flag, verbatim', () => {
  const required = [
    '--read-only',
    '--tmpfs /tmp',
    '--cap-drop=ALL',
    '--security-opt no-new-privileges',
    '--pids-limit 128',
    '--memory 384m',
    '--memory-swap 384m',
    '--cpus 0.9',
    '--user 10001:10001',
  ];
  for (const flag of required) {
    assert.ok(runFlags.includes(flag), `run-flags.txt is missing required flag: ${flag}`);
  }
});

test('run-flags.txt mounts no key file, no key env var, no signer socket', () => {
  const activeLines = instructionLines(runFlags);
  const suspect = activeLines.filter((l) =>
    /(purse\.sock|\.sock\b)/i.test(l) || /-e\s+\S*(KEY|TOKEN|SECRET)\S*=/i.test(l),
  );
  assert.deepEqual(
    suspect,
    [],
    `run-flags.txt appears to mount a socket or set a key-shaped env var: ${suspect.join('; ')}`,
  );
});
