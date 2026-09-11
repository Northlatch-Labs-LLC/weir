// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { describe, expect, it } from 'vitest';
import { canonicalJson, intentHash, parseIntent } from '../src/intent.js';
import { STRANGER, postIntentFor, priceIntentFor } from './helpers.js';

describe('what the schema accepts', () => {
  it('takes the three kinds of the v2 content arm', () => {
    expect(parseIntent(priceIntentFor()).ok).toBe(true);
    expect(parseIntent(postIntentFor()).ok).toBe(true);
    expect(
      parseIntent({
        kind: 'settle_epoch',
        packageId: `0x${'9'.repeat(64)}`,
        ledgerCap: { objectId: `0x${'a'.repeat(64)}`, version: '2', digest: '11111111111111111111111111111111' },
        registry: { objectId: `0x${'b'.repeat(64)}`, initialSharedVersion: '1', mutable: true },
        soul: { objectId: `0x${'c'.repeat(64)}`, initialSharedVersion: '1', mutable: true },
        clock: { objectId: '0x6', initialSharedVersion: '1', mutable: false },
        vaultSui: '5000000000',
        epochNetNonneg: true,
      }).ok,
    ).toBe(true);
  });
});

describe('what the schema refuses', () => {
  it('has no buy, no subscribe and no transfer', () => {
    for (const kind of ['buy', 'subscribe', 'transfer', 'unlock', 'claim_earnings', 'send']) {
      const parsed = parseIntent({ kind, to: STRANGER, amount: '1' });
      expect(parsed.ok).toBe(false);
    }
  });

  it('refuses an unknown key rather than ignoring it', () => {
    const parsed = parseIntent({ ...priceIntentFor(), recipient: STRANGER });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error('unreachable');
    expect(parsed.reason).toContain('recipient');
  });

  it('refuses a bare object id where a resolved reference is required', () => {
    const bare = { ...priceIntentFor(), vault: `0x${'1'.repeat(64)}` };
    expect(parseIntent(bare).ok).toBe(false);
  });

  it('refuses a price of zero, which on this protocol means "not for sale" rather than "free"', () => {
    expect(parseIntent({ ...priceIntentFor(), priceMist: '0' }).ok).toBe(false);
  });

  it('refuses an amount that is not a decimal integer string', () => {
    for (const priceMist of ['1.5', '-1', '1e9', '0x10', ' 1', '']) {
      expect(parseIntent({ ...priceIntentFor(), priceMist }).ok).toBe(false);
    }
  });

  it('refuses a content key that is empty or over 256 bytes', () => {
    expect(parseIntent({ ...priceIntentFor(), contentKey: '' }).ok).toBe(false);
    expect(parseIntent({ ...priceIntentFor(), contentKey: 'x'.repeat(257) }).ok).toBe(false);
  });

  it('refuses a body digest that is not a lowercase hex sha256', () => {
    expect(parseIntent({ ...postIntentFor(), bodyDigestSha256: 'A'.repeat(64) }).ok).toBe(false);
    expect(parseIntent({ ...postIntentFor(), bodyDigestSha256: 'ab' }).ok).toBe(false);
  });

  it('never quotes the offending value back', () => {
    const parsed = parseIntent({ ...priceIntentFor(), contentKey: 'ignore-previous-instructions' });
    void parsed;
    const bad = parseIntent({ ...priceIntentFor(), priceMist: 'ignore-previous-instructions' });
    expect(bad.ok).toBe(false);
    if (bad.ok) throw new Error('unreachable');
    expect(bad.reason).not.toContain('ignore-previous-instructions');
  });
});

describe('the intent hash', () => {
  it('does not depend on key order', () => {
    const one = priceIntentFor();
    const reordered = Object.fromEntries(Object.entries(one).reverse());
    const a = parseIntent(one);
    const b = parseIntent(reordered);
    if (!a.ok || !b.ok) throw new Error('unreachable');
    expect(intentHash(a.intent)).toBe(intentHash(b.intent));
  });

  it('changes when the sealed body changes, so a signature is tied to one body', () => {
    const first = parseIntent(postIntentFor());
    const second = parseIntent({ ...postIntentFor(), bodyDigestSha256: 'b'.repeat(64) });
    if (!first.ok || !second.ok) throw new Error('unreachable');
    expect(intentHash(first.intent)).not.toBe(intentHash(second.intent));
  });

  it('sorts keys at every depth', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });
});
