// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  handleProblem,
  MAX_HANDLE_LEN,
  MIN_HANDLE_LEN,
  REGISTRY_BCS_FIELDS,
} from '../src/accounts.js';

const SOURCES = resolve(dirname(fileURLToPath(import.meta.url)), '../../../sui-contracts/sources');
const source = readFileSync(resolve(SOURCES, 'account.move'), 'utf8');

describe('Registry BCS layout', () => {
  it('declares the same fields in the same order', () => {
    const body = /public struct Registry has key \{([\s\S]*?)\n\}/.exec(source)?.[1];
    expect(body, 'could not find `public struct Registry` — renamed or reshaped').toBeDefined();

    const fields = [...body!.matchAll(/^\s{4}([a-z_][a-z0-9_]*)\s*:/gm)].map((m) => m[1]!);
    expect(fields).toEqual([...REGISTRY_BCS_FIELDS]);
  });

  it('keeps the two tables keyed the way each lookup derives', () => {
    expect(source).toMatch(/by_handle:\s*Table<String, address>/);
    expect(source).toMatch(/by_address:\s*Table<address, String>/);
  });
});

describe('handle rules mirrored from the contract', () => {
  it('uses the same length bounds', () => {
    const min = /const MIN_HANDLE_LEN: u64 = (\d+);/.exec(source)?.[1];
    const max = /const MAX_HANDLE_LEN: u64 = (\d+);/.exec(source)?.[1];
    expect(min, 'MIN_HANDLE_LEN was renamed or removed').toBeDefined();
    expect(max, 'MAX_HANDLE_LEN was renamed or removed').toBeDefined();
    expect(Number(min)).toBe(MIN_HANDLE_LEN);
    expect(Number(max)).toBe(MAX_HANDLE_LEN);
  });

  it('uses the same charset', () => {
    expect(source).toContain('(b >= 0x61 && b <= 0x7A)');
    expect(source).toContain('(b >= 0x30 && b <= 0x39)');
    expect(source).toContain('b == 0x5F');
  });

  it('still rejects rather than normalises', () => {
    expect(source).toContain('assert!(ok, EHandleCharset);');
    expect(source).not.toMatch(/to_lowercase|to_ascii_lower/);
  });
});

describe('handleProblem', () => {
  it('accepts a plain handle', () => {
    expect(handleProblem('projectx')).toBeNull();
    expect(handleProblem('a_1')).toBeNull();
  });

  it('rejects one byte under and accepts the minimum', () => {
    expect(handleProblem('ab')).toEqual({ kind: 'too-short', min: 3 });
    expect(handleProblem('abc')).toBeNull();
  });

  it('accepts the maximum and rejects one byte over', () => {
    expect(handleProblem('a'.repeat(30))).toBeNull();
    expect(handleProblem('a'.repeat(31))).toEqual({ kind: 'too-long', max: 30 });
  });

  it('rejects uppercase rather than folding it', () => {
    expect(handleProblem('ProjectX')).toEqual({ kind: 'bad-character', character: 'P' });
  });

  it('rejects punctuation, spaces and hyphens', () => {
    for (const handle of ['a.b', 'a b', 'a-b', 'a@b']) {
      expect(handleProblem(handle)).not.toBeNull();
    }
  });

  it('rejects a handle that is short in characters but long in bytes', () => {
    expect(handleProblem('日本語')).toEqual({ kind: 'bad-character', character: '日' });
    expect(new TextEncoder().encode('日本語').length).toBe(9);
  });

  it('rejects an emoji', () => {
    expect(handleProblem('ab🔐')).toEqual({ kind: 'bad-character', character: '🔐' });
  });

  it('rejects the empty handle as too short, not as a bad character', () => {
    expect(handleProblem('')).toEqual({ kind: 'too-short', min: 3 });
  });
});
