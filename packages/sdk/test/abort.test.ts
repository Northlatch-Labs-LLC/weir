// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { describe, expect, it } from 'vitest';
import { decodeAbort } from '../src/client.js';

const REAL_ABORT =
  "MoveAbort in 2nd command, abort code: 5, in " +
  "'0xc5c833991ed1123d70b1001c0bcdb01ec5728b09f25dfc42a0edaf16005d404d::stake_vault::deposit' " +
  '(instruction 55)';

describe('decodeAbort', () => {
  it('reads the code and module from a real mainnet abort', () => {
    const decoded = decodeAbort(REAL_ABORT);
    expect(decoded.module).toBe('stake_vault');
    expect(decoded.code).toBe(5);
    expect(decoded.explanation).toBe('Deposit is below the one SUI minimum.');
  });

  it('is not fooled by the command ordinal', () => {
    expect(decodeAbort(REAL_ABORT).code).not.toBe(2);
    expect(decodeAbort(REAL_ABORT).code).not.toBe(55);
  });

  it('reads a first-command abort too', () => {
    const decoded = decodeAbort(
      "MoveAbort in 1st command, abort code: 13, in '0xabc::creator::subscribe' (instruction 9)",
    );
    expect(decoded.module).toBe('creator');
    expect(decoded.code).toBe(13);
    expect(decoded.explanation).toBe('A creator cannot pay their own vault.');
  });

  it('preserves the raw text always', () => {
    expect(decodeAbort(REAL_ABORT).raw).toBe(REAL_ABORT);
  });

  it('gives no explanation for a code the module does not define', () => {
    const decoded = decodeAbort("abort code: 9999, in '0xabc::creator::subscribe'");
    expect(decoded.module).toBe('creator');
    expect(decoded.code).toBe(9999);
    expect(decoded.explanation).toBeNull();
  });

  it('gives no explanation for an unrecognised module', () => {
    const decoded = decodeAbort("abort code: 5, in '0xabc::some_other_module::f'");
    expect(decoded.module).toBe('some_other_module');
    expect(decoded.explanation).toBeNull();
  });

  it('does not invent a code when the message has none', () => {
    const decoded = decodeAbort('InsufficientGas: the transaction ran out of budget');
    expect(decoded.code).toBe(-1);
    expect(decoded.module).toBe('unknown');
    expect(decoded.explanation).toBeNull();
    expect(decoded.raw).toContain('InsufficientGas');
  });
});

describe('creator abort 2 — the wrong capability', () => {
  it('explains that a CreatorCap is bound to one vault', () => {
    const decoded = decodeAbort(
      "MoveAbort in 1st command, abort code: 2, in " +
        "'0xa7fd154039f77780f808c7262511a9f4a860620d57e17b58e0e2ca010e1d214d::creator::claim_earnings'",
    );
    expect(decoded.code).toBe(2);
    expect(decoded.module).toBe('creator');
    expect(decoded.explanation).toContain('bound to the vault');
  });
});
