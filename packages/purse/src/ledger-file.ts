// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { open, readFile, rename, writeFile } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import type { LedgerEntry, LedgerState, PolicyDoc, SimulatedEffects } from '@projectx-social/policy';

export function outflowsOf(effects: SimulatedEffects, agentAddress: string): LedgerEntry[] {
  const wanted = normalise(agentAddress);
  const totals = new Map<string, bigint>();

  for (const change of effects.balanceChanges) {
    if (normalise(change.address) !== wanted) continue;
    let amount: bigint;
    try {
      amount = BigInt(change.amount);
    } catch {
      continue;
    }
    if (amount >= 0n) continue;
    totals.set(change.coinType, (totals.get(change.coinType) ?? 0n) + -amount);
  }

  return [...totals].map(([coinType, amountOut]) => ({
    coinType,
    amountOut: amountOut.toString(),
    atMs: effects.observedAtMs,
  }));
}

function normalise(address: string): string {
  const trimmed = address.trim();
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(trimmed)) return trimmed.toLowerCase();
  return `0x${trimmed.slice(2).toLowerCase().padStart(64, '0')}`;
}

function longestPeriodMs(policy: PolicyDoc): number {
  let longest = 0;
  for (const ceiling of policy.outflowCeilings) {
    if (Number.isInteger(ceiling.periodMs) && ceiling.periodMs > longest) longest = ceiling.periodMs;
  }
  return longest;
}

export class SpendLedger {
  readonly #handle: FileHandle;
  readonly #entries: LedgerEntry[];
  readonly #now: () => number;

  private constructor(handle: FileHandle, entries: LedgerEntry[], now: () => number) {
    this.#handle = handle;
    this.#entries = entries;
    this.#now = now;
  }

  static async open(args: {
    readonly path: string;
    readonly policy: PolicyDoc;
    readonly now?: () => number;
  }): Promise<{ ok: true; ledger: SpendLedger } | { ok: false; reason: string }> {
    const now = args.now ?? (() => Date.now());
    const window = longestPeriodMs(args.policy);
    const cutoff = now() - window;
    const kept: LedgerEntry[] = [];

    let text = '';
    try {
      text = await readFile(args.path, 'utf8');
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        return { ok: false, reason: `${args.path} could not be read: ${String(code ?? error)}` };
      }
    }

    for (const line of text.split('\n')) {
      if (line.trim() === '') continue;
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        return {
          ok: false,
          reason:
            `${args.path} holds a line that is not JSON. The purse will not start on an unreadable ` +
            `spend record: prior spend that cannot be read must never be counted as zero.`,
        };
      }
      const entry = value as Partial<LedgerEntry>;
      if (typeof entry.coinType !== 'string' || typeof entry.amountOut !== 'string' || typeof entry.atMs !== 'number') {
        return {
          ok: false,
          reason: `${args.path} holds a line that is not a spend entry. The purse will not start.`,
        };
      }
      if (entry.atMs < cutoff) continue;
      kept.push({ coinType: entry.coinType, amountOut: entry.amountOut, atMs: entry.atMs });
    }

    const temporary = `${args.path}.rewriting`;
    try {
      await writeFile(temporary, kept.map((e) => JSON.stringify(e)).join('\n') + (kept.length > 0 ? '\n' : ''), {
        mode: 0o600,
      });
      await rename(temporary, args.path);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return { ok: false, reason: `${args.path} could not be rewritten: ${detail}` };
    }

    let handle: FileHandle;
    try {
      handle = await open(args.path, 'a', 0o600);
      await handle.chmod(0o600);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return { ok: false, reason: `${args.path} could not be opened for appending: ${detail}` };
    }

    return { ok: true, ledger: new SpendLedger(handle, kept, now) };
  }

  state(): LedgerState {
    return { nowMs: this.#now(), spend: [...this.#entries] };
  }

  async record(entries: readonly LedgerEntry[]): Promise<void> {
    if (entries.length === 0) return;
    for (const entry of entries) this.#entries.push(entry);
    await this.#handle.write(entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
    await this.#handle.sync();
  }

  async close(): Promise<void> {
    await this.#handle.close();
  }
}
