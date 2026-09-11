// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { canonicalPolicyJson, type PolicyDoc } from '@projectx-social/policy';
import { allow, refuse, type Outcome } from './outcome.js';

const u64 = z.string().regex(/^(0|[1-9][0-9]{0,19})$/, 'not a u64 written as a decimal string');

export const policyDocSchema = z.strictObject({
  version: z.literal(1),
  agentAddress: z.string().regex(/^0x[0-9a-fA-F]{1,64}$/, 'not a Sui address'),
  outflowCeilings: z.array(
    z.strictObject({ coinType: z.string().min(1), maxPerPeriod: u64, periodMs: z.number().int().positive() }),
  ),
  allowedTargets: z.array(z.string().min(1)),
  allowedTypeArguments: z.array(z.string().min(1)),
  allowedRecipients: z.array(z.string().min(1)),
  allowedObjects: z.array(z.string().min(1)),
  approvalThresholds: z
    .array(z.strictObject({ coinType: z.string().min(1), maxWithoutApproval: u64 }))
    .optional(),
  maxGasBudgetMist: u64,
  allowedCommandKinds: z.array(z.string().min(1)),
});

const SETTLEMENT_SUFFIXES = [
  '::soul::settle_epoch',
  '::soul::book_earned',
  '::soul::book_burned',
] as const;

function isSettlement(target: string): boolean {
  return SETTLEMENT_SUFFIXES.some((suffix) => target.endsWith(suffix));
}

export function refuseMixedMoneyPaths(targets: readonly string[]): string | null {
  const settlement = targets.filter(isSettlement);
  if (settlement.length === 0) return null;
  const others = targets.filter((target) => !isSettlement(target));
  if (others.length === 0) return null;

  return (
    `the document allows ${settlement.join(', ')} and also ${others.join(', ')}. One signer per ` +
    `money path: the \`LedgerCap\` that settles an epoch and the key that prices content are ` +
    `different capabilities on different keys under different services (executive decision 6), and ` +
    `a single document naming both would put both money paths behind one signature. A settlement ` +
    `would then consume the content arm's outflow ceiling, and a compromise of either key would ` +
    `reach both. Deploy \`policy/heron-content.json\` to the content purse and ` +
    `\`policy/heron-ledger.json\` to the ledger purse; do not merge them.`
  );
}

export interface PinnedPolicy {
  readonly doc: PolicyDoc;
  readonly fileSha256: string;
  readonly policyHash: string;
}

export async function loadPinnedPolicy(args: {
  readonly path: string;
  readonly expectedSha256: string;
}): Promise<Outcome<PinnedPolicy>> {
  if (!/^[0-9a-f]{64}$/.test(args.expectedSha256)) {
    return refuse(
      'request-malformed',
      `--policy-sha256 must be 64 lowercase hex characters; it is not. The purse will not start ` +
        `without a pin: an unpinned policy is a policy anyone who can write the file can widen.`,
    );
  }

  let bytes: Buffer;
  try {
    bytes = await readFile(args.path);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return refuse('request-malformed', `the policy document at ${args.path} could not be read: ${detail}`);
  }

  const fileSha256 = createHash('sha256').update(bytes).digest('hex');
  if (fileSha256 !== args.expectedSha256) {
    return refuse(
      'request-malformed',
      `the policy document at ${args.path} hashes to ${fileSha256}, and the unit pins ` +
        `${args.expectedSha256}. The purse refuses to start. Either the document was edited without ` +
        `the pin being updated — which is the case this check exists for — or a redeploy was left ` +
        `half done. Changing the policy is a redeploy, not a reload.`,
    );
  }

  let value: unknown;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    return refuse('request-malformed', `the policy document at ${args.path} is not valid JSON.`);
  }

  const parsed = policyDocSchema.safeParse(value);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    return refuse(
      'request-malformed',
      `the policy document at ${args.path} is not a policy: ${problems.join('; ')}.`,
    );
  }

  const doc: PolicyDoc = parsed.data;

  const mixed = refuseMixedMoneyPaths(doc.allowedTargets);
  if (mixed !== null) {
    return refuse('request-malformed', `the policy document at ${args.path} is refused: ${mixed}`);
  }

  return allow({ doc, fileSha256, policyHash: createHash('sha256').update(canonicalPolicyJson(doc), 'utf8').digest('hex') });
}
