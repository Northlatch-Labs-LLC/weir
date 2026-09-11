// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { createHash } from 'node:crypto';
import { open, readFile, type FileHandle } from 'node:fs/promises';

export const GENESIS_HASH = '0'.repeat(64);

export type PurseOutcomeName = 'signed' | 'refused';

export interface PurseAuditFields {
  readonly ts: number;
  readonly address: string;
  readonly policyHash: string;
  readonly policyFileSha256: string;
  readonly intentKind: string;
  readonly intentHash: string;
  readonly outcome: PurseOutcomeName;
  readonly ruleId: string;
  readonly reason: string;
  readonly txDigest: string;
}

export interface PurseAuditLine extends PurseAuditFields {
  readonly seq: number;
  readonly prevHash: string;
  readonly hash: string;
}

export function entryPreimage(fields: PurseAuditFields, seq: number, prevHash: string): string {
  const parts = [
    String(seq),
    prevHash,
    String(fields.ts),
    fields.address,
    fields.policyHash,
    fields.policyFileSha256,
    fields.intentKind,
    fields.intentHash,
    fields.outcome,
    fields.ruleId,
    fields.reason,
    fields.txDigest,
  ];
  return parts.map((part) => `${part.length}:${part}`).join(' ');
}

export function hashEntry(fields: PurseAuditFields, seq: number, prevHash: string): string {
  return createHash('sha256').update(entryPreimage(fields, seq, prevHash), 'utf8').digest('hex');
}

export type ChainVerdict =
  | { readonly intact: true; readonly length: number; readonly headHash: string }
  | { readonly intact: false; readonly line: number; readonly reason: string };

export function verifyAuditLines(lines: readonly PurseAuditLine[]): ChainVerdict {
  let prevHash = GENESIS_HASH;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (line.seq !== i) {
      return {
        intact: false,
        line: i + 1,
        reason:
          `line ${i + 1} declares seq ${line.seq}, and it is the ${i + 1}th line. A gap or a ` +
          `reorder is a deletion; the sequence number is inside the hash so that it cannot be either quietly.`,
      };
    }
    if (line.prevHash !== prevHash) {
      return {
        intact: false,
        line: i + 1,
        reason:
          `line ${i + 1} chains from ${line.prevHash} but the previous line hashes to ${prevHash}. ` +
          `Everything before this line still verifies.`,
      };
    }
    const expected = hashEntry(line, line.seq, line.prevHash);
    if (line.hash !== expected) {
      return {
        intact: false,
        line: i + 1,
        reason:
          `line ${i + 1} carries hash ${line.hash} but its contents hash to ${expected}. A field ` +
          `was edited after the line was written.`,
      };
    }
    prevHash = line.hash;
  }

  return { intact: true, length: lines.length, headHash: prevHash };
}

export type ReadAuditResult =
  | { readonly ok: true; readonly lines: readonly PurseAuditLine[] }
  | { readonly ok: false; readonly line: number; readonly reason: string };

const REQUIRED_KEYS: readonly (keyof PurseAuditLine)[] = [
  'seq', 'prevHash', 'hash', 'ts', 'address', 'policyHash', 'policyFileSha256',
  'intentKind', 'intentHash', 'outcome', 'ruleId', 'reason', 'txDigest',
];

export async function readAuditFile(path: string): Promise<ReadAuditResult> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return { ok: false, line: 0, reason: `${path} could not be read: ${detail}` };
  }

  const raw = text.split('\n').filter((line) => line.trim() !== '');
  const lines: PurseAuditLine[] = [];

  for (const [index, one] of raw.entries()) {
    let value: unknown;
    try {
      value = JSON.parse(one);
    } catch {
      return { ok: false, line: index + 1, reason: `line ${index + 1} is not valid JSON.` };
    }
    if (typeof value !== 'object' || value === null) {
      return { ok: false, line: index + 1, reason: `line ${index + 1} is not a JSON object.` };
    }
    const record = value as Record<string, unknown>;
    for (const key of REQUIRED_KEYS) {
      if (!(key in record)) {
        return { ok: false, line: index + 1, reason: `line ${index + 1} has no ${String(key)} field.` };
      }
    }
    lines.push(record as unknown as PurseAuditLine);
  }

  return { ok: true, lines };
}

export class AuditFile {
  readonly #handle: FileHandle;
  readonly #path: string;
  #seq: number;
  #headHash: string;

  private constructor(handle: FileHandle, path: string, seq: number, headHash: string) {
    this.#handle = handle;
    this.#path = path;
    this.#seq = seq;
    this.#headHash = headHash;
  }

  get path(): string {
    return this.#path;
  }

  get headHash(): string {
    return this.#headHash;
  }

  get length(): number {
    return this.#seq;
  }

  static async open(path: string): Promise<{ ok: true; file: AuditFile } | { ok: false; reason: string }> {
    let seq = 0;
    let headHash = GENESIS_HASH;

    const existing = await readAuditFile(path);
    if (existing.ok) {
      const verdict = verifyAuditLines(existing.lines);
      if (!verdict.intact) {
        return {
          ok: false,
          reason:
            `${path} already holds a broken chain at line ${verdict.line}: ${verdict.reason} ` +
            `The purse will not append to it. Move the file aside under a dated name, keep it, and ` +
            `start a new one — appending would chain honest entries onto a hash the file cannot ` +
            `justify and make everything after the break look sound.`,
        };
      }
      seq = verdict.length;
      headHash = verdict.headHash;
    } else if (existing.line !== 0) {
      return { ok: false, reason: `${path} is unreadable as a chain: ${existing.reason}` };
    }

    let handle: FileHandle;
    try {
      handle = await open(path, 'a', 0o600);
      await handle.chmod(0o600);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return { ok: false, reason: `${path} could not be opened for appending: ${detail}` };
    }

    return { ok: true, file: new AuditFile(handle, path, seq, headHash) };
  }

  async append(fields: PurseAuditFields): Promise<PurseAuditLine> {
    const seq = this.#seq;
    const prevHash = this.#headHash;
    const line: PurseAuditLine = {
      ...fields,
      seq,
      prevHash,
      hash: hashEntry(fields, seq, prevHash),
    };
    await this.#handle.write(`${JSON.stringify(line)}\n`);
    await this.#handle.sync();
    this.#seq = seq + 1;
    this.#headHash = line.hash;
    return line;
  }

  async close(): Promise<void> {
    await this.#handle.close();
  }
}
