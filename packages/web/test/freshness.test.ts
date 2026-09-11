// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { describe, expect, it } from 'vitest';
import { ago, posted } from '../lib/freshness';

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
    expect(ago(at + 89_000, at)).toBe('~1 min ago');
    expect(ago(at + 90_000, at)).toBe('~2 min ago');
    expect(ago(at + 5 * MIN, at)).toBe('~5 min ago');
    expect(ago(at + 59 * MIN + 29_000, at)).toBe('~59 min ago');
  });

  it('switches to a UTC clock time at one hour and beyond', () => {
    const at = Date.UTC(2026, 8, 4, 14, 7, 0);
    expect(ago(at + HOUR, at)).toBe('read at 14:07 UTC');
    expect(ago(at + 6 * HOUR, at)).toBe('read at 14:07 UTC');
  });

  it('zero-pads hours and minutes', () => {
    const at = Date.UTC(2026, 8, 4, 4, 5, 0);
    expect(ago(at + HOUR, at)).toBe('read at 04:05 UTC');
  });
});

describe('posted', () => {
  const now = Date.UTC(2026, 8, 9, 12, 0, 0);
  const s = 1000;

  it('says now under a minute', () => {
    expect(posted(now, now - 30 * s)).toBe('now');
  });

  it('counts minutes, then hours, then days', () => {
    expect(posted(now, now - 12 * 60 * s)).toBe('12m');
    expect(posted(now, now - 3 * 3600 * s)).toBe('3h');
    expect(posted(now, now - 2 * 86_400 * s)).toBe('2d');
  });

  it('floors rather than rounds, so nothing is dated into the future', () => {
    expect(posted(now, now - 119 * 60 * s)).toBe('1h');
    expect(posted(now, now - 59 * 60 * s)).toBe('59m');
  });

  it('becomes a date after a week, without the year while it is this year', () => {
    expect(posted(now, Date.UTC(2026, 7, 21, 9, 0, 0))).toBe('21 Aug');
  });

  it('carries the year once it is not this one', () => {
    expect(posted(now, Date.UTC(2025, 10, 3, 9, 0, 0))).toBe('3 Nov 2025');
  });

  it('never says "read at" — that is the other function, about the reader', () => {
    for (const minutes of [0, 5, 90, 60 * 26, 60 * 24 * 400]) {
      expect(posted(now, now - minutes * 60 * s)).not.toContain('read at');
    }
  });
});
