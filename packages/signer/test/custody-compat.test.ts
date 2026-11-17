// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { describe, expect, it } from 'vitest';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Secp256r1Keypair } from '@mysten/sui/keypairs/secp256r1';
import { MultiSigPublicKey } from '@mysten/sui/multisig';
import { verifyPersonalMessageSignature } from '@mysten/sui/verify';
import { SessionKey } from '@mysten/seal';
import { multiSigSigner } from '../src/index.js';
import { signerFor } from './helpers.js';

const MESSAGE = new TextEncoder().encode('weir agent proves control of its address');

function custodyFloor() {
  const hot = Ed25519Keypair.generate();
  const cold = Ed25519Keypair.generate();
  const multiSigPublicKey = MultiSigPublicKey.fromPublicKeys({
    threshold: 1,
    publicKeys: [
      { publicKey: hot.getPublicKey(), weight: 1 },
      { publicKey: cold.getPublicKey(), weight: 1 },
    ],
  });
  return { hot, cold, multiSigPublicKey };
}

describe('TO CONFIRM 1 — does verifyPersonalMessageSignature accept a MultiSig signature?', () => {
  it('accepts one, and resolves it to the multisig address', async () => {
    const { hot, cold, multiSigPublicKey } = custodyFloor();

    const signer = multiSigSigner({
      threshold: 1,
      members: [
        { publicKey: hot.getPublicKey(), weight: 1 },
        { publicKey: cold.getPublicKey(), weight: 1 },
      ],
      available: [signerFor(hot)],
    });
    expect(signer.ok).toBe(true);
    if (!signer.ok) throw new Error('unreachable');

    const signature = await signer.value.signPersonalMessage(MESSAGE);
    expect(signature.ok).toBe(true);
    if (!signature.ok) throw new Error('unreachable');

    const publicKey = await verifyPersonalMessageSignature(MESSAGE, signature.value, {
      address: multiSigPublicKey.toSuiAddress(),
    });
    expect(publicKey.toSuiAddress()).toBe(multiSigPublicKey.toSuiAddress());
    expect(signer.value.address).toBe(multiSigPublicKey.toSuiAddress());
  });

  it('rejects a signature over different bytes, so this is verification and not a shape check', async () => {
    const { hot, cold } = custodyFloor();
    const signer = multiSigSigner({
      threshold: 1,
      members: [
        { publicKey: hot.getPublicKey(), weight: 1 },
        { publicKey: cold.getPublicKey(), weight: 1 },
      ],
      available: [signerFor(hot)],
    });
    if (!signer.ok) throw new Error('unreachable');
    const signature = await signer.value.signPersonalMessage(MESSAGE);
    if (!signature.ok) throw new Error('unreachable');

    await expect(
      verifyPersonalMessageSignature(new TextEncoder().encode('different'), signature.value),
    ).rejects.toThrow();
  });

  it('rejects a below-threshold combination — proving the threshold is really enforced', async () => {
    const hot = Ed25519Keypair.generate();
    const cold = Ed25519Keypair.generate();
    const multiSigPublicKey = MultiSigPublicKey.fromPublicKeys({
      threshold: 2,
      publicKeys: [
        { publicKey: hot.getPublicKey(), weight: 1 },
        { publicKey: cold.getPublicKey(), weight: 1 },
      ],
    });

    const signer = multiSigSigner({
      threshold: 2,
      members: [
        { publicKey: hot.getPublicKey(), weight: 1 },
        { publicKey: cold.getPublicKey(), weight: 1 },
      ],
      available: [signerFor(hot)],
    });
    if (!signer.ok) throw new Error('unreachable');

    const signature = await signer.value.signPersonalMessage(MESSAGE);
    expect(signature.ok).toBe(false);
    if (signature.ok) throw new Error('unreachable');
    expect(signature.failure.kind).toBe('unconfigured');
    expect(signature.failure.detail).toContain('1 of the 2 weight required');
    expect(multiSigPublicKey.getThreshold()).toBe(2);
  });
});

describe("TO CONFIRM 2 — does @mysten/seal 1.5.4's SessionKey accept a multisig or secp256r1 signer?", () => {
  const PACKAGE_ID = `0x${'0'.repeat(63)}1`;
  const stubClient = {
    core: { getObject: async () => ({ object: { version: '1' } }) },
  } as unknown as Parameters<typeof SessionKey.create>[0]['suiClient'];

  it('accepts a MultiSigSigner, and the certificate carries the multisig signature', async () => {
    const { hot, cold, multiSigPublicKey } = custodyFloor();
    const address = multiSigPublicKey.toSuiAddress();

    const { MultiSigSigner } = await import('@mysten/sui/multisig');
    const mystenSigner = new MultiSigSigner(multiSigPublicKey, [hot]);

    const sessionKey = await SessionKey.create({
      address,
      packageId: PACKAGE_ID,
      ttlMin: 10,
      signer: mystenSigner,
      suiClient: stubClient,
    });

    const certificate = await sessionKey.getCertificate();
    expect(certificate.user).toBe(address);
    expect(certificate.signature.length).toBeGreaterThan(0);

    const second = await SessionKey.create({
      address,
      packageId: PACKAGE_ID,
      ttlMin: 10,
      suiClient: stubClient,
    });
    const signed = await mystenSigner.signPersonalMessage(second.getPersonalMessage());
    await expect(second.setPersonalMessageSignature(signed.signature)).resolves.toBeUndefined();
    expect((await second.getCertificate()).signature).toBe(signed.signature);
    expect(cold.getPublicKey().toSuiAddress()).not.toBe(address);
  });

  it('accepts a secp256r1 signer', async () => {
    const keypair = Secp256r1Keypair.generate();
    const address = keypair.toSuiAddress();

    const sessionKey = await SessionKey.create({
      address,
      packageId: PACKAGE_ID,
      ttlMin: 10,
      signer: keypair,
      suiClient: stubClient,
    });

    const certificate = await sessionKey.getCertificate();
    expect(certificate.user).toBe(address);

    const verified = await verifyPersonalMessageSignature(
      sessionKey.getPersonalMessage(),
      certificate.signature,
      { address },
    );
    expect(verified.toSuiAddress()).toBe(address);
  });

  it('records the seal 1.5 contract: a mismatched signer is accepted (address alias), so the identity binding is the consumer’s to enforce', async () => {
    const signer = Ed25519Keypair.generate();
    const claimedAddress = Ed25519Keypair.generate().toSuiAddress();
    expect(claimedAddress).not.toBe(signer.getPublicKey().toSuiAddress());

    // Pinned against @mysten/seal 1.4.6, this probe asserted the opposite: SessionKey.create refused
    // a signer whose address differed from the session address ("does not match"). seal 1.5.0
    // (changelog 0cd291e) replaced that rejection on purpose — address-alias support — so create()
    // no longer compares the two. The answer changed upstream, so the question is re-pinned here.
    const sessionKey = await SessionKey.create({
      address: claimedAddress,
      packageId: PACKAGE_ID,
      ttlMin: 10,
      signer,
      suiClient: stubClient,
    });
    const certificate = await sessionKey.getCertificate();

    // The certificate names the CLAIMED address as its user while the signature belongs to the
    // signer's key — nothing upstream binds the two any more. Both real consumers in this estate
    // bind identity by construction and need no library guard: the web session helper keys every
    // session off input.signer.address, and the agent passes its own address. That is where the
    // floor lives now; a consumer that passes a caller-chosen address mints a certificate for it.
    expect(certificate.user).toBe(claimedAddress);
    const signerAddress = signer.getPublicKey().toSuiAddress();
    const verified = await verifyPersonalMessageSignature(
      sessionKey.getPersonalMessage(),
      certificate.signature,
      { address: signerAddress },
    );
    expect(verified.toSuiAddress()).toBe(signerAddress);
  });
});

