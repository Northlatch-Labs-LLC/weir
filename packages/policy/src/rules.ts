// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { outflowMagnitude, parseSignedAmount, parseUnsignedAmount } from './amounts.js';
import type { SimulatedEffects } from './effects.js';
import type { LedgerState } from './ledger.js';
import { normaliseAddress, normaliseTarget, normaliseType } from './names.js';
import type { PolicyDoc } from './policy.js';

export type RuleId =
  | 'policy-version'
  | 'sender-mismatch'
  | 'command-kind'
  | 'move-call-target'
  | 'type-argument'
  | 'transfer-recipient'
  | 'object-input'
  | 'gas-budget'
  | 'balance-evidence'
  | 'amount-wellformed'
  | 'coin-type-unlisted'
  | 'outflow-ceiling'
  | 'approval-threshold';

export interface RuleInput {
  readonly effects: SimulatedEffects;
  readonly policy: PolicyDoc;
  readonly ledger: LedgerState;
}

export interface Rule {
  readonly id: RuleId;
  readonly summary: string;
  readonly check: (input: RuleInput) => string | null;
  readonly approvalRequired?: true;
}

function agentAddress(policy: PolicyDoc): string | null {
  return normaliseAddress(policy.agentAddress);
}

const policyVersion: Rule = {
  id: 'policy-version',
  summary: 'The policy document must declare schema version 1.',
  check: ({ policy }) =>
    policy.version === 1
      ? null
      : `policy document declares version ${String(policy.version)}; this evaluator understands ` +
        `only version 1. Reading a newer document as version 1 would apply the fields it happens ` +
        `to recognise and silently ignore every restriction it does not.`,
};

const senderMismatch: Rule = {
  id: 'sender-mismatch',
  summary: 'The simulated sender must be the address the policy governs.',
  check: ({ effects, policy }) => {
    const expected = agentAddress(policy);
    if (expected === null) {
      return `policy agentAddress ${JSON.stringify(policy.agentAddress)} is not a Sui address.`;
    }
    const actual = normaliseAddress(effects.sender);
    if (actual === null) {
      return `the simulation reports sender ${JSON.stringify(effects.sender)}, which is not a ` +
        `Sui address.`;
    }
    return actual === expected
      ? null
      : `this policy governs ${expected} but the transaction would be signed by ${actual}. ` +
        `A ceiling counted against one address says nothing about spending by another.`;
  },
};

const commandKind: Rule = {
  id: 'command-kind',
  summary: 'Every command kind in the transaction must be explicitly permitted.',
  check: ({ effects, policy }) => {
    const allowed = new Set(policy.allowedCommandKinds);
    for (let i = 0; i < effects.commandKinds.length; i += 1) {
      const kind = effects.commandKinds[i]!;
      if (!allowed.has(kind)) {
        return `command ${i} is a ${kind}, which this policy does not permit. A command kind ` +
          `with no rule of its own — Publish and Upgrade have no target to allow-list and no ` +
          `recipient to check — is refused here rather than passing through unexamined.`;
      }
    }
    return null;
  },
};

const moveCallTarget: Rule = {
  id: 'move-call-target',
  summary: 'Every MoveCall target must appear in the allow-list.',
  check: ({ effects, policy }) => {
    const allowed = new Set<string>();
    for (const entry of policy.allowedTargets) {
      const normalised = normaliseTarget(entry);
      if (normalised === null) {
        return `allowedTargets contains ${JSON.stringify(entry)}, which is not a valid ` +
          `address::module::function. A malformed allow-list entry matches nothing, so the rule ` +
          `it was meant to relax would silently deny for a reason invisible in the policy file.`;
      }
      allowed.add(normalised);
    }

    for (const call of effects.moveCalls) {
      const normalised = normaliseTarget(call.target);
      if (normalised === null) {
        return `command ${call.index} calls ${JSON.stringify(call.target)}, which does not parse ` +
          `as a Move call target.`;
      }
      if (!allowed.has(normalised)) {
        return `command ${call.index} calls ${normalised}, which is not in this policy's ` +
          `allowedTargets. An agent authorised to buy must not also be able to call ` +
          `claim_earnings; nothing on chain distinguishes them, so this list does.`;
      }
    }
    return null;
  },
};

const typeArgument: Rule = {
  id: 'type-argument',
  summary: 'Every type argument of every MoveCall must appear in the allow-list.',
  check: ({ effects, policy }) => {
    const allowed = new Set<string>();
    for (const entry of policy.allowedTypeArguments) {
      const normalised = normaliseType(entry);
      if (normalised === null) {
        return `allowedTypeArguments contains ${JSON.stringify(entry)}, which is not a valid ` +
          `Move type.`;
      }
      allowed.add(normalised);
    }

    for (const call of effects.moveCalls) {
      for (const argument of call.typeArguments) {
        const normalised = normaliseType(argument);
        if (normalised === null) {
          return `command ${call.index} is instantiated with ${JSON.stringify(argument)}, which ` +
            `does not parse as a Move type.`;
        }
        if (!allowed.has(normalised)) {
          return `command ${call.index} is instantiated with ${normalised}, which is not in this ` +
            `policy's allowedTypeArguments. The same function at a different coin type is a ` +
            `different money path, and an allow-list on the target alone does not see the ` +
            `difference.`;
        }
      }
    }
    return null;
  },
};

const transferRecipient: Rule = {
  id: 'transfer-recipient',
  summary: 'Every TransferObjects recipient must appear in the allow-list.',
  check: ({ effects, policy }) => {
    const allowed = new Set<string>();
    for (const entry of policy.allowedRecipients) {
      const normalised = normaliseAddress(entry);
      if (normalised === null) {
        return `allowedRecipients contains ${JSON.stringify(entry)}, which is not a Sui address.`;
      }
      allowed.add(normalised);
    }

    for (const transfer of effects.transfers) {
      const normalised = normaliseAddress(transfer.recipient);
      if (normalised === null) {
        return `command ${transfer.index} transfers to ${JSON.stringify(transfer.recipient)}, ` +
          `which is not a Sui address.`;
      }
      if (!allowed.has(normalised)) {
        return `command ${transfer.index} transfers objects to ${normalised}, which is not in ` +
          `this policy's allowedRecipients. Change coins and purchased entitlements belong back ` +
          `at the agent's own address; any other destination is an exfiltration path that costs ` +
          `no coin balance and so no ceiling would notice it.`;
      }
    }
    return null;
  },
};

const objectInput: Rule = {
  id: 'object-input',
  summary: 'Every object the transaction takes as an input must appear in the allow-list.',
  check: ({ effects, policy }) => {
    if (!Array.isArray(effects.objectInputs)) {
      return `the simulation carries no object-input evidence at all. An empty list and an ` +
        `absent one are different facts — one says this transaction touches no objects, the ` +
        `other says nobody looked — and only the first can be weighed against an allow-list. ` +
        `The vault argument decides who gets paid, so an unexamined input list is an unbounded ` +
        `destination.`;
    }

    const declared = Array.isArray(policy.allowedObjects) ? policy.allowedObjects : [];
    const allowed = new Set<string>();
    for (const entry of declared) {
      const normalised = normaliseAddress(entry);
      if (normalised === null) {
        return `allowedObjects contains ${JSON.stringify(entry)}, which is not a Sui object id. ` +
          `A malformed allow-list entry matches nothing, so the vault it was meant to authorise ` +
          `would be refused and the policy file would look as though it had already permitted it.`;
      }
      allowed.add(normalised);
    }

    for (const input of effects.objectInputs) {
      const where = input.commandIndexes.length === 0
        ? 'referenced by no command this reader recognised'
        : `referenced by command ${input.commandIndexes.join(', ')}`;

      if (input.ownership === 'unclassified') {
        return `input ${String(input.index)}, ${where}, is an object whose shape this reader ` +
          `could not classify, so the id it carries cannot be trusted or compared. It is refused ` +
          `rather than skipped: skipping it would shorten the input list, and a transaction that ` +
          `appears to touch no objects is one this rule has nothing to say about — which is ` +
          `exactly how the argument that decides who gets paid would go past unexamined.`;
      }

      const normalised = normaliseAddress(input.objectId);
      if (normalised === null) {
        return `input ${String(input.index)}, ${where}, names the object ` +
          `${JSON.stringify(input.objectId)}, which is not a Sui object id.`;
      }

      if (!allowed.has(normalised)) {
        return `input ${String(input.index)} is the object ${normalised} (${input.ownership}), ` +
          `${where}, and it is not in this policy's allowedObjects. Every other rule can pass ` +
          `while this one does not: the call can be the permitted creator::unlock, at the ` +
          `permitted coin type, with the Unlock transferred home to the agent and the whole ` +
          `spend inside the ceiling — and still pay a stranger's CreatorVault, because the vault ` +
          `argument is what chooses whose earnings the payment lands in. Anyone can open a vault ` +
          `for 29 SUI, so that destination is attacker-supplied and repeatable, and no ceiling ` +
          `notices it. If ${normalised} is a vault the agent is meant to buy from, add it; the ` +
          `Platform, the Clock and the agent's own SocialAccount belong in the same list.`;
      }
    }
    return null;
  },
};

const gasBudget: Rule = {
  id: 'gas-budget',
  summary: 'The gas budget must not exceed the policy ceiling.',
  check: ({ effects, policy }) => {
    const ceiling = parseUnsignedAmount(policy.maxGasBudgetMist);
    if (ceiling === null) {
      return `policy maxGasBudgetMist is ${JSON.stringify(policy.maxGasBudgetMist)}, which is ` +
        `not an unsigned decimal integer.`;
    }
    const budget = parseUnsignedAmount(effects.gasBudgetMist);
    if (budget === null) {
      return `the simulation reports a gas budget of ${JSON.stringify(effects.gasBudgetMist)}, ` +
        `which is not an unsigned decimal integer.`;
    }
    return budget <= ceiling
      ? null
      : `gas budget ${budget.toString()} MIST exceeds the policy ceiling of ` +
        `${ceiling.toString()} MIST. Gas is spendable value that leaves the agent whether the ` +
        `transaction succeeds or aborts, so an unbounded budget is an unbounded loss on a ` +
        `transaction that buys nothing.`;
  },
};

const balanceEvidence: Rule = {
  id: 'balance-evidence',
  summary: 'Balance changes must have been observed, not merely absent.',
  check: ({ effects }) =>
    effects.balanceChangesObserved
      ? null
      : `the simulation carries no balance-change evidence. An empty list of changes and a list ` +
        `that was never requested are different facts — one says this transaction moves no ` +
        `money, the other says we do not know what it moves — and only the first is safe to ` +
        `weigh against a spending ceiling.`,
};

const amountWellformed: Rule = {
  id: 'amount-wellformed',
  summary: 'Every reported balance-change amount must parse as a decimal integer.',
  check: ({ effects }) => {
    for (const change of effects.balanceChanges) {
      if (parseSignedAmount(change.amount) === null) {
        return `a balance change for ${change.coinType} reports the amount ` +
          `${JSON.stringify(change.amount)}, which is not a decimal integer. BigInt('') is 0n, ` +
          `so an unchecked parse would turn an unreadable amount into a zero outflow and report ` +
          `that a spend did not happen.`;
      }
    }
    return null;
  },
};

function agentOutflows(
  effects: SimulatedEffects,
  agent: string,
): Map<string, bigint> | { readonly error: string } {
  const totals = new Map<string, bigint>();

  for (const change of effects.balanceChanges) {
    const address = normaliseAddress(change.address);
    if (address === null) {
      return { error: `a balance change names ${JSON.stringify(change.address)}, not an address.` };
    }
    if (address !== agent) continue;

    const amount = parseSignedAmount(change.amount);
    if (amount === null) continue;

    const magnitude = outflowMagnitude(amount);
    if (magnitude === null) continue;

    const coinType = normaliseType(change.coinType);
    if (coinType === null) {
      return {
        error: `a balance change names the coin type ${JSON.stringify(change.coinType)}, which ` +
          `does not parse as a Move type, so no ceiling can be matched to it.`,
      };
    }

    totals.set(coinType, (totals.get(coinType) ?? 0n) + magnitude);
  }

  return totals;
}

function isError(value: unknown): value is { readonly error: string } {
  return typeof value === 'object' && value !== null && 'error' in value;
}

const coinTypeUnlisted: Rule = {
  id: 'coin-type-unlisted',
  summary: 'A coin type with no configured ceiling may not leave the agent at all.',
  check: ({ effects, policy }) => {
    const agent = agentAddress(policy);
    if (agent === null) return `policy agentAddress is not a Sui address.`;

    const outflows = agentOutflows(effects, agent);
    if (isError(outflows)) return outflows.error;

    const configured = new Set<string>();
    for (const ceiling of policy.outflowCeilings) {
      const coinType = normaliseType(ceiling.coinType);
      if (coinType === null) {
        return `an outflowCeiling names the coin type ${JSON.stringify(ceiling.coinType)}, which ` +
          `is not a valid Move type. A ceiling that cannot be matched to a coin is a ceiling ` +
          `that never applies.`;
      }
      configured.add(coinType);
    }

    for (const [coinType, magnitude] of outflows) {
      if (!configured.has(coinType)) {
        return `${magnitude.toString()} of ${coinType} would leave the agent, and this policy ` +
          `configures no ceiling for that coin type. An unlisted coin is refused rather than ` +
          `treated as unlimited: a policy author who enumerates what an agent may spend has ` +
          `said nothing about the token they had never heard of.`;
      }
    }
    return null;
  },
};

function priorInWindow(
  ledger: LedgerState,
  coinType: string,
  periodMs: number,
): bigint | { readonly error: string } {
  const windowStart = ledger.nowMs - periodMs;
  let prior = 0n;

  for (const entry of ledger.spend) {
    const entryCoinType = normaliseType(entry.coinType);
    if (entryCoinType === null) {
      return {
        error: `a ledger entry names the coin type ${JSON.stringify(entry.coinType)}, which ` +
          `does not parse. An unreadable record of past spending must not be counted as zero.`,
      };
    }
    if (entryCoinType !== coinType) continue;
    if (entry.atMs < windowStart || entry.atMs > ledger.nowMs) continue;

    const amount = parseUnsignedAmount(entry.amountOut);
    if (amount === null) {
      return {
        error: `a ledger entry for ${coinType} records ${JSON.stringify(entry.amountOut)}, ` +
          `which is not an unsigned decimal integer.`,
      };
    }
    prior += amount;
  }

  return prior;
}

const outflowCeiling: Rule = {
  id: 'outflow-ceiling',
  summary: 'Prior spend in the rolling window plus this outflow must stay under the ceiling.',
  check: ({ effects, policy, ledger }) => {
    const agent = agentAddress(policy);
    if (agent === null) return `policy agentAddress is not a Sui address.`;

    const outflows = agentOutflows(effects, agent);
    if (isError(outflows)) return outflows.error;

    for (const ceiling of policy.outflowCeilings) {
      const coinType = normaliseType(ceiling.coinType);
      if (coinType === null) {
        return `an outflowCeiling names the coin type ${JSON.stringify(ceiling.coinType)}, ` +
          `which is not a valid Move type.`;
      }

      const limit = parseUnsignedAmount(ceiling.maxPerPeriod);
      if (limit === null) {
        return `the ceiling for ${coinType} is ${JSON.stringify(ceiling.maxPerPeriod)}, which ` +
          `is not an unsigned decimal integer.`;
      }

      if (!Number.isInteger(ceiling.periodMs) || ceiling.periodMs <= 0) {
        return `the ceiling for ${coinType} declares periodMs ${String(ceiling.periodMs)}. A ` +
          `window that is zero, negative or fractional cannot contain a prior spend, so the ` +
          `ceiling would apply to this transaction alone and a loop would defeat it.`;
      }

      const prior = priorInWindow(ledger, coinType, ceiling.periodMs);
      if (isError(prior)) return prior.error;

      const now = outflows.get(coinType) ?? 0n;
      const total = prior + now;
      if (total > limit) {
        return `this transaction would put ${total.toString()} of ${coinType} out in the last ` +
          `${String(ceiling.periodMs)}ms (${prior.toString()} already spent, ${now.toString()} ` +
          `now), above the ceiling of ${limit.toString()}. Note that on SUI this figure includes ` +
          `gas, because gas is an outflow the node reports like any other.`;
      }
    }
    return null;
  },
};

const approvalThreshold: Rule = {
  id: 'approval-threshold',
  approvalRequired: true,
  summary: "A windowed total above the operator's bar needs a live approval from the operator.",
  check: ({ effects, policy, ledger }) => {
    const thresholds = policy.approvalThresholds;
    if (thresholds === undefined) return null;
    if (!Array.isArray(thresholds)) {
      return `approvalThresholds is present and is not a list. A policy document arrives as JSON, ` +
        `where a field can be any shape; a bar this evaluator cannot read is refused rather than ` +
        `skipped, because skipping it signs unattended exactly what the operator asked to see.`;
    }

    const agent = agentAddress(policy);
    if (agent === null) return `policy agentAddress is not a Sui address.`;

    const outflows = agentOutflows(effects, agent);
    if (isError(outflows)) return outflows.error;

    for (const threshold of thresholds) {
      const coinType = normaliseType(threshold.coinType);
      if (coinType === null) {
        return `an approvalThreshold names the coin type ${JSON.stringify(threshold.coinType)}, ` +
          `which is not a valid Move type. A bar that cannot be matched to a coin is a bar that ` +
          `never asks anybody.`;
      }

      const bar = parseUnsignedAmount(threshold.maxWithoutApproval);
      if (bar === null) {
        return `the approval threshold for ${coinType} is ` +
          `${JSON.stringify(threshold.maxWithoutApproval)}, which is not an unsigned decimal ` +
          `integer. BigInt('') is 0n, and a bar that silently became zero would ask the operator ` +
          `about every transaction until somebody switched the gate off.`;
      }

      let ceiling: { readonly maxPerPeriod: string; readonly periodMs: number } | null = null;
      for (const candidate of policy.outflowCeilings) {
        const candidateType = normaliseType(candidate.coinType);
        if (candidateType === null) {
          return `an outflowCeiling names the coin type ${JSON.stringify(candidate.coinType)}, ` +
            `which is not a valid Move type, so no approval bar can borrow its window.`;
        }
        if (candidateType === coinType) ceiling = candidate;
      }
      if (ceiling === null) {
        return `this policy sets an approval threshold for ${coinType} and no ceiling for it. A ` +
          `threshold is measured over its ceiling's rolling window, so there is no window to ` +
          `measure this one over.`;
      }

      if (!Number.isInteger(ceiling.periodMs) || ceiling.periodMs <= 0) {
        return `the ceiling for ${coinType} declares periodMs ${String(ceiling.periodMs)}, which ` +
          `is not a positive integer, so the approval bar that borrows its window cannot be ` +
          `measured either.`;
      }

      const limit = parseUnsignedAmount(ceiling.maxPerPeriod);
      if (limit === null) {
        return `the ceiling for ${coinType} is ${JSON.stringify(ceiling.maxPerPeriod)}, which is ` +
          `not an unsigned decimal integer, so the approval bar cannot be compared against it.`;
      }
      if (bar >= limit) {
        return `the approval threshold for ${coinType} is ${bar.toString()} and the ceiling is ` +
          `${limit.toString()}. Every total that crosses that bar is already refused by the ` +
          `ceiling, so the operator would never be asked about anything — a gate that cannot ` +
          `fire, in a document its author would read as one that does. Lower the threshold below ` +
          `the ceiling, or remove it.`;
      }

      const prior = priorInWindow(ledger, coinType, ceiling.periodMs);
      if (isError(prior)) return prior.error;

      const now = outflows.get(coinType) ?? 0n;
      const total = prior + now;
      if (total <= bar) continue;

      const approvals = ledger.approvals;
      if (approvals !== undefined && !Array.isArray(approvals)) {
        return `the ledger's approvals field is present and is not a list, so no approval can be ` +
          `read from it.`;
      }

      let covered = false;
      for (const approval of approvals ?? []) {
        const approvedType = normaliseType(approval.coinType);
        if (approvedType === null) {
          return `an operator approval names the coin type ${JSON.stringify(approval.coinType)}, ` +
            `which is not a valid Move type. An approval that cannot be matched to a coin is not ` +
            `read as an approval of everything.`;
        }
        if (approvedType !== coinType) continue;

        const amount = parseUnsignedAmount(approval.maxAmount);
        if (amount === null) {
          return `an operator approval for ${coinType} covers ` +
            `${JSON.stringify(approval.maxAmount)}, which is not an unsigned decimal integer.`;
        }
        if (!Number.isInteger(approval.expiresAtMs)) {
          return `an operator approval for ${coinType} expires at ` +
            `${String(approval.expiresAtMs)}, which is not an integer millisecond. An approval ` +
            `whose lifetime cannot be read is not treated as one that has not expired.`;
        }
        if (ledger.nowMs >= approval.expiresAtMs) continue;
        if (amount < total) continue;

        covered = true;
        break;
      }

      if (!covered) {
        return `this transaction would put ${total.toString()} of ${coinType} out in the last ` +
          `${String(ceiling.periodMs)}ms (${prior.toString()} already spent, ${now.toString()} ` +
          `now), above the ${bar.toString()} this policy lets the agent spend unattended. It is ` +
          `inside the ceiling, so the operator may approve it — an approval for at least ` +
          `${total.toString()} of ${coinType}, still live at ${String(ledger.nowMs)}, permits it. ` +
          `Widening the policy is the other answer, and it is the one the audit trail records.`;
      }
    }
    return null;
  },
};

export const RULES: readonly Rule[] = [
  policyVersion,
  senderMismatch,
  commandKind,
  moveCallTarget,
  typeArgument,
  transferRecipient,
  objectInput,
  gasBudget,
  balanceEvidence,
  amountWellformed,
  coinTypeUnlisted,
  outflowCeiling,
  approvalThreshold,
];
