// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

export interface OutflowCeiling {
  readonly coinType: string;
  readonly maxPerPeriod: string;
  readonly periodMs: number;
}

export interface ApprovalThreshold {
  readonly coinType: string;
  readonly maxWithoutApproval: string;
}

export interface PolicyDoc {
  readonly version: 1;
  readonly agentAddress: string;
  readonly outflowCeilings: readonly OutflowCeiling[];
  readonly allowedTargets: readonly string[];
  readonly allowedTypeArguments: readonly string[];
  readonly allowedRecipients: readonly string[];
  readonly allowedObjects: readonly string[];
  readonly approvalThresholds?: readonly ApprovalThreshold[] | undefined;
  readonly maxGasBudgetMist: string;
  readonly allowedCommandKinds: readonly string[];
}

export function canonicalPolicyJson(doc: PolicyDoc): string {
  const ceilings = doc.outflowCeilings.map((c) => ({
    coinType: c.coinType,
    maxPerPeriod: c.maxPerPeriod,
    periodMs: c.periodMs,
  }));

  return JSON.stringify({
    version: doc.version,
    agentAddress: doc.agentAddress,
    allowedCommandKinds: [...doc.allowedCommandKinds],
    allowedObjects: Array.isArray(doc.allowedObjects) ? [...doc.allowedObjects] : null,
    allowedRecipients: [...doc.allowedRecipients],
    allowedTargets: [...doc.allowedTargets],
    allowedTypeArguments: [...doc.allowedTypeArguments],
    approvalThresholds: Array.isArray(doc.approvalThresholds)
      ? doc.approvalThresholds.map((t) => ({
          coinType: t.coinType,
          maxWithoutApproval: t.maxWithoutApproval,
        }))
      : null,
    maxGasBudgetMist: doc.maxGasBudgetMist,
    outflowCeilings: ceilings,
  });
}
