// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { KEY_BYTES, KEY_REGISTRY_BCS_FIELDS, PUBLISHED_KEY_BCS_FIELDS } from '../src/keyregistry.js';

const SOURCES = resolve(dirname(fileURLToPath(import.meta.url)), '../../../sui-contracts/sources');
const source = readFileSync(resolve(SOURCES, 'key_registry.move'), 'utf8');

const code = source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/^\s*\/\/\/.*$/gm, '');

describe('KeyRegistry BCS layout', () => {
  it('declares the same fields in the same order', () => {
    const body = /public struct KeyRegistry has key \{([\s\S]*?)\n\}/.exec(source)?.[1];
    expect(body, 'could not find `public struct KeyRegistry` — renamed or reshaped').toBeDefined();

    const fields = [...body!.matchAll(/^\s{4}([a-z_][a-z0-9_]*)\s*:/gm)].map((m) => m[1]!);
    expect(fields).toEqual([...KEY_REGISTRY_BCS_FIELDS]);
  });

  it('still stores the keys in a Table, not inline', () => {
    expect(source).toMatch(/keys:\s*Table<address, PublishedKey>/);
  });
});

describe('PublishedKey BCS layout', () => {
  it('declares the same fields in the same order', () => {
    const body = /public struct PublishedKey has copy, drop, store \{([\s\S]*?)\n\}/.exec(source)?.[1];
    expect(body, 'could not find `public struct PublishedKey`').toBeDefined();

    const fields = [...body!.matchAll(/^\s{4}([a-z_][a-z0-9_]*)\s*:/gm)].map((m) => m[1]!);
    expect(fields).toEqual([...PUBLISHED_KEY_BCS_FIELDS]);
  });

  it('the key is still a byte vector', () => {
    expect(source).toMatch(/x25519_public:\s*vector<u8>/);
  });
});

describe('the contract rules the client relies on', () => {
  it('still requires exactly the key length the client checks', () => {
    const declared = /const KEY_BYTES: u64 = (\d+);/.exec(source)?.[1];
    expect(declared, 'KEY_BYTES was renamed or removed').toBeDefined();
    expect(Number(declared)).toBe(KEY_BYTES);
    expect(source).toContain('assert!(x25519_public.length() == KEY_BYTES, EKeyLength);');
  });

  it('still rejects the all-zero key', () => {
    expect(source).toContain('assert!(any_nonzero, EKeyDegenerate);');
  });

  it('publish takes no address — the sender is the only subject', () => {
    const signature = /public fun publish\(([\s\S]*?)\)\s*\{/.exec(source)?.[1];
    expect(signature, 'could not find `public fun publish`').toBeDefined();
    expect(signature).not.toMatch(/:\s*address/);
    expect(source).toContain('let owner = ctx.sender();');
  });

  it('has no administrative override', () => {
    expect(code).not.toMatch(/Cap\b/);
  });

  it('does not consult the platform, so a pause cannot stop key publication', () => {
    expect(code).not.toContain('platform::');
    expect(code).not.toContain('Platform');
  });
});
