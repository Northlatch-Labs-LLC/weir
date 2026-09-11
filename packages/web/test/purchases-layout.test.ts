// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
const decoder = readFileSync(join(import.meta.dirname, '../lib/purchases.ts'), 'utf8');

function declared(name: string): string[] {
  const block = new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\] as const;`).exec(decoder)?.[1];
  expect(block, `${name} was renamed or removed from lib/purchases.ts`).toBeDefined();
  return [...block!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
}

const SUBSCRIPTION_BCS_FIELDS = declared('SUBSCRIPTION_BCS_FIELDS');
const UNLOCK_BCS_FIELDS = declared('UNLOCK_BCS_FIELDS');

const source = readFileSync(
  join(import.meta.dirname, '../../../sui-contracts/sources/entitlement.move'),
  'utf8',
);

function bodyOf(struct: string): string {
  const body = new RegExp(`public struct ${struct} has key \\{([\\s\\S]*?)\\n\\}`).exec(source)?.[1];
  expect(body, `could not find \`public struct ${struct}\` — renamed or reshaped`).toBeDefined();
  return body!;
}

function fieldsOf(struct: string): string[] {
  return [...bodyOf(struct).matchAll(/^\s{4}([a-z_][a-z0-9_]*)\s*:/gm)].map((m) => m[1]!);
}

function typeOfField(struct: string, field: string): string | undefined {
  return new RegExp(`^\\s{4}${field}:\\s*(.+?),`, 'm').exec(bodyOf(struct))?.[1];
}

describe('Subscription', () => {
  it('declares the same fields in the same order', () => {
    expect(fieldsOf('Subscription')).toEqual([...SUBSCRIPTION_BCS_FIELDS]);
  });

  it('still records the price actually paid, as a u64', () => {
    expect(typeOfField('Subscription', 'price_paid')).toBe('u64');
  });

  it('is still soulbound — key without store', () => {
    expect(source).toMatch(/public struct Subscription has key \{/);
    expect(source).not.toMatch(/public struct Subscription has key, store/);
  });
});

describe('Unlock', () => {
  it('declares the same fields in the same order', () => {
    expect(fieldsOf('Unlock')).toEqual([...UNLOCK_BCS_FIELDS]);
  });

  it('keeps the content key an opaque byte vector', () => {
    expect(typeOfField('Unlock', 'content_key')).toBe('vector<u8>');
  });

  it('still records the price paid, as a u64', () => {
    expect(typeOfField('Unlock', 'price_paid')).toBe('u64');
  });

  it('is still soulbound', () => {
    expect(source).toMatch(/public struct Unlock has key \{/);
    expect(source).not.toMatch(/public struct Unlock has key, store/);
  });
});
