// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

function code(path: string): string {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ');
}

const LIB = join(process.cwd(), 'lib');
const files = readdirSync(LIB)
  .filter((n) => n.endsWith('.ts'))
  .map((n) => join(LIB, n));

describe('a simulation status is read in one place', () => {
  it('finds library files to check, so an empty walk cannot pass', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('finds files that actually simulate, so the rule has subjects', () => {
    const simulating = files.filter((f) => /simulateTransaction\s*\(/.test(code(f)));
    expect(simulating.length).toBeGreaterThan(0);
  });

  it('has no hand-rolled status read left anywhere in lib', () => {
    const offenders = files.filter((f) => /\?\.effects\?\.status\s*\?\?/.test(code(f)));
    expect(offenders.map((f) => f.replace(process.cwd(), ''))).toEqual([]);
  });

  it('never reads the gRPC effects.status path, which is always undefined', () => {
    const offenders = files.filter((f) => /Transaction\?\.effects\?\.status/.test(code(f)));
    expect(offenders.map((f) => f.replace(process.cwd(), ''))).toEqual([]);
  });

  it('every file that simulates imports the decoder rather than writing its own', () => {
    const unimported = files.filter((f) => {
      const source = code(f);
      return /simulateTransaction\s*\(/.test(source) && !/simulationStatus/.test(source);
    });
    expect(unimported.map((f) => f.replace(process.cwd(), ''))).toEqual([]);
  });
});
