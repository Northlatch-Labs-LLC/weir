// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mapWithLimit } from '../lib/concurrency';

describe('bounded concurrency', () => {
  it('runs more than one at a time', async () => {
    let inFlight = 0;
    let peak = 0;

    await mapWithLimit(
      Array.from({ length: 20 }, (_, i) => i),
      8,
      async (n) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 5));
        inFlight -= 1;
        return n;
      },
    );

    expect(peak).toBeGreaterThan(1);
  });

  it('never exceeds the limit it was given', async () => {
    let inFlight = 0;
    let peak = 0;

    await mapWithLimit(
      Array.from({ length: 50 }, (_, i) => i),
      8,
      async (n) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 2));
        inFlight -= 1;
        return n;
      },
    );

    expect(peak).toBeLessThanOrEqual(8);
  });

  it('returns results in INPUT order, not completion order', async () => {
    const items = [30, 5, 20, 1, 25];
    const out = await mapWithLimit(items, 4, async (ms) => {
      await new Promise((r) => setTimeout(r, ms));
      return ms;
    });

    expect(out).toEqual(items);
  });

  it('does not stall when there are fewer items than the limit', async () => {
    expect(await mapWithLimit([1, 2], 8, async (n) => n * 2)).toEqual([2, 4]);
  });

  it('handles an empty list without starting a worker', async () => {
    let called = 0;
    const out = await mapWithLimit([], 8, async () => {
      called += 1;
      return 1;
    });
    expect(out).toEqual([]);
    expect(called).toBe(0);
  });

  it('refuses a non-finite limit instead of silently doing nothing', async () => {
    await expect(mapWithLimit([1, 2, 3], Number.NaN, async (n) => n)).rejects.toThrow(RangeError);
  });

  it('still clamps a finite limit that is out of range', async () => {
    expect(await mapWithLimit([1, 2, 3], 0, async (n) => n * 10)).toEqual([10, 20, 30]);
    expect(await mapWithLimit([1, 2, 3], -5, async (n) => n * 10)).toEqual([10, 20, 30]);
  });

  it('lets a rejection through rather than leaving a hole in the array', async () => {
    await expect(
      mapWithLimit([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error('boom');
        return n;
      }),
    ).rejects.toThrow('boom');
  });
});

describe('the explore page gathers its reads before assembling', () => {
  const code = readFileSync(join(process.cwd(), 'lib/discovery.ts'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');

  it('has no await left inside the assembly loop', () => {
    const loop = code.slice(code.indexOf('for (const [index, row] of creators.entries())'));
    const body = loop.slice(0, loop.indexOf('\n    }'));
    expect(body.length).toBeGreaterThan(100);
    expect(body).not.toMatch(/\bawait\b/);
  });

  it('issues the reads through the bounded helper', () => {
    expect(code).toMatch(/mapWithLimit\(/);
    expect(code).toMatch(/CHAIN_READ_CONCURRENCY/);
  });

  it('flattens the stake reads rather than nesting them per creator', () => {
    expect(code).toMatch(/const stakeIds = \[/);
    expect(code).toMatch(/flatMap/);
  });
});
