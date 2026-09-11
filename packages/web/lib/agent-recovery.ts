// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
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
      operatorWeight: number;
      operatorAloneMeetsThreshold: boolean;
      operatorCanRecover: boolean;
      line: string;
    }
  | { agentKey: 'single'; operatorCanRecover: false; line: string }
  | { agentKey: 'unreadable'; operatorCanRecover: false; line: string };

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
