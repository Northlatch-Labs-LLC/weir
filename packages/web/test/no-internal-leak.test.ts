// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const LIB = join(process.cwd(), 'lib');

function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

const RAW = /error instanceof Error \? error\.message : String\(error\)/;

const ALLOWED: Readonly<Record<string, string>> = {
  'opaque.ts': 'the helper itself: it reads the message in order to log it and withhold it',
  'zklogin.ts': 'runs in the browser, where there is no server log to send it to and no schema to leak',
  'waitlist-admin.ts': 'writes it to stderr rather than to a response — the log is the intended reader',
};

describe('a caught error does not become a response', () => {
  const files = readdirSync(LIB).filter((f) => f.endsWith('.ts'));

  it('finds the library at all', () => {
    expect(files.length).toBeGreaterThan(40);
  });

  it.each(files)('lib/%s', (file) => {
    const code = codeOf(readFileSync(join(LIB, file), 'utf8'));
    const carriesRaw = RAW.test(code);
    const why = ALLOWED[file];

    if (why !== undefined) {
      expect(carriesRaw, `lib/${file} is allowed to carry raw error text but no longer does`).toBe(
        true,
      );
      return;
    }

    expect(
      carriesRaw,
      `lib/${file} puts a caught error's own message into a Reading. Use opaqueDetail(source, error), ` +
        'or add the file to ALLOWED with the reason it needs the raw text.',
    ).toBe(false);
  });
});

describe('the helper withholds and logs', () => {
  it('does not return the underlying message', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { opaqueDetail } = await import('../lib/opaque');

    const detail = opaqueDetail('reading a vault', new Error('relation "posts" does not exist'));

    expect(detail).not.toContain('relation');
    expect(detail).not.toContain('posts');
    expect(detail).toContain('reading a vault');
    err.mockRestore();
  });

  it('puts the underlying message where an operator will find it', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { opaqueDetail } = await import('../lib/opaque');

    opaqueDetail('reading a vault', new Error('relation "posts" does not exist'));

    const logged = err.mock.calls.map((c) => JSON.parse(String(c[0])) as Record<string, string>);
    expect(logged.some((line) => line['detail'] === 'relation "posts" does not exist')).toBe(true);
    expect(logged.some((line) => line['failure'] === 'reading a vault')).toBe(true);
    err.mockRestore();
  });

  it('survives something that is not an Error', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { opaqueDetail } = await import('../lib/opaque');

    expect(() => opaqueDetail('x', 'a bare string')).not.toThrow();
    err.mockRestore();
  });
});
