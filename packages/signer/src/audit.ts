// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { createHash } from 'node:crypto';

export const GENESIS_HASH = '0'.repeat(64);

export interface AuditFields {
  readonly ts: number;
  readonly address: string;
  readonly txDigest: string;
  readonly policyHash: string;
  readonly decision: 'allow' | 'deny';
  readonly reason: string;
}

export interface AuditEntry extends AuditFields {
  readonly seq: number;
  readonly prevHash: string;
  readonly hash: string;
}

export function policyHash(canonicalJson: string): string {
  return createHash('sha256').update(canonicalJson, 'utf8').digest('hex');
}

export function entryPreimage(fields: AuditFields, seq: number, prevHash: string): string {
  const parts = [
    String(seq),
    prevHash,
    String(fields.ts),
    fields.address,
    fields.txDigest,
    fields.policyHash,
    fields.decision,
    fields.reason,
  ];
  return parts.map((part) => `${part.length}:${part}`).join('\x00');
}

function hashEntry(fields: AuditFields, seq: number, prevHash: string): string {
  return createHash('sha256').update(entryPreimage(fields, seq, prevHash), 'utf8').digest('hex');
}

export type ChainVerdict =
  | { readonly intact: true; readonly length: number; readonly headHash: string }
  | { readonly intact: false; readonly index: number; readonly reason: string };

export function verifyChain(entries: readonly AuditEntry[]): ChainVerdict {
  let prevHash = GENESIS_HASH;

  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i]!;

    if (entry.seq !== i) {
      return {
        intact: false,
        index: i,
        reason:
          `entry at position ${i} declares seq ${entry.seq}. A gap or a reorder is a deletion; ` +
          `the sequence number is part of the hash so that it cannot be either quietly.`,
      };
    }
    if (entry.prevHash !== prevHash) {
      return {
        intact: false,
        index: i,
        reason:
          `entry ${i} chains from ${entry.prevHash} but the previous entry hashes to ` +
          `${prevHash}. The chain is broken here — everything before this point still verifies.`,
      };
    }

    const expected = hashEntry(entry, entry.seq, entry.prevHash);
    if (entry.hash !== expected) {
      return {
        intact: false,
        index: i,
        reason:
          `entry ${i} carries hash ${entry.hash} but its contents hash to ${expected}. ` +
          `A field was edited after the entry was written.`,
      };
    }

    prevHash = entry.hash;
  }

  return { intact: true, length: entries.length, headHash: prevHash };
}

export class AuditLog {
  #entries: AuditEntry[] = [];

  get entries(): readonly AuditEntry[] {
    return [...this.#entries];
  }

  get headHash(): string {
    return this.#entries.at(-1)?.hash ?? GENESIS_HASH;
  }

  append(fields: AuditFields): AuditEntry {
    const seq = this.#entries.length;
    const prevHash = this.headHash;
    const entry: AuditEntry = {
      ...fields,
      seq,
      prevHash,
      hash: hashEntry(fields, seq, prevHash),
    };
    this.#entries.push(entry);
    return entry;
  }

  verify(): ChainVerdict {
    return verifyChain(this.#entries);
  }
}
