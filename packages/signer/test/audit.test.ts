// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { describe, expect, it } from 'vitest';
import {
  AuditLog,
  GENESIS_HASH,
  entryPreimage,
  policyHash,
  verifyChain,
  type AuditEntry,
} from '../src/index.js';
import { canonicalPolicyJson } from '@projectx-social/policy';
import { AGENT, policyFor } from './helpers.js';

const HASH = policyHash(canonicalPolicyJson(policyFor(AGENT)));

function chainOfThree(): AuditLog {
  const log = new AuditLog();
  log.append({
    ts: 1,
    address: AGENT,
    txDigest: 'digest-one',
    policyHash: HASH,
    decision: 'allow',
    reason: '',
  });
  log.append({
    ts: 2,
    address: AGENT,
    txDigest: 'digest-two',
    policyHash: HASH,
    decision: 'deny',
    reason: '[move-call-target] command 1 calls claim_earnings',
  });
  log.append({
    ts: 3,
    address: AGENT,
    txDigest: 'digest-three',
    policyHash: HASH,
    decision: 'allow',
    reason: '',
  });
  return log;
}

describe('an intact chain', () => {
  it('verifies, and reports its head for external anchoring', () => {
    const verdict = chainOfThree().verify();
    expect(verdict.intact).toBe(true);
    if (!verdict.intact) throw new Error('unreachable');
    expect(verdict.length).toBe(3);
    expect(verdict.headHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('starts from the genesis hash', () => {
    expect(new AuditLog().headHash).toBe(GENESIS_HASH);
    expect(chainOfThree().entries[0]!.prevHash).toBe(GENESIS_HASH);
  });

  it('records denials, not only successes', () => {
    const denials = chainOfThree().entries.filter((e) => e.decision === 'deny');
    expect(denials).toHaveLength(1);
    expect(denials[0]!.reason).toContain('claim_earnings');
  });

  it('will not hand out its internal array', () => {
    const log = chainOfThree();
    const stolen = log.entries as AuditEntry[];
    stolen.length = 0;
    expect(log.entries).toHaveLength(3);
  });
});

describe('tampering', () => {
  it('is detected when a single field is edited', () => {
    const entries = [...chainOfThree().entries];
    entries[1] = { ...entries[1]!, decision: 'allow', reason: '' };

    const verdict = verifyChain(entries);
    expect(verdict.intact).toBe(false);
    if (verdict.intact) throw new Error('unreachable');
    expect(verdict.index).toBe(1);
    expect(verdict.reason).toContain('hash to');
  });

  it('is detected when the recorded policy hash is swapped for a wider policy', () => {
    const entries = [...chainOfThree().entries];
    entries[0] = { ...entries[0]!, policyHash: policyHash('{"a widened policy":true}') };
    const verdict = verifyChain(entries);
    expect(verdict.intact).toBe(false);
    if (verdict.intact) throw new Error('unreachable');
    expect(verdict.index).toBe(0);
  });

  it('is detected when two entries are swapped', () => {
    const original = chainOfThree().entries;
    const entries = [original[1]!, original[0]!, original[2]!];
    const verdict = verifyChain(entries);
    expect(verdict.intact).toBe(false);
    if (verdict.intact) throw new Error('unreachable');
    expect(verdict.index).toBe(0);
    expect(verdict.reason).toContain('seq');
  });

  it('is detected when an entry is deleted from the middle', () => {
    const original = chainOfThree().entries;
    const verdict = verifyChain([original[0]!, original[2]!]);
    expect(verdict.intact).toBe(false);
    if (verdict.intact) throw new Error('unreachable');
    expect(verdict.index).toBe(1);
  });

  it('is detected when an entry is forged onto the end', () => {
    const original = chainOfThree().entries;
    const forged: AuditEntry = {
      seq: 3,
      ts: 4,
      address: AGENT,
      txDigest: 'a spend nobody approved',
      policyHash: HASH,
      decision: 'allow',
      reason: '',
      prevHash: original[2]!.hash,
      hash: 'f'.repeat(64),
    };
    const verdict = verifyChain([...original, forged]);
    expect(verdict.intact).toBe(false);
    if (verdict.intact) throw new Error('unreachable');
    expect(verdict.index).toBe(3);
  });

  it('is NOT detected when the whole chain is recomputed — the stated limitation', () => {
    const honest = chainOfThree();
    const rewritten = new AuditLog();
    rewritten.append({
      ts: 1,
      address: AGENT,
      txDigest: 'digest-one',
      policyHash: HASH,
      decision: 'allow',
      reason: '',
    });
    rewritten.append({
      ts: 2,
      address: AGENT,
      txDigest: 'digest-two',
      policyHash: HASH,
      decision: 'allow',
      reason: '',
    });
    rewritten.append({
      ts: 3,
      address: AGENT,
      txDigest: 'digest-three',
      policyHash: HASH,
      decision: 'allow',
      reason: '',
    });

    expect(rewritten.verify().intact).toBe(true);
    expect(rewritten.headHash).not.toBe(honest.headHash);
  });
});

describe('the preimage', () => {
  it('length-prefixes every field, so a crafted reason cannot forge a field boundary', () => {
    const a = entryPreimage(
      { ts: 1, address: 'aa', txDigest: 'bb', policyHash: 'cc', decision: 'allow', reason: 'x y' },
      0,
      GENESIS_HASH,
    );
    const b = entryPreimage(
      { ts: 1, address: 'aa', txDigest: 'bb', policyHash: 'cc', decision: 'allow', reason: 'x  y' },
      0,
      GENESIS_HASH,
    );
    expect(a).not.toBe(b);
  });

  it('changes when the sequence or the previous hash changes', () => {
    const fields = {
      ts: 1,
      address: AGENT,
      txDigest: 'd',
      policyHash: HASH,
      decision: 'allow' as const,
      reason: '',
    };
    expect(entryPreimage(fields, 0, GENESIS_HASH)).not.toBe(entryPreimage(fields, 1, GENESIS_HASH));
    expect(entryPreimage(fields, 0, GENESIS_HASH)).not.toBe(entryPreimage(fields, 0, 'a'.repeat(64)));
  });
});
