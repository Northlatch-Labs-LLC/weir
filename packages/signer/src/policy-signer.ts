// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import type { SuiGrpcClient } from '@mysten/sui/grpc';
import { Transaction } from '@mysten/sui/transactions';
import { fail, ok, simulate, type DecodedAbort, type Reading } from '@projectx-social/sdk';
import {
  canonicalPolicyJson,
  evaluate,
  type Decision,
  type LedgerState,
  type PolicyDoc,
  type SimulatedEffects,
} from '@projectx-social/policy';
import { AuditLog, policyHash, type AuditEntry } from './audit.js';
import { buildBytes, grpcSimulation, type SimulationPort } from './evidence.js';
import type { SerializedSignature, Signer } from './signer.js';

export interface PolicySignerOptions {
  readonly inner: Signer;
  readonly policy: PolicyDoc;
  readonly client: SuiGrpcClient;
  readonly ledger: () => LedgerState;
  readonly audit?: AuditLog;
  readonly simulation?: SimulationPort;
}

export interface SignedTransaction {
  readonly signature: SerializedSignature;
  readonly bytes: Uint8Array;
  readonly txDigest: string;
  readonly effects: SimulatedEffects;
  readonly auditEntry: AuditEntry;
}

export interface PolicySigner {
  readonly address: string;
  readonly signTransaction: (transaction: Transaction | Uint8Array) => Promise<Reading<SignedTransaction>>;
  readonly signPersonalMessage: (bytes: Uint8Array) => Promise<Reading<SerializedSignature>>;
  readonly audit: AuditLog;
  readonly policyHash: string;
}

export function policySigner(options: PolicySignerOptions): PolicySigner {
  const audit = options.audit ?? new AuditLog();
  const simulation = options.simulation ?? grpcSimulation(options.client);
  const hash = policyHash(canonicalPolicyJson(options.policy));
  const address = options.inner.address;
  const source = `policy signer ${address}`;

  const refuse = <T>(
    kind: Parameters<typeof fail>[0],
    reason: string,
    txDigest: string,
  ): Reading<T> => {
    audit.append({
      ts: Date.now(),
      address,
      txDigest,
      policyHash: hash,
      decision: 'deny',
      reason,
    });
    return fail<T>(kind, source, reason);
  };

  const refuseUnexpected = <T>(error: unknown): Reading<T> => {
    const detail = error instanceof Error ? error.message : String(error);
    const reason =
      `refused: the gate raised an unexpected error and nothing was signed — ${detail}. This is ` +
      `a fault in the policy evaluation or the ledger read rather than a decision about the ` +
      `transaction, and it is recorded as a denial because the transaction was in fact denied.`;
    try {
      return refuse<T>('malformed', reason, '');
    } catch {
      return fail<T>('malformed', source, reason);
    }
  };

  /*
    Bytes, or a Transaction to build into bytes.

    The caller in @projectx-social/agent builds once, on purpose, so that the bytes it simulates are
    the bytes it submits, and it checks afterwards that the signature came back over those same
    bytes. It therefore hands this signer a Uint8Array. Taking only a Transaction meant
    `setSenderIfNotSet` was called on an array, which is not a function on one: every write that
    passes through a policy — pricing, buying, subscribing — failed with that message before a
    single byte was simulated.

    Given bytes there is nothing to build, so the build step is skipped rather than re-done. The SDK
    gate below still needs a Transaction, and it gets one reconstructed from these exact bytes: the
    sender and gas budget are already in them, so building it again reproduces them rather than
    inventing a second transaction to simulate.
  */
  const attemptSign = async (
    transaction: Transaction | Uint8Array,
  ): Promise<Reading<SignedTransaction>> => {
    let bytes: Uint8Array;
    let forGate: Transaction;
    if (transaction instanceof Uint8Array) {
      bytes = transaction;
      forGate = Transaction.from(bytes);
    } else {
      const built = await buildBytes(options.client, transaction, address);
      if (!built.ok) {
        return refuse('malformed', `refused before simulation: ${built.failure.detail}`, '');
      }
      bytes = built.value;
      forGate = transaction;
    }

    const observed = await simulation.observe({ transactionBytes: bytes, sender: address });
    if (!observed.ok) {
      return refuse(
        observed.failure.kind,
        `the simulation could not be read, so nothing was signed: ${observed.failure.detail}`,
        '',
      );
    }
    const evidence = observed.value;

    if (!evidence.wouldSucceed) {
      return refuse(
        'malformed',
        `the transaction would abort, so it was not signed: ${explainAbort(evidence.abort, evidence.status)}`,
        evidence.txDigest,
      );
    }

    const verdict = await simulate(options.client, forGate, address);
    if (!verdict.ok) {
      return refuse(
        verdict.failure.kind,
        `the SDK simulation gate did not confirm success (${verdict.failure.kind}): ` +
          `${verdict.failure.detail} — note that on @mysten/sui 2.27.1 gRPC this is also what ` +
          `a genuine abort looks like through that function, because a failing simulation is ` +
          `returned under FailedTransaction and simulate() reads only Transaction.`,
        evidence.txDigest,
      );
    }
    if (!verdict.value.wouldSucceed) {
      return refuse(
        'malformed',
        `the SDK simulation gate reports the transaction would fail: ${verdict.value.status}`,
        evidence.txDigest,
      );
    }

    const decision: Decision = evaluate(evidence.effects, options.policy, options.ledger());
    if (!decision.allow) {
      return refuse('unconfigured', decision.reason, evidence.txDigest);
    }

    const auditEntry = audit.append({
      ts: Date.now(),
      address,
      txDigest: evidence.txDigest,
      policyHash: hash,
      decision: 'allow',
      reason: '',
    });

    const signature = await options.inner.signTransaction(bytes);
    if (!signature.ok) {
      return refuse(
        signature.failure.kind,
        `the policy permitted this transaction and the signer could not produce a signature: ` +
          `${signature.failure.detail}`,
        evidence.txDigest,
      );
    }

    return ok({
      signature: signature.value,
      bytes,
      txDigest: evidence.txDigest,
      effects: evidence.effects,
      auditEntry,
    });
  };

  return {
    address,
    audit,
    policyHash: hash,

    signTransaction: async (transaction) => {
      try {
        return await attemptSign(transaction);
      } catch (error) {
        return refuseUnexpected<SignedTransaction>(error);
      }
    },

    signPersonalMessage: async (bytes) => {
      try {
        const signature = await options.inner.signPersonalMessage(bytes);
        if (!signature.ok) {
          return refuse(
            signature.failure.kind,
            `a personal message could not be signed: ${signature.failure.detail}`,
            '',
          );
        }
        audit.append({
          ts: Date.now(),
          address,
          txDigest: '',
          policyHash: hash,
          decision: 'allow',
          reason: 'personal message; no effects to evaluate',
        });
        return ok(signature.value);
      } catch (error) {
        return refuseUnexpected<SerializedSignature>(error);
      }
    },
  };
}

function explainAbort(abort: DecodedAbort | undefined, status: string): string {
  if (abort === undefined) return status;
  if (abort.explanation !== null) {
    return `${abort.module} abort ${abort.code} — ${abort.explanation} (${abort.raw})`;
  }
  return abort.raw;
}
