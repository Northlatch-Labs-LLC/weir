// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { describe, expect, it } from 'vitest';
import { simulationStatus } from '../src/client';

describe('the gRPC envelopes', () => {
  it('reads a success from Transaction', () => {
    expect(simulationStatus({ $kind: 'Transaction', Transaction: { status: { success: true } } }))
      .toEqual({ success: true });
  });

  it('reads an abort from FailedTransaction — the envelope the daemon copy missed', () => {
    const aborted = {
      $kind: 'FailedTransaction',
      FailedTransaction: { status: { success: false, error: 'MoveAbort(…, 3)' } },
    };

    expect(simulationStatus(aborted)).toEqual({ success: false, error: 'MoveAbort(…, 3)' });
  });

  it('still reads the legacy JSON-RPC shape an older node speaks', () => {
    expect(simulationStatus({ transaction: { effects: { status: { success: true } } } }))
      .toEqual({ success: true });
  });

  it('prefers the gRPC envelope when a response somehow carries both', () => {
    const both = {
      Transaction: { status: { success: true } },
      transaction: { effects: { status: { success: false } } },
    };
    expect(simulationStatus(both)).toEqual({ success: true });
  });
});

describe('shapes that carry no status', () => {
  it('returns undefined for an unrecognised envelope, so the caller refuses', () => {
    expect(simulationStatus({ Something: { status: { success: true } } })).toBeUndefined();
  });

  for (const [name, value] of [
    ['null', null],
    ['undefined', undefined],
    ['a string', 'ok'],
    ['a number', 1],
  ] as const) {
    it(`survives ${name} without throwing`, () => {
      expect(simulationStatus(value)).toBeUndefined();
    });
  }

  it('survives a null Transaction, which optional chaining does NOT guard', () => {
    expect(() => simulationStatus({ Transaction: null })).not.toThrow();
    expect(simulationStatus({ Transaction: null })).toBeUndefined();
  });

  it('survives a null status inside a real envelope', () => {
    expect(simulationStatus({ Transaction: { status: null } })).toBeUndefined();
  });
});
