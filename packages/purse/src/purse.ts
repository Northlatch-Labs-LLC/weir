// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import type { SuiGrpcClient } from '@mysten/sui/grpc';
import type { PolicyDoc } from '@projectx-social/policy';
import {
  policySigner,
  type Signer,
  type SimulationPort,
} from '@projectx-social/signer';
import { AuditFile, type PurseAuditLine } from './audit-file.js';
import { buildIntent, nodeGas, type GasPort } from './build.js';
import type { ChainConfig } from './chain.js';
import { intentHash, parseIntent, type Intent } from './intent.js';
import { SpendLedger, outflowsOf } from './ledger-file.js';
import { ruleIdIn, type Refusal } from './outcome.js';
import { requestSchema, type PurseResponse } from './protocol.js';
import { StatementCounter, judgeStatement, statementSha256, statementText, type StatementBounds } from './statement.js';

export interface PurseOptions {
  readonly signer: Signer;
  readonly policy: PolicyDoc;
  readonly policyHash: string;
  readonly policyFileSha256: string;
  readonly chain: ChainConfig;
  readonly client: SuiGrpcClient;
  readonly audit: AuditFile;
  readonly ledger: SpendLedger;
  readonly gas?: GasPort | undefined;
  readonly simulation?: SimulationPort | undefined;
  readonly log?: ((line: string) => void) | undefined;
  readonly statements?: StatementBounds | undefined;
  readonly now?: (() => number) | undefined;
}

export interface Purse {
  readonly address: string;
  readonly policyHash: string;
  readonly handle: (request: unknown) => Promise<PurseResponse>;
  readonly refuseUnread: (refusal: Refusal) => Promise<PurseResponse>;
  readonly auditHead: () => string;
}

export function createPurse(options: PurseOptions): Purse {
  const gas = options.gas ?? nodeGas;
  const log = options.log ?? ((line: string) => process.stderr.write(`${line}\n`));
  const address = options.signer.address;
  const statementCounter = options.statements === undefined ? undefined : new StatementCounter(options.statements.auditPath);

  const signer = policySigner({
    inner: options.signer,
    policy: options.policy,
    client: options.client,
    ledger: () => options.ledger.state(),
    ...(options.simulation === undefined ? {} : { simulation: options.simulation }),
  });

  const record = async (fields: {
    readonly intentKind: string;
    readonly intentHash: string;
    readonly refusal: Refusal | null;
    readonly txDigest: string;
  }): Promise<PurseAuditLine> => {
    const line = await options.audit.append({
      ts: Date.now(),
      address,
      policyHash: options.policyHash,
      policyFileSha256: options.policyFileSha256,
      intentKind: fields.intentKind,
      intentHash: fields.intentHash,
      outcome: fields.refusal === null ? 'signed' : 'refused',
      ruleId: fields.refusal?.ruleId ?? '',
      reason: fields.refusal?.reason ?? '',
      txDigest: fields.txDigest,
    });
    log(
      `purse: ${fields.intentKind} ${line.outcome}` +
        (fields.refusal === null ? ` digest=${fields.txDigest}` : ` rule=${fields.refusal.ruleId}`) +
        ` seq=${String(line.seq)}`,
    );
    return line;
  };

  const refused = async (
    refusal: Refusal,
    about: { readonly intentKind: string; readonly intentHash: string; readonly txDigest: string },
  ): Promise<PurseResponse> => {
    await record({ ...about, refusal });
    return { ok: false, refused: refusal };
  };

  const answer = async (request: unknown): Promise<PurseResponse> => {
    const envelope = requestSchema.safeParse(request);
    if (!envelope.success) {
      return refused(
        {
          ruleId: 'request-malformed',
          reason:
            `the request is not \`{ "intent": … }\`. This purse answers one call and has no other ` +
            `request kind: no key export, no sign-arbitrary-bytes, no policy reload, no health ` +
            `call. An unrecognised field is refused rather than ignored.`,
        },
        { intentKind: 'unparsed', intentHash: '', txDigest: '' },
      );
    }

    const parsed = parseIntent(envelope.data.intent);
    if (!parsed.ok) {
      return refused(
        { ruleId: 'intent-invalid', reason: parsed.reason },
        { intentKind: 'unparsed', intentHash: '', txDigest: '' },
      );
    }

    const intent: Intent = parsed.intent;
    const about = { intentKind: intent.kind, intentHash: intentHash(intent), txDigest: '' };

    if (intent.kind === 'statement') {
      const nowMs = (options.now ?? (() => Date.now()))();
      const refusal = await judgeStatement({
        intent,
        bounds: options.statements,
        counter: statementCounter,
        policy: options.policy,
        nowMs,
      });
      if (refusal !== null) return refused(refusal, about);
      const text = statementText(intent, address);
      const signed = await signer.signPersonalMessage(new TextEncoder().encode(text));
      if (!signed.ok) {
        return refused({ ruleId: 'gate-refused', reason: `the statement could not be signed: ${signed.failure.detail}` }, about);
      }
      const line = await record({ ...about, refusal: null, txDigest: '' });
      statementCounter?.record(line.ts);
      return {
        ok: true,
        statement: text,
        statementSha256: statementSha256(text),
        signature: signed.value,
        address,
        timestampMs: intent.timestampMs,
      };
    }

    const built = buildIntent({
      intent,
      chain: options.chain,
      policy: options.policy,
      sender: address,
      gas,
    });
    if (!built.ok) return refused(built.refused, about);

    const signed = await signer.signTransaction(built.value);
    if (!signed.ok) {
      const detail = signed.failure.detail;
      const ruleId = ruleIdIn(detail);
      return refused(
        ruleId === null
          ? {
              ruleId: 'gate-refused',
              reason:
                `the gate refused before any rule was reached (${signed.failure.kind}): ${detail}`,
            }
          : { ruleId, reason: detail },
        about,
      );
    }

    await options.ledger.record(outflowsOf(signed.value.effects, address));
    await record({ ...about, refusal: null, txDigest: signed.value.txDigest });

    return {
      ok: true,
      digest: signed.value.txDigest,
      txBytesB64: Buffer.from(signed.value.bytes).toString('base64'),
      signature: signed.value.signature,
    };
  };

  let chain: Promise<unknown> = Promise.resolve();
  const inTurn = <T>(work: () => Promise<T>): Promise<T> => {
    const next = chain.then(work, work);
    chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  };

  return {
    address,
    policyHash: options.policyHash,
    auditHead: () => options.audit.headHash,
    refuseUnread: (refusal) =>
      inTurn(async () => {
        try {
          await record({ intentKind: 'unread', intentHash: '', refusal, txDigest: '' });
        } catch {
          // The append failed. Still a value: the caller is a socket handler that must answer.
        }
        return { ok: false, refused: refusal };
      }),
    handle: (request) =>
      inTurn(async () => {
        try {
          return await answer(request);
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          const refusal: Refusal = {
            ruleId: 'gate-refused',
            reason:
              `the purse raised an unexpected error and nothing was signed — ${detail}. This is a ` +
              `fault in the purse rather than a decision about the intent, and it is recorded as a ` +
              `refusal because the intent was in fact refused.`,
          };
          try {
            await record({ intentKind: 'unparsed', intentHash: '', refusal, txDigest: '' });
          } catch {
            // The append itself failed. Still a value, never a throw: the caller is a loop, and the
            // one thing known for certain is that retrying will not help.
          }
          return { ok: false, refused: refusal };
        }
      }),
  };
}
