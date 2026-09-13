// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
  Two rules the whole client keeps, checked against every file that signs:

  1. Nothing is signed that was not simulated. A `signTransaction(` call signs the bytes a
     simulation answered with, never bytes built in the browser. The argument is `<x>.bytes`
     (a quote), or a parameter named `bytes` that a quote's bytes are passed into.
  2. A personal-message signature is a statement the server can rebuild. A file that calls
     `signPersonalMessage(` builds an `action:` statement in place or imports a builder that does.

  The scan names its own reach, so a broken glob fails instead of passing on nothing.
*/
const web = process.cwd();

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\./.test(entry)) out.push(full);
  }
  return out;
}

const files = walk(join(web, 'components')).map((full) => ({
  file: relative(web, full),
  code: readFileSync(full, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, ''),
}));

const TX_CALL = /signTransaction\(\s*([^)]*?)\s*\)/g;
const SIMULATED_BYTES = /^(?:[A-Za-z_$][\w$]*\.)*bytes$/;
const STATEMENT_BUILDERS = /\b(statementFor|followStatement|setImageStatement)\b/;

describe('nothing is signed that was not simulated', () => {
  const sites = files.flatMap(({ file, code }) =>
    [...code.matchAll(TX_CALL)].map((m) => ({ file, argument: (m[1] ?? '').trim() })),
  );

  it('finds the transaction signatures at all, so a silent scan cannot pass', () => {
    expect(sites.length).toBeGreaterThanOrEqual(10);
  });

  it.each(sites)('$file signs simulated bytes ($argument)', ({ argument }) => {
    expect(argument, 'the argument must be a quote’s bytes, never bytes built here').toMatch(SIMULATED_BYTES);
  });
});

describe('every personal-message signature is a statement the server can rebuild', () => {
  const signers = files.filter(({ code }) => code.includes('signPersonalMessage('));

  it('finds the statement signers at all', () => {
    expect(signers.length).toBeGreaterThanOrEqual(10);
  });

  it.each(signers.map(({ file, code }) => ({ file, code })))(
    '$file builds a statement head or imports a builder',
    ({ code }) => {
      expect(/(?:\\n|[`'"])action: /.test(code) || STATEMENT_BUILDERS.test(code)).toBe(true);
    },
  );
});
