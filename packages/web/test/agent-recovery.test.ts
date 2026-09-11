// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { describe, expect, it } from 'vitest';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { MultiSigPublicKey } from '@mysten/sui/multisig';
import { verifyPersonalMessageSignature } from '@mysten/sui/verify';
import { CANNOT_RECOVER, recoveryOf } from '../lib/agent-recovery';

const MESSAGE = new TextEncoder().encode('weir.social\naction: declare agent\nissued: 1');

async function multisigSignature(input: {
  signer: Ed25519Keypair;
  members: Array<{ key: Ed25519Keypair; weight: number }>;
  threshold: number;
}): Promise<{ signature: string; address: string }> {
  const committee = MultiSigPublicKey.fromPublicKeys({
    threshold: input.threshold,
    publicKeys: input.members.map((m) => ({ publicKey: m.key.getPublicKey(), weight: m.weight })),
  });
  const partial = await input.signer.signPersonalMessage(MESSAGE);
  const signature = committee.combinePartialSignatures([partial.signature]);
  await verifyPersonalMessageSignature(MESSAGE, signature, { address: committee.toSuiAddress() });
  return { signature, address: committee.toSuiAddress() };
}

describe('recoveryOf', () => {
  it('a single-key agent cannot be recovered by its operator', async () => {
    const agent = new Ed25519Keypair();
    const operator = new Ed25519Keypair();
    const { signature } = await agent.signPersonalMessage(MESSAGE);
    const r = recoveryOf(signature, operator.toSuiAddress());
    expect(r.agentKey).toBe('single');
    expect(r.operatorCanRecover).toBe(false);
    expect(r.line).toContain(CANNOT_RECOVER);
  });

  it('an operator who is a member of the agent multisig holds a key of it', async () => {
    const agentKey = new Ed25519Keypair();
    const operator = new Ed25519Keypair();
    const { signature } = await multisigSignature({
      signer: agentKey,
      members: [{ key: agentKey, weight: 1 }, { key: operator, weight: 1 }],
      threshold: 1,
    });
    const r = recoveryOf(signature, operator.toSuiAddress());
    expect(r.agentKey).toBe('multisig');
    if (r.agentKey !== 'multisig') return;
    expect(r.operatorIsMember).toBe(true);
    expect(r.operatorCanRecover).toBe(true);
    expect(r.operatorAloneMeetsThreshold).toBe(true);
    expect(r).toMatchObject({ members: 2, threshold: 1, operatorWeight: 1 });
    expect(r.line).not.toContain(CANNOT_RECOVER);
  });

  it('a member below the threshold holds a key but cannot sign alone', async () => {
    const agentKey = new Ed25519Keypair();
    const operator = new Ed25519Keypair();
    const third = new Ed25519Keypair();
    const committee = MultiSigPublicKey.fromPublicKeys({
      threshold: 2,
      publicKeys: [agentKey, operator, third].map((k) => ({ publicKey: k.getPublicKey(), weight: 1 })),
    });
    const a = await agentKey.signPersonalMessage(MESSAGE);
    const t = await third.signPersonalMessage(MESSAGE);
    const signature = committee.combinePartialSignatures([a.signature, t.signature]);
    await verifyPersonalMessageSignature(MESSAGE, signature, { address: committee.toSuiAddress() });

    const r = recoveryOf(signature, operator.toSuiAddress());
    expect(r.agentKey).toBe('multisig');
    if (r.agentKey !== 'multisig') return;
    expect(r.operatorIsMember).toBe(true);
    expect(r.operatorAloneMeetsThreshold).toBe(false);
    expect(r.line).toContain('needs the other members');
  });

  it('an operator outside the committee cannot recover the agent', async () => {
    const agentKey = new Ed25519Keypair();
    const other = new Ed25519Keypair();
    const operator = new Ed25519Keypair();
    const { signature } = await multisigSignature({
      signer: agentKey,
      members: [{ key: agentKey, weight: 1 }, { key: other, weight: 1 }],
      threshold: 1,
    });
    const r = recoveryOf(signature, operator.toSuiAddress());
    expect(r.agentKey).toBe('multisig');
    expect(r.operatorCanRecover).toBe(false);
    expect(r.line).toContain(CANNOT_RECOVER);
    expect(r.line).toContain('not a member');
  });

  it('a signature that cannot be decoded is unreadable, never a silent single', () => {
    const r = recoveryOf('not a signature', `0x${'ab'.repeat(32)}`);
    expect(r.agentKey).toBe('unreadable');
    expect(r.operatorCanRecover).toBe(false);
  });
});
