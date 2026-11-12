// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(join(process.cwd(), 'instrumentation.ts'), 'utf8');

/*
  The per-route sweep closes every handler that was entered. It cannot close an error thrown before
  the handler, or one React throws while a server component streams — Next calls onRequestError for
  exactly those. Without this hook those failures reach a Vercel log and nothing else, which is the
  state the product was in before any of this existed.
*/
describe('failures that never reach a route handler are still recorded', () => {
  it('exports the hook Next calls', () => {
    expect(source).toContain('export async function onRequestError');
  });

  it('records through the same table as the route handlers', () => {
    expect(source).toContain('recordFailure');
    expect(source).toContain("import(\"./lib/error-log\")");
  });

  it('records the route template, not the concrete path', () => {
    expect(source).toContain('context.routePath');
  });

  it('does not write the same failure twice through the patched console', () => {
    const hook = source.slice(source.indexOf('export async function onRequestError'));
    expect(hook).not.toContain('console.error');
  });

  it('stays silent off the node runtime, where there is no database client', () => {
    const hook = source.slice(source.indexOf('export async function onRequestError'));
    expect(hook).toContain("NEXT_RUNTIME'");
    expect(hook).toContain("'nodejs'");
  });
});
