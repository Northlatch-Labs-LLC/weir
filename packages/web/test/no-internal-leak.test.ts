// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
//
// A caught error's own text must not become a caller's error message.
//
// Twenty-four of twenty-five routes return `failure.detail` verbatim. That is right for the details
// this codebase writes — "that is not a Sui address", "this signature has expired — sign again" —
// and wrong for the ones a library writes: a `pg` exception names tables, columns and constraints,
// a driver exception names hosts and ports. All of it reached anonymous callers on routes that need
// no account.
//
// Fixed at the source rather than at the exit, because the exit is twenty-four handlers plus every
// one written afterwards by somebody who has not read the note. This asserts the source stays
// closed.
import { describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const LIB = join(process.cwd(), 'lib');

/** Source with comments stripped, so a mention in prose is never mistaken for code. */
function codeOf(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/** The shape that puts a caught error's own words into a value someone else will read. */
const RAW = /error instanceof Error \? error\.message : String\(error\)/;

/*
  Files allowed to carry the raw text, each with the reason.

  An allowlist, because "this one is fine" is a claim that should be written where the next person
  sees it. A file missing from both lists is a mistake, not a decision.
*/
const ALLOWED: Readonly<Record<string, string>> = {
  'opaque.ts': 'the helper itself: it reads the message in order to log it and withhold it',
  'zklogin.ts': 'runs in the browser, where there is no server log to send it to and no schema to leak',
  'waitlist-admin.ts': 'writes it to stderr rather than to a response — the log is the intended reader',
};

describe('a caught error does not become a response', () => {
  const files = readdirSync(LIB).filter((f) => f.endsWith('.ts'));

  it('finds the library at all', () => {
    // Guards against a vacuous pass: an empty walk makes every assertion below hold over nothing.
    expect(files.length).toBeGreaterThan(40);
  });

  it.each(files)('lib/%s', (file) => {
    const code = codeOf(readFileSync(join(LIB, file), 'utf8'));
    const carriesRaw = RAW.test(code);
    const why = ALLOWED[file];

    if (why !== undefined) {
      // An allowance that no longer applies is a note that has become wrong.
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

    // The schema fact is the thing that must not travel.
    expect(detail).not.toContain('relation');
    expect(detail).not.toContain('posts');
    expect(detail).toContain('reading a vault');
    err.mockRestore();
  });

  it('puts the underlying message where an operator will find it', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { opaqueDetail } = await import('../lib/opaque');

    opaqueDetail('reading a vault', new Error('relation "posts" does not exist'));

    /*
      Parsed rather than substring-matched. The log line is JSON, so the message's own quotes arrive
      escaped and a raw `toContain` would fail on a log that is perfectly correct — which is how a
      test comes to assert that something was not logged when it was.
    */
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
