// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  ABORT_CLASSIFICATION,
  PRECONDITION_MARKER,
  classificationOf,
  classifyAbort,
  preconditionOf,
  refusePrecondition,
  type PreconditionName,
} from '../src/index.js';

const MOVE = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..', 'sui-contracts', 'sources');

const abortText = (code: number, path: string) =>
  `MoveAbort in 1st command, abort code: ${code}, in '0x${'c'.repeat(64)}::${path}' (instruction 7)`;

describe('the marker survives a round trip and nothing else does', () => {
  it('a precondition refusal reads back as one', () => {
    const reading = refusePrecondition<number>('creation-paused', 'account::open', 'the platform is paused.');
    expect(reading.ok).toBe(false);
    if (!reading.ok) {
      expect(preconditionOf(reading.failure)?.name).toBe('creation-paused');
      expect(preconditionOf(reading.failure)?.mayClear).toBe(true);
      expect(classificationOf(reading.failure)).toBe('precondition');
      expect(reading.failure.kind).toBe('precondition');
      expect(reading.failure.detail.startsWith(PRECONDITION_MARKER)).toBe(true);
      expect(reading.failure.detail).toContain('set_creation_paused(false)');
    }
  });

  it('an ordinary failure is not mistaken for one', () => {
    expect(
      preconditionOf({ kind: 'malformed', source: 's', detail: 'a plain refusal' }),
    ).toBeNull();
    expect(
      classificationOf({ kind: 'malformed', source: 's', detail: 'a plain refusal' }),
    ).toBe('permanent');
  });

  it('the marker without the kind is NOT a precondition — the kind is authoritative', () => {
    const quoted = { kind: 'malformed' as const, source: 's', detail: '[precondition:creation-paused] quoted' };
    expect(preconditionOf(quoted)).toBeNull();
    expect(classificationOf(quoted)).toBe('permanent');
  });

  it('a precondition kind with no readable name still classifies as a precondition', () => {
    const unnamed = { kind: 'precondition' as const, source: 's', detail: 'not yet' };
    expect(preconditionOf(unnamed)).toBeNull();
    expect(classificationOf(unnamed)).toBe('precondition');
  });

  it('`denied` is permanent for a loop: the answer was no', () => {
    expect(classificationOf({ kind: 'denied', source: 's', detail: '403' })).toBe('permanent');
  });

  it('an unrecognised name inside the marker is NOT reported as a precondition', () => {
    expect(
      preconditionOf({ kind: 'precondition', source: 's', detail: '[precondition:invented] x' }),
    ).toBeNull();
  });

  it('transport and timeout stay transport, marker or not', () => {
    expect(classificationOf({ kind: 'transport', source: 's', detail: 'ECONNREFUSED' })).toBe('transport');
    expect(classificationOf({ kind: 'timeout', source: 's', detail: 'deadline exceeded' })).toBe('transport');
  });

  it('`unconfigured` is permanent for a loop, deliberately', () => {
    expect(classificationOf({ kind: 'unconfigured', source: 's', detail: 'no key' })).toBe('permanent');
  });
});

describe('the abort table', () => {
  it('reads the module, not just the code — the same code means three different things', () => {
    expect(classifyAbort(abortText(4, 'platform::assert_can_create'))?.precondition).toBe('creation-paused');
    expect(classifyAbort(abortText(4, 'account::open'))?.precondition).toBeNull();
    expect(classifyAbort(abortText(4, 'creator::settle'))?.precondition).toBe('vault-not-accepting');
  });

  it('classifies the cases the defect report named', () => {
    const expected: Array<[number, string, PreconditionName | null]> = [
      [4, 'platform::assert_can_create', 'creation-paused'], // ECreationPaused
      [5, 'platform::assert_can_pay', 'payments-paused'], // EPaymentsPaused
      [4, 'creator::settle', 'vault-not-accepting'], // ENotAccepting
      [5, 'creator::settle', 'insufficient-balance'], // EInsufficientPayment
      [14, 'creator::claim_earnings', 'insufficient-balance'], // EInsufficientBalance
      [6, 'platform::charge_creation_fee', 'insufficient-balance'], // EInsufficientFee
      [4, 'account::open', null], // EAlreadyRegistered — permanent for that address
    ];
    for (const [code, path, want] of expected) {
      expect(classifyAbort(abortText(code, path))?.precondition, `${path} code ${code}`).toBe(want);
    }
  });

  it('leaves an unlisted code unclassified rather than guessing', () => {
    const decoded = classifyAbort(abortText(99, 'creator::settle'));
    expect(decoded?.code).toBe(99);
    expect(decoded?.precondition).toBeNull();
  });

  it('returns null when there is no abort in the text at all', () => {
    expect(classifyAbort('connection reset by peer')).toBeNull();
  });

  it('every entry is either a known precondition name or the literal `permanent`', () => {
    for (const [module, codes] of Object.entries(ABORT_CLASSIFICATION)) {
      for (const [code, value] of Object.entries(codes)) {
        expect(typeof value, `${module}:${code}`).toBe('string');
        expect(value.length, `${module}:${code}`).toBeGreaterThan(0);
      }
    }
  });
});

describe('the table agrees with the Move sources it was read from', () => {
  function errorCodes(file: string): Map<string, number> {
    const source = readFileSync(join(MOVE, file), 'utf8');
    const out = new Map<string, number>();
    for (const match of source.matchAll(/const\s+(E[A-Za-z0-9_]*)\s*:\s*u64\s*=\s*(\d+)\s*;/g)) {
      out.set(match[1]!, Number(match[2]));
    }
    return out;
  }

  const modules: Array<[string, string]> = [
    ['platform', 'platform.move'],
    ['account', 'account.move'],
    ['creator', 'creator.move'],
  ];

  it.each(modules)('%s: every code in the Move source is classified', (name, file) => {
    const codes = errorCodes(file);
    expect(codes.size, `${file} yielded no error constants — the parser is broken`).toBeGreaterThan(0);
    const table = ABORT_CLASSIFICATION[name] ?? {};
    for (const [constant, code] of codes) {
      expect(
        table[code],
        `${name}::${constant} = ${code} has no entry in ABORT_CLASSIFICATION. Every abort an ` +
          `agent can hit must be decided as a precondition or as permanent; an unlisted code ` +
          `silently becomes permanent, which is the failure this table exists to end.`,
      ).toBeDefined();
    }
  });

  it.each(modules)('%s: classifies no code the Move source does not define', (name, file) => {
    const defined = new Set(errorCodes(file).values());
    for (const code of Object.keys(ABORT_CLASSIFICATION[name] ?? {})) {
      expect(defined.has(Number(code)), `${name} code ${code} is not defined in ${file}`).toBe(true);
    }
  });

  it('the specific mappings named in the defect report match their Move constants', () => {
    const platform = errorCodes('platform.move');
    const account = errorCodes('account.move');
    const creator = errorCodes('creator.move');

    expect(ABORT_CLASSIFICATION['platform']?.[platform.get('ECreationPaused')!]).toBe('creation-paused');
    expect(ABORT_CLASSIFICATION['platform']?.[platform.get('EPaymentsPaused')!]).toBe('payments-paused');
    expect(ABORT_CLASSIFICATION['creator']?.[creator.get('ENotAccepting')!]).toBe('vault-not-accepting');
    expect(ABORT_CLASSIFICATION['creator']?.[creator.get('EInsufficientPayment')!]).toBe('insufficient-balance');
    expect(ABORT_CLASSIFICATION['account']?.[account.get('EAlreadyRegistered')!]).toBe('permanent');
  });
});
