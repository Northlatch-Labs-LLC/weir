// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
/**
 * Failure classification.
 *
 * The kind is not cosmetic: several readers fold `not-found` into a **measured absence** — "this
 * address has published no key", "this handle is free" — while every other kind stays a failure.
 * Misclassifying therefore does not produce a slightly wrong label; it produces the wrong answer to
 * the question the caller asked.
 *
 * The `not_found` case here is a real defect this file was written after finding: gRPC's canonical
 * status name is `NOT_FOUND`, which lower-cases to `not_found` with an underscore, and the matcher
 * only knew `not found` and `notfound`. Every genuine "no such object" was classed as `transport`.
 */

import { describe, expect, it } from 'vitest';
import { classify, fold, ok, fail, readerHealth } from '../src/reading.js';

describe('classify', () => {
  it('recognises not-found in every spelling a node has produced', () => {
    for (const message of ['NOT_FOUND', 'not_found', 'Object not found', 'NotFound: 0x1']) {
      expect(classify(new Error(message), 'test').kind, message).toBe('not-found');
    }
  });

  it('recognises timeouts', () => {
    for (const message of ['Deadline exceeded', 'request timeout', 'The operation was aborted']) {
      expect(classify(new Error(message), 'test').kind, message).toBe('timeout');
    }
  });

  it('defaults to transport, not to not-found', () => {
    /*
      The direction of the default matters. `transport` keeps a failure a failure; defaulting to
      `not-found` would let an unrecognised error be folded into "there is none" by every caller
      that treats absence as an answer.
    */
    expect(classify(new Error('connect ECONNREFUSED'), 'test').kind).toBe('transport');
    expect(classify(new Error('14 UNAVAILABLE'), 'test').kind).toBe('transport');
    expect(classify('a bare string', 'test').kind).toBe('transport');
  });

  it('keeps the original message rather than replacing it', () => {
    // An opaque error can be searched for; a confident wrong explanation cannot be un-read.
    const detail = 'rpc error: code = Unknown desc = something specific';
    expect(classify(new Error(detail), 'test').detail).toBe(detail);
  });

  it('carries the source through', () => {
    expect(classify(new Error('x'), 'Platform 0xabc').source).toBe('Platform 0xabc');
  });
});

describe('fold', () => {
  it('requires both branches, so a failure cannot fall through to a value', () => {
    expect(fold(ok(7), (v) => v, () => -1)).toBe(7);
    expect(fold<number, number>(fail('transport', 's', 'd'), (v) => v, () => -1)).toBe(-1);
  });
});

describe('readerHealth', () => {
  it('keeps never-succeeded distinct from failing', () => {
    // A reader called ten thousand times that has never once returned data is not
    // "healthy with no results". Only a distinct status can say so.
    expect(
      readerHealth({
        attempts: 10_000,
        successes: 0,
        consecutiveFailures: 10_000,
        lastSuccessAtMs: null,
      }),
    ).toBe('never-succeeded');
    expect(
      readerHealth({ attempts: 0, successes: 0, consecutiveFailures: 0, lastSuccessAtMs: null }),
    ).toBe('idle');
  });
});
