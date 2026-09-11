// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { createHash } from 'node:crypto';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export type RequestId = string | number;

export const RESULT_TTL_MS = 24 * 60 * 60 * 1000;

export const MAX_ENTRIES = 512;

export interface KeyInput {
  requestId: RequestId;
  tool: string;
  args: unknown;
  principal: string | null;
}

function canonical(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`);
    return `{${entries.join(',')}}`;
  }
  if (typeof value === 'bigint') return `"${value.toString()}"`;
  return JSON.stringify(value) ?? 'null';
}

export function idempotencyKeyFor(input: KeyInput): string {
  const material = [
    'weir-mcp/1',
    input.principal ?? '',
    input.tool,
    typeof input.requestId === 'number' ? `n:${input.requestId}` : `s:${input.requestId}`,
    canonical(input.args),
  ].join('\u0000');
  return createHash('sha256').update(material, 'utf8').digest('hex');
}

interface Entry {
  work: Promise<CallToolResult>;
  startedAtMs: number;
  settled: boolean;
}

export class CallLedger {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly nowMs: () => number = Date.now) {}

  get size(): number {
    return this.entries.size;
  }

  async once(key: string, work: () => Promise<CallToolResult>): Promise<CallToolResult> {
    this.evict();

    const existing = this.entries.get(key);
    if (existing !== undefined) return existing.work;

    const started = this.nowMs();
    const promise = work();
    const entry: Entry = { work: promise, startedAtMs: started, settled: false };
    void promise.then(
      () => {
        entry.settled = true;
      },
      () => {
        entry.settled = true;
      },
    );
    this.entries.set(key, entry);

    try {
      return await promise;
    } catch (error) {
      this.entries.delete(key);
      throw error;
    }
  }

  private evict(): void {
    const now = this.nowMs();
    for (const [key, entry] of this.entries) {
      if (entry.settled && now - entry.startedAtMs > RESULT_TTL_MS) this.entries.delete(key);
    }
    while (this.entries.size >= MAX_ENTRIES) {
      let dropped = false;
      for (const [key, entry] of this.entries) {
        if (entry.settled) {
          this.entries.delete(key);
          dropped = true;
          break;
        }
      }
      if (!dropped) break;
    }
  }
}
