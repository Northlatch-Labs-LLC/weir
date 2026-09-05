// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/**
 * Whether the operator named in a declaration could act for the agent if the agent's key were lost.
 *
 * # Read from the evidence already on file, never from a claim
 *
 * A declaration is two signatures. The agent's half was produced by the agent's key, and a Sui
 * signature carries its own public key: a single-key signature carries one, a multisig signature
 * carries the whole committee — every member key, its weight and the threshold — because that is
 * what the verifier needs to reconstruct the address. So the register already holds the answer to
 * "who else can sign as this agent" in the bytes it stores, and this module reads it from there.
 *
 * Nothing here is taken from the request or from a column somebody could edit. The committee is
 * decoded from the stored signature, the address is rebuilt from the committee, and the operator
 * is looked for among the members. A reader who does not trust this deployment can repeat every
 * step from `GET /api/agents/{address}` alone.
 *
 * # What "recover" means, stated exactly
 *
 * An operator is a *member* when one of the committee keys derives to the operator's address. That
 * member can take part in signing for the agent's address. Whether they can do it *alone* is a
 * second, narrower fact — their weight meets the threshold — and it is reported separately, so
 * "holds a key" is never read as "holds control".
 *
 * A single-key agent has no committee, so its operator cannot recover it by construction. That is
 * not a defect in the declaration; it is a fact a sponsor should see before paying for a seat, and
 * it is the sentence the roadmap asked for.
 */
import { parseSerializedSignature } from '@mysten/sui/cryptography';
import { MultiSigPublicKey } from '@mysten/sui/multisig';
import { normaliseAddress } from '@/lib/db';

export const CANNOT_RECOVER = 'operator cannot recover this agent';

export type Recovery =
  | {
      agentKey: 'multisig';
      threshold: number;
      members: number;
      operatorIsMember: boolean;
      /** The operator's own weight, when a member; `0` otherwise. */
      operatorWeight: number;
      /** True only when the operator's weight alone reaches the threshold. */
      operatorAloneMeetsThreshold: boolean;
      operatorCanRecover: boolean;
      line: string;
    }
  | { agentKey: 'single'; operatorCanRecover: false; line: string }
  | { agentKey: 'unreadable'; operatorCanRecover: false; line: string };

/**
 * The recovery facts for one declaration.
 *
 * `agentSignature` is the stored agent half (base64). `operatorAddress` is the declared operator.
 * The function never throws: a signature that cannot be decoded is reported as `unreadable`, which
 * is a fact about the row worth surfacing rather than a reason to hide the whole record.
 */
export function recoveryOf(agentSignature: string, operatorAddress: string): Recovery {
  let parsed: ReturnType<typeof parseSerializedSignature>;
  try {
    parsed = parseSerializedSignature(agentSignature);
  } catch {
    return {
      agentKey: 'unreadable',
      operatorCanRecover: false,
      line: `${CANNOT_RECOVER}: the stored agent signature could not be decoded`,
    };
  }

  if (parsed.signatureScheme !== 'MultiSig') {
    return {
      agentKey: 'single',
      operatorCanRecover: false,
      line: `${CANNOT_RECOVER}: its address is a single key, held by the agent alone`,
    };
  }

  let committee: MultiSigPublicKey;
  try {
    committee = new MultiSigPublicKey(parsed.multisig.multisig_pk);
  } catch {
    return {
      agentKey: 'unreadable',
      operatorCanRecover: false,
      line: `${CANNOT_RECOVER}: the multisig committee in the stored signature could not be decoded`,
    };
  }

  const operator = normaliseAddress(operatorAddress);
  const threshold = committee.getThreshold();
  const members = committee.getPublicKeys();
  const own = members.find((m) => normaliseAddress(m.publicKey.toSuiAddress()) === operator);
  const operatorWeight = own?.weight ?? 0;
  const operatorIsMember = own !== undefined;
  const operatorAloneMeetsThreshold = operatorIsMember && operatorWeight >= threshold;

  const line = operatorIsMember
    ? operatorAloneMeetsThreshold
      ? `operator holds a key of the agent's ${members.length}-key multisig and can sign for it alone (weight ${operatorWeight} of threshold ${threshold})`
      : `operator holds a key of the agent's ${members.length}-key multisig (weight ${operatorWeight} of threshold ${threshold}); recovery needs the other members`
    : `${CANNOT_RECOVER}: the operator is not a member of the agent's ${members.length}-key multisig`;

  return {
    agentKey: 'multisig',
    threshold,
    members: members.length,
    operatorIsMember,
    operatorWeight,
    operatorAloneMeetsThreshold,
    operatorCanRecover: operatorIsMember,
    line,
  };
}
