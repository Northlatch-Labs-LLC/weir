// @vitest-environment node
// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
//
// /explore made its chain reads one at a time.
//
// Three awaits inside one `for` loop: a creator vault per creator, a nested loop of one read per
// stake vault, and a decimals lookup. Twenty creators each running two support vaults is sixty
// round trips in series, and the page takes as long as their sum — about nine seconds at 150ms a
// read, which is past the function timeout.
//
// Nothing about the work required that order. The reads are independent and only the assembly
// depends on all of them.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mapWithLimit } from '../lib/concurrency';

describe('bounded concurrency', () => {
  it('runs more than one at a time', async () => {
    // The defect in one assertion: sequential means a peak of exactly one.
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
    /*
      The other half, and the reason this is not `Promise.all`. These calls go to a shared,
      rate-limited fullnode: twenty at once trades a slow page for a burst against an endpoint this
      deployment shares with everybody on it.
    */
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
    /*
      Load-bearing. The caller zips these back against the list it passed in, so completion order
      would attribute one creator's figures to another — the kind of defect that looks like a data
      problem for a week.
    */
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
    /*
      Measured before it was fixed: `NaN` gave `Array.from({length: NaN})`, which is empty, so no
      worker started, `Promise.all([])` resolved at once, and the result was [undefined, undefined,
      undefined] with `fn` never called. A caller zipping that back against its input attributes
      empty data to every row — the same "looks like a data problem for a week" failure as
      completion ordering, arriving through the parameter rather than through the work.
    */
    await expect(mapWithLimit([1, 2, 3], Number.NaN, async (n) => n)).rejects.toThrow(RangeError);
  });

  it('still clamps a finite limit that is out of range', async () => {
    // Zero and negative are a caller asking for less than one at a time, which has an obvious
    // correct answer. NaN is a caller who does not know what they asked for, which does not.
    expect(await mapWithLimit([1, 2, 3], 0, async (n) => n * 10)).toEqual([10, 20, 30]);
    expect(await mapWithLimit([1, 2, 3], -5, async (n) => n * 10)).toEqual([10, 20, 30]);
  });

  it('lets a rejection through rather than leaving a hole in the array', async () => {
    /*
      Deliberate. Callers here pass functions returning a `Reading`, which cannot reject — so a
      rejection is a programming error, and swallowing it would put `undefined` in the middle of an
      array of results and let the page render around it.
    */
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
    /*
      The structural property. An await inside the loop is the defect regardless of how the reads
      above it are issued, because it puts one round trip between each result and the next.
    */
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
    // Reading them creator by creator would keep the nested loop's shape and only move it.
    expect(code).toMatch(/const stakeIds = \[/);
    expect(code).toMatch(/flatMap/);
  });
});
