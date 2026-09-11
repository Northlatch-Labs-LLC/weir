// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { DIRECT_SIGNING_PATHS } from '../src/direct-signing-paths';

const REPO = resolve(process.cwd(), '..', '..');
const DOC = readFileSync(join(process.cwd(), 'src', 'policy-signer.ts'), 'utf8');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.git') return [];
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sources(path);
    return entry.endsWith('.ts') && !entry.endsWith('.test.ts') ? [path] : [];
  });
}

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');
}

const bypasses = sources(join(REPO, 'packages'))
  .filter((p) => !p.endsWith(join('signer', 'src', 'policy-signer.ts')))
  .filter((p) => /\bsignAndExecuteTransaction\s*\(/.test(code(p)))
  .map((p) => p.replace(`${REPO}/`, ''));

describe('the walk', () => {
  it('found the workspace sources, so an empty result cannot pass as a clean one', () => {
    expect(sources(join(REPO, 'packages')).length).toBeGreaterThan(50);
  });
});

describe('the register of direct signing paths', () => {
  const declared = DIRECT_SIGNING_PATHS.map((entry) => entry.path).sort();

  it('names every path the walk finds, so a new bypass fails until it is declared', () => {
    for (const path of bypasses) {
      expect(declared, `${path} signs directly and is not in DIRECT_SIGNING_PATHS`).toContain(path);
    }
  });

  it('does not carry an entry the walk cannot see, except the one the walk is known to miss', () => {
    /*
      The walk greps for `signAndExecuteTransaction(` and nothing else. The harvest daemon signs
      through `gate.signTransaction(tx)` and submits separately, so this guard has never detected
      it — it was in the register because somebody wrote it down, not because anything checked.
      Pinned rather than fixed: widening the pattern changes what this guard covers, and that is a
      decision about money paths, not a consequence of tidying a comment.
    */
    const undetected = declared.filter((path) => !bypasses.includes(path));
    expect(undetected).toEqual(['packages/daemon/src/adapters/signer.ts']);
  });

  it('is describing a real bypass rather than an empty list', () => {
    expect(bypasses.length).toBeGreaterThan(0);
  });

  it('gives a reason for each, because an undefended exception is one nobody reviewed', () => {
    for (const entry of DIRECT_SIGNING_PATHS) {
      expect(entry.why.trim().length, `${entry.path} has no reason`).toBeGreaterThan(40);
    }
  });

  it('does not claim PolicySigner is the only path to a signature, because it is not', () => {
    expect(DOC.slice(0, 400)).not.toContain('the only path to a transaction signature');
  });

  it('still states what MUST come through it', () => {
    expect(DOC + JSON.stringify(DIRECT_SIGNING_PATHS)).toMatch(
      /capability|spending a budget|another party's funds/,
    );
  });
});
