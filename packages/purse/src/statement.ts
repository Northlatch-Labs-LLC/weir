// Built-by: @projectx.sui

import { createHash } from 'node:crypto';
import { z } from 'zod';
import { statementFor, type Action } from '@projectx-social/sdk';
import { normaliseAddress, normaliseType, type PolicyDoc } from '@projectx-social/policy';
import { readAuditFile, verifyAuditLines } from './audit-file.js';

const HEX_ID = /^0x[0-9a-fA-F]{1,64}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const MOVE_TYPE = /^0x[0-9a-fA-F]{1,64}::[A-Za-z_][A-Za-z0-9_]{0,127}::[A-Za-z_][A-Za-z0-9_]{0,127}$/;

export const MAX_POST_TITLE_LENGTH = 200;
export const MAX_DISPLAY_NAME_LENGTH = 60;
export const MAX_BIO_LENGTH = 280;
export const MAX_HANDLE_LENGTH = 32;

const line = (max: number) => z.string().min(1).max(max).regex(/^[^\x00-\x1f\x7f]*$/, 'a statement field is one line without control characters');

export const nameVaultAction = z.strictObject({
  kind: z.literal('name-vault'),
  vaultId: z.string().regex(HEX_ID),
  name: z.string().max(MAX_DISPLAY_NAME_LENGTH).regex(/^[^\x00-\x1f\x7f]*$/),
  bio: z.string().max(MAX_BIO_LENGTH).regex(/^[^\x00-\x1f\x7f]*$/),
  coinType: z.string().regex(MOVE_TYPE),
});

export const publishAction = z.strictObject({
  kind: z.literal('publish'),
  handle: z.string().min(1).max(MAX_HANDLE_LENGTH).regex(/^[a-z0-9_]+$/),
  title: line(MAX_POST_TITLE_LENGTH),
  access: z.enum(['public', 'paid']),
  contentSha256: z.string().regex(SHA256_HEX),
  contentKey: z.string().max(256).regex(/^[^\x00-\x1f\x7f]*$/).refine((v) => v === v.trim(), { message: 'a content key carries no leading or trailing whitespace' }),
  price: z.string().regex(/^$|^[1-9][0-9]{0,19}$/),
});

export const statementIntent = z.strictObject({
  kind: z.literal('statement'),
  action: z.discriminatedUnion('kind', [nameVaultAction, publishAction]),
  timestampMs: z.number().int().positive(),
  origin: z.string().url(),
});

export type StatementIntent = z.infer<typeof statementIntent>;

export interface StatementBounds {
  readonly origin: string;
  readonly perDay: number;
  readonly auditPath: string;
  readonly vaultId: string;
}

export class StatementCounter {
  #times: number[] | null = null;
  readonly #auditPath: string;

  constructor(auditPath: string) {
    this.#auditPath = auditPath;
  }

  async signedSince(sinceMs: number): Promise<{ ok: true; count: number } | { ok: false; reason: string }> {
    if (this.#times === null) {
      const read = await readAuditFile(this.#auditPath);
      if (!read.ok) return { ok: false, reason: `the audit chain could not be read to seed the statement count (${read.reason})` };
      const verdict = verifyAuditLines(read.lines);
      if (!verdict.intact) return { ok: false, reason: `the audit chain is broken at line ${String(verdict.line)} (${verdict.reason}); no statement is signed over a broken chain` };
      this.#times = read.lines.filter((e) => e.intentKind === 'statement' && e.outcome === 'signed').map((e) => e.ts);
    }
    return { ok: true, count: this.#times.filter((t) => t >= sinceMs).length };
  }

  record(ts: number): void {
    (this.#times ??= []).push(ts);
  }
}

export const DAY_MS = 24 * 60 * 60 * 1000;

export interface StatementRefusal {
  readonly ruleId: 'statement-disabled' | 'statement-origin' | 'statement-object' | 'statement-price' | 'statement-ceiling' | 'statement-clock';
  readonly reason: string;
}

export async function judgeStatement(args: {
  readonly intent: StatementIntent;
  readonly bounds: StatementBounds | undefined;
  readonly counter: StatementCounter | undefined;
  readonly policy: PolicyDoc;
  readonly nowMs: number;
}): Promise<StatementRefusal | null> {
  const { intent, bounds, counter, policy, nowMs } = args;
  if (bounds === undefined) {
    return {
      ruleId: 'statement-disabled',
      reason: 'this purse was started without --api-origin and --statements-per-day, so it signs no statement. Nothing was signed.',
    };
  }
  if (intent.origin !== bounds.origin) {
    return {
      ruleId: 'statement-origin',
      reason: `the statement names an origin other than the one this purse signs for (${bounds.origin}). Nothing was signed.`,
    };
  }
  if (Math.abs(intent.timestampMs - nowMs) > 60_000) {
    return {
      ruleId: 'statement-clock',
      reason: 'the statement is dated more than a minute from this purse\'s clock. A statement is issued now or not at all.',
    };
  }
  if (intent.action.kind === 'name-vault') {
    const wanted = normaliseAddress(bounds.vaultId);
    const named = normaliseAddress(intent.action.vaultId);
    const objects = new Set(policy.allowedObjects.map((o) => normaliseAddress(o)));
    if (wanted === null || named === null || named !== wanted || !objects.has(named)) {
      return {
        ruleId: 'statement-object',
        reason: 'the vault to be named is not Heron\'s own vault as this purse was started with, or not in the policy\'s allowed objects. Nothing was signed.',
      };
    }
    const coin = normaliseType(intent.action.coinType);
    if (coin === null || !policy.allowedTypeArguments.some((t) => normaliseType(t) === coin)) {
      return {
        ruleId: 'statement-object',
        reason: 'the coin type to be named is not in the policy\'s allowed type arguments. Nothing was signed.',
      };
    }
  } else {
    const paid = intent.action.access === 'paid';
    if (paid !== (intent.action.contentKey !== '') || paid !== (intent.action.price !== '')) {
      return {
        ruleId: 'statement-price',
        reason: 'a paid post carries a content key and a price; a public post carries neither. Nothing was signed.',
      };
    }
    if (paid) {
      const ceiling = policy.outflowCeilings.find((c) => /::sui::SUI$/.test(c.coinType));
      if (ceiling === undefined || BigInt(intent.action.price) > BigInt(ceiling.maxPerPeriod)) {
        return {
          ruleId: 'statement-price',
          reason: 'the price is above the policy\'s daily SUI ceiling, or the policy names no SUI ceiling. Nothing was signed.',
        };
      }
    }
  }
  const since = nowMs - DAY_MS;
  if (counter === undefined) {
    return { ruleId: 'statement-ceiling', reason: 'no statement counter was seeded for this purse. Nothing was signed.' };
  }
  const counted = await counter.signedSince(since);
  if (!counted.ok) {
    return { ruleId: 'statement-ceiling', reason: `${counted.reason}. Nothing was signed.` };
  }
  const signedToday = counted.count;
  if (signedToday >= bounds.perDay) {
    return {
      ruleId: 'statement-ceiling',
      reason: `${String(signedToday)} statements were signed in the last 24 hours, the ceiling is ${String(bounds.perDay)}. Nothing was signed.`,
    };
  }
  return null;
}

export function statementText(intent: StatementIntent, address: string): string {
  return statementFor(intent.action as Action, address, intent.timestampMs, intent.origin);
}

export function statementSha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
