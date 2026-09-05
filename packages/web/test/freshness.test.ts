// Built-by: @projectx.sui · Co-authored-by: Claude
/**
 * The relative-time wording ladder: `just now` under a minute, a rounded floored minute count
 * under an hour, and a UTC clock time from an hour on — pinned exactly, since every figure and
 * every funnel note on the landing route now reads through this one function.
 */
import { describe, expect, it } from 'vitest';
import { ago } from '../lib/freshness';

const MIN = 60_000;
const HOUR = 3_600_000;

describe('ago', () => {
  it('says "just now" for anything under a minute, including zero and just under 60s', () => {
    const at = 1_756_700_000_000;
    expect(ago(at, at)).toBe('just now');
    expect(ago(at + 59_000, at)).toBe('just now');
  });

  it('rounds to the nearest minute from 60s up, and never rounds down to zero', () => {
    const at = 1_756_700_000_000;
    expect(ago(at + 60_000, at)).toBe('~1 min ago');
    expect(ago(at + 89_000, at)).toBe('~1 min ago'); // rounds to 1 min, not 2
    expect(ago(at + 90_000, at)).toBe('~2 min ago'); // rounds up at the midpoint
    expect(ago(at + 5 * MIN, at)).toBe('~5 min ago');
    expect(ago(at + 59 * MIN + 29_000, at)).toBe('~59 min ago');
  });

  it('switches to a UTC clock time at one hour and beyond', () => {
    const at = Date.UTC(2026, 8, 4, 14, 7, 0); // 2026-09-04T14:07:00Z
    expect(ago(at + HOUR, at)).toBe('read at 14:07 UTC');
    expect(ago(at + 6 * HOUR, at)).toBe('read at 14:07 UTC');
  });

  it('zero-pads hours and minutes', () => {
    const at = Date.UTC(2026, 8, 4, 4, 5, 0); // 04:05 UTC
    expect(ago(at + HOUR, at)).toBe('read at 04:05 UTC');
  });
});
