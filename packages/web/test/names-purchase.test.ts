// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
/**
 * Selling a `.sui` name.
 *
 * # What is no longer tested here, and why
 *
 * This file used to pin `handleForLabel`: while buying a name also opened a platform account, the
 * label had to be a legal handle, and SuiNS permits hyphens where handles do not. That guard was
 * correct for that design, and the design was wrong. Buying a name is a purchase, not a signup, so
 * a hyphenated name is now simply a name we can sell — and refusing money for it would be a bug.
 *
 * # What is testable without a chain
 *
 * Only the term. Everything else in this module needs a live Pyth feed and a registrar read, so it
 * belongs in a script run deliberately rather than in a unit suite that must not fail because a
 * price feed was briefly unreachable.
 *
 * The term matters more than it looks: it multiplies the renewal price, so an accepted zero or a
 * silently clamped six is a quote for a different purchase from the one somebody asked for.
 */

import { describe, expect, it } from 'vitest';
import { quoteNamePurchase } from '@/lib/names-purchase';

describe('quoteNamePurchase — the registration term', () => {
  /*
    Rejected rather than clamped. Clamping six years to five would quote, charge and register a
    different thing from the one that was asked for, and the buyer would learn about it from the
    expiry date rather than from us.
  */
  it('refuses a term longer than the registrar allows', async () => {
    const reading = await quoteNamePurchase('projectx', 6);
    expect(reading.ok).toBe(false);
    if (!reading.ok) expect(reading.failure.detail).toContain('between 1 and 5 years');
  });

  it('refuses a zero or negative term', async () => {
    expect((await quoteNamePurchase('projectx', 0)).ok).toBe(false);
    expect((await quoteNamePurchase('projectx', -1)).ok).toBe(false);
  });

  /* A fractional year is not something SuiNS sells, and `u8` would truncate it silently. */
  it('refuses a fractional term rather than truncating it', async () => {
    const reading = await quoteNamePurchase('projectx', 1.5);
    expect(reading.ok).toBe(false);
  });

  /*
    The term is checked before anything is read, so an invalid one fails the same way whether or not
    Pyth and the registrar are reachable. That is what makes these safe in a unit suite.
  */
  it('rejects the term without needing the network', async () => {
    const reading = await quoteNamePurchase('projectx', 99);
    expect(reading.ok).toBe(false);
    if (!reading.ok) expect(reading.failure.source).toBe('name purchase quote');
  });
});
