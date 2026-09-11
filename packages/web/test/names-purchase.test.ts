// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { describe, expect, it } from 'vitest';
import { quoteNamePurchase } from '@/lib/names-purchase';

describe('quoteNamePurchase — the registration term', () => {
  it('refuses a term longer than the registrar allows', async () => {
    const reading = await quoteNamePurchase('projectx', 6);
    expect(reading.ok).toBe(false);
    if (!reading.ok) expect(reading.failure.detail).toContain('between 1 and 5 years');
  });

  it('refuses a zero or negative term', async () => {
    expect((await quoteNamePurchase('projectx', 0)).ok).toBe(false);
    expect((await quoteNamePurchase('projectx', -1)).ok).toBe(false);
  });

  it('refuses a fractional term rather than truncating it', async () => {
    const reading = await quoteNamePurchase('projectx', 1.5);
    expect(reading.ok).toBe(false);
  });

  it('rejects the term without needing the network', async () => {
    const reading = await quoteNamePurchase('projectx', 99);
    expect(reading.ok).toBe(false);
    if (!reading.ok) expect(reading.failure.source).toBe('name purchase quote');
  });
});
