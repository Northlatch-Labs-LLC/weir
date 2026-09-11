// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HERE = resolve(fileURLToPath(new URL('.', import.meta.url)));
const PACKAGE_ROOT = resolve(HERE, '..');
const SRC = join(PACKAGE_ROOT, 'src');
const TSC = join(PACKAGE_ROOT, 'node_modules', '.bin', 'tsc');

function runTsc(args: string[], cwd: string): string[] {
  try {
    execFileSync(TSC, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return [];
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string };
    return `${e.stdout ?? ''}${e.stderr ?? ''}`
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '');
  }
}

describe('the compiler rejects an implementation that demands more than the interface promises', () => {
  const OWNED = ['src/index.ts', 'src/tx.ts', 'src/session.ts', 'src/keys.ts', 'src/manifest.ts'];

  const diagnostics = runTsc(['--noEmit'], PACKAGE_ROOT);

  it('reports no error in any file this suite asserts about', () => {
    const mine = diagnostics.filter(
      (line) => OWNED.some((f) => line.startsWith(f)) || line.startsWith('test/'),
    );
    expect(mine).toEqual([]);
  });

  it('reports no UNUSED @ts-expect-error anywhere — the signal that a guard stopped guarding', () => {
    expect(diagnostics.filter((line) => line.includes('TS2578'))).toEqual([]);
  });

  it('proves the difference is the syntax and nothing else', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kaela-variance-'));

    const fixture = (member: string): string => `
      interface Envelope { a: string; b: number }
      interface Consumer { ${member} }
      const demandsMore: Consumer = {
        decrypt: (_x: Envelope & { mustAlsoHave: true }) => 1,
      };
      export default demandsMore;
    `;

    writeFileSync(join(dir, 'property.ts'), fixture('decrypt: (input: Envelope) => number;'));
    writeFileSync(join(dir, 'method.ts'), fixture('decrypt(input: Envelope): number;'));
    writeFileSync(
      join(dir, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: { strict: true, noEmit: true, target: 'ES2023', module: 'preserve' },
      }),
    );

    const errors = runTsc(['--noEmit', '-p', dir], dir);
    const inProperty = errors.filter((line) => line.includes('property.ts'));
    const inMethod = errors.filter((line) => line.includes('method.ts'));

    expect(inProperty.length).toBeGreaterThan(0);
    expect(inProperty.join('\n')).toContain('not assignable');

    expect(inMethod).toEqual([]);
  });
});

describe('no interface in this package declares a member with method syntax', () => {
  function stripComments(source: string): string {
    return source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');
  }

  function methodSyntaxMembersIn(source: string): string[] {
    const clean = stripComments(source);
    const found: string[] = [];
    let depth = 0;
    let inTypeBody = false;
    let bodyDepth = 0;

    for (const raw of clean.split('\n')) {
      const line = raw.trim();

      if (!inTypeBody && /^(export\s+)?(interface\s+\w|type\s+\w[\w<>,\s]*=\s*\{)/.test(line)) {
        inTypeBody = true;
        bodyDepth = depth;
      }

      if (inTypeBody && depth > bodyDepth) {
        if (/^(readonly\s+)?[A-Za-z_$][\w$]*\??\s*(<[^>]*>)?\s*\(/.test(line)) {
          found.push(line);
        }
      }

      for (const ch of raw) {
        if (ch === '{') depth += 1;
        else if (ch === '}') depth -= 1;
      }
      if (inTypeBody && depth <= bodyDepth) inTypeBody = false;
    }
    return found;
  }

  const files = readdirSync(SRC).filter((f) => f.endsWith('.ts'));

  it.each(files)('%s', (file) => {
    const offenders = methodSyntaxMembersIn(readFileSync(join(SRC, file), 'utf8'));
    expect(
      offenders,
      `${file} declares an interface member with METHOD syntax, which TypeScript checks ` +
        `bivariantly even under strictFunctionTypes. Write it as a property function — ` +
        `\`name: (arg: T) => R\` — so an implementation demanding more than the interface ` +
        `promises is refused at compile time. See SealDecryptor in src/index.ts for what this ` +
        `cost the first time.`,
    ).toEqual([]);
  });

  it('the scanner would actually catch one', () => {
    expect(
      methodSyntaxMembersIn('export interface Bad {\n  decrypt(input: X): Promise<Y>;\n}\n'),
    ).toHaveLength(1);
    expect(
      methodSyntaxMembersIn('export interface Good {\n  decrypt: (input: X) => Promise<Y>;\n}\n'),
    ).toEqual([]);
    expect(
      methodSyntaxMembersIn('export class Fine {\n  decrypt(input: X) { return input; }\n}\n'),
    ).toEqual([]);
    expect(
      methodSyntaxMembersIn(
        'export interface Ok {\n  /** never write `decrypt(x): T` */\n  decrypt: (x: X) => T;\n}\n',
      ),
    ).toEqual([]);
  });
});
