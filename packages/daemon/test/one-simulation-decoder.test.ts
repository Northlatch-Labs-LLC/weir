// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(process.cwd(), 'src');

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sources(path);
    return entry.endsWith('.ts') ? [path] : [];
  });
}

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');
}

const files = sources(SRC);

describe('the walk', () => {
  it('found the daemon sources, so an empty result cannot pass as a clean one', () => {
    expect(files.length).toBeGreaterThan(5);
  });
});

describe('reading a simulation status', () => {
  it('is not hand-rolled anywhere in this package', () => {
    const handRolled = files.filter((path) => {
      const source = code(path);
      return /FailedTransaction|effects\s*\?\.\s*status|Transaction\s*\?\.\s*status/.test(source);
    });

    expect(handRolled.map((p) => p.replace(process.cwd(), ''))).toEqual([]);
  });

  it('goes through the policy signer, whose gate is the SDK decoder that knows about FailedTransaction', () => {
    const signer = code(join(SRC, 'adapters', 'signer.ts'));
    expect(signer).toMatch(/\bpolicySigner\s*\(/);
    expect(signer).not.toMatch(/simulateTransaction\s*\(/);
  });
});
