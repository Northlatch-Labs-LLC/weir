// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { describe, expect, it } from 'vitest';
import {
  InvalidCiphertextError,
  InvalidParameterError,
  NoAccessError,
} from '@mysten/seal';
import { webcrypto } from 'node:crypto';
import {
  SEAL_HEADERS,
  approvalFor,
  identityFor,
  isSettling,
  openBlob,
  openSealedMedia,
  readMediaResponse,
  sha256Hex,
  type Entitlement,
} from '../lib/seal-open';
import { encryptBlob } from '../lib/blob-crypto';
import { periodIdentity, unlockIdentity, type ProjectXSocialConfig } from '@projectx-social/sdk';

if (globalThis.crypto === undefined) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
}

const CONFIG: ProjectXSocialConfig = {
  network: 'mainnet',
  grpcUrl: 'https://example.invalid',
  packageId: `0x${'11'.repeat(32)}`,
  latestPackageId: `0x${'22'.repeat(32)}`,
  platformId: `0x${'33'.repeat(32)}`,
  registryId: `0x${'44'.repeat(32)}`,
};

const VAULT = `0x${'ab'.repeat(32)}`;

const APPROVE_SIGNATURES: Record<string, { reference: string | null; body: unknown }[]> = {
  seal_approve_unlock: [
    { reference: null, body: { $kind: 'vector', vector: { $kind: 'u8' } } },
    {
      reference: 'immutable',
      body: { $kind: 'datatype', datatype: { typeName: `${CONFIG.latestPackageId}::entitlement::Unlock`, typeParameters: [] } },
    },
    {
      reference: 'immutable',
      body: { $kind: 'datatype', datatype: { typeName: '0x2::tx_context::TxContext', typeParameters: [] } },
    },
  ],
  seal_approve_subscription: [
    { reference: null, body: { $kind: 'vector', vector: { $kind: 'u8' } } },
    { reference: null, body: { $kind: 'u64' } },
    { reference: null, body: { $kind: 'u64' } },
    {
      reference: 'immutable',
      body: {
        $kind: 'datatype',
        datatype: { typeName: `${CONFIG.latestPackageId}::entitlement::Subscription`, typeParameters: [] },
      },
    },
    {
      reference: 'immutable',
      body: { $kind: 'datatype', datatype: { typeName: '0x2::tx_context::TxContext', typeParameters: [] } },
    },
  ],
};

function objectResolvingClient(objects: Record<string, { version: string; digest: string }>) {
  return {
    core: {
      resolveTransactionPlugin: () => undefined,
      getMoveFunction: ({ name }: { packageId: string; moduleName: string; name: string }) => {
        const parameters = APPROVE_SIGNATURES[name];
        if (parameters === undefined) throw new Error(`the test did not stub the signature of ${name}`);
        return { function: { parameters } };
      },
      getObjects: ({ objectIds }: { objectIds: string[] }) => ({
        objects: objectIds.map((objectId) => {
          const known = objects[objectId];
          if (known === undefined) throw new Error(`the test did not stub object ${objectId}`);
          return {
            objectId,
            version: known.version,
            digest: known.digest,
            owner: { $kind: 'AddressOwner', AddressOwner: `0x${'99'.repeat(32)}` },
          };
        }),
      }),
    },
  } as never;
}

const STUB_REF = { version: '7', digest: '11111111111111111111111111111111' };
const PLAINTEXT = new TextEncoder().encode('the creator’s paid photograph, in bytes');

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

async function sealedResponse(): Promise<{ response: Response; key: Uint8Array; sha256: string }> {
  const blob = encryptBlob(PLAINTEXT);
  const sha256 = await sha256Hex(PLAINTEXT);
  const response = new Response(blob.ciphertext as unknown as BodyInit, {
    headers: {
      'content-type': 'application/octet-stream',
      [SEAL_HEADERS.encryption]: 'seal',
      [SEAL_HEADERS.wrappedKey]: base64(new Uint8Array([0xde, 0xad, 0xbe, 0xef])),
      [SEAL_HEADERS.nonce]: blob.nonce,
      [SEAL_HEADERS.sha256]: sha256,
      [SEAL_HEADERS.contentType]: 'image/png',
    },
  });
  return { response, key: new Uint8Array(Buffer.from(blob.key, 'base64')), sha256 };
}

const UNLOCK: Entitlement = {
  kind: 'unlock',
  vaultId: VAULT,
  contentKey: 'issue-7',
  unlockId: `0x${'cd'.repeat(32)}`,
};

describe('a reader who is not entitled cannot open the ciphertext', () => {
  it('gets nothing from the bytes and the wrapped key alone', async () => {
    const { response } = await sealedResponse();
    const media = await readMediaResponse(response);
    expect(media.kind).toBe('sealed');
    if (media.kind !== 'sealed') return;

    await expect(
      openSealedMedia({
        config: CONFIG,
        media,
        entitlement: UNLOCK,
        client: objectResolvingClient({ [UNLOCK.unlockId]: STUB_REF }),
        recoverKey: () => Promise.reject(new NoAccessError('req-1')),
      }),
    ).rejects.toMatchObject({ failure: { kind: 'denied', httpStatus: 403, alarm: false } });
  });

  it('cannot brute a key out of the ciphertext by guessing', async () => {
    const { response } = await sealedResponse();
    const media = await readMediaResponse(response);
    if (media.kind !== 'sealed') throw new Error('expected a sealed response');

    await expect(
      openBlob({ ciphertext: media.ciphertext, key: new Uint8Array(32), nonce: media.nonce }),
    ).rejects.toThrow();
  });

  it('cannot open it with the right key and the wrong nonce', async () => {
    const { response, key } = await sealedResponse();
    const media = await readMediaResponse(response);
    if (media.kind !== 'sealed') throw new Error('expected a sealed response');

    await expect(
      openBlob({ ciphertext: media.ciphertext, key, nonce: new Uint8Array(12) }),
    ).rejects.toThrow();
  });

  it('refuses a blob altered by a single byte, even with the right key', async () => {
    const { response, key } = await sealedResponse();
    const media = await readMediaResponse(response);
    if (media.kind !== 'sealed') throw new Error('expected a sealed response');

    const tampered = new Uint8Array(media.ciphertext);
    tampered[0] = tampered[0]! ^ 0x01;
    await expect(openBlob({ ciphertext: tampered, key, nonce: media.nonce })).rejects.toThrow();
  });

  it('is refused the plaintext when the hash does not match, rather than shown it', async () => {
    const blob = encryptBlob(PLAINTEXT);
    const response = new Response(blob.ciphertext as unknown as BodyInit, {
      headers: {
        [SEAL_HEADERS.encryption]: 'seal',
        [SEAL_HEADERS.wrappedKey]: base64(new Uint8Array([1])),
        [SEAL_HEADERS.nonce]: blob.nonce,
        [SEAL_HEADERS.sha256]: 'f'.repeat(64),
        [SEAL_HEADERS.contentType]: 'image/png',
      },
    });
    const media = await readMediaResponse(response);
    if (media.kind !== 'sealed') throw new Error('expected a sealed response');

    await expect(
      openSealedMedia({
        config: CONFIG,
        media,
        entitlement: UNLOCK,
        client: objectResolvingClient({ [UNLOCK.unlockId]: STUB_REF }),
        recoverKey: () => Promise.resolve(new Uint8Array(Buffer.from(blob.key, 'base64'))),
      }),
      /*
        Asserted on the classification rather than on the sentence. The message a reader is shown
        for this is deliberately not "the hashes do not match" — that is an operator's sentence —
        and pinning the test to it would pin the reader-facing copy to a diagnostic. `corrupt`
        carries the whole decision: terminal, alarming, and never a statement about entitlement.
      */
    ).rejects.toMatchObject({
      failure: { kind: 'corrupt', httpStatus: 502, retryable: false, cause: 'hash-mismatch' },
    });
  });
});

describe('a reader who is entitled gets exactly what the creator uploaded', () => {
  it('opens the blob once a threshold releases the key', async () => {
    const { response, key, sha256 } = await sealedResponse();
    const media = await readMediaResponse(response);
    if (media.kind !== 'sealed') throw new Error('expected a sealed response');

    const opened = await openSealedMedia({
      config: CONFIG,
      media,
      entitlement: UNLOCK,
      client: objectResolvingClient({ [UNLOCK.unlockId]: STUB_REF }),
      recoverKey: async ({ wrappedKey }) => {
        expect([...wrappedKey]).toEqual([0xde, 0xad, 0xbe, 0xef]);
        return key;
      },
    });

    expect(opened.contentType).toBe('image/png');
    expect(new TextDecoder().decode(opened.bytes)).toBe(new TextDecoder().decode(PLAINTEXT));
    expect(await sha256Hex(opened.bytes)).toBe(sha256);
  });
});

describe('reading what the media route sent', () => {
  it('treats a response with no encryption header as plain, and does not invent one', async () => {
    const response = new Response(PLAINTEXT as unknown as BodyInit, {
      headers: { 'content-type': 'image/png' },
    });
    const media = await readMediaResponse(response);
    expect(media.kind).toBe('plain');
    if (media.kind !== 'plain') return;
    expect(media.contentType).toBe('image/png');
    expect(new TextDecoder().decode(media.bytes)).toBe(new TextDecoder().decode(PLAINTEXT));
  });

  it('refuses an encryption scheme it does not know, rather than rendering the bytes', async () => {
    const response = new Response(new Uint8Array([1, 2, 3]) as unknown as BodyInit, {
      headers: { [SEAL_HEADERS.encryption]: 'something-later' },
    });
    await expect(readMediaResponse(response)).rejects.toThrow(/cannot open media encrypted/);
  });

  it('refuses a sealed response that is missing metadata, rather than treating it as plain', async () => {
    const response = new Response(new Uint8Array([1, 2, 3]) as unknown as BodyInit, {
      headers: { [SEAL_HEADERS.encryption]: 'seal' },
    });
    await expect(readMediaResponse(response)).rejects.toThrow(/without the headers needed/);
  });

  it('refuses a nonce that is not twelve bytes', async () => {
    const response = new Response(new Uint8Array([1, 2, 3]) as unknown as BodyInit, {
      headers: {
        [SEAL_HEADERS.encryption]: 'seal',
        [SEAL_HEADERS.wrappedKey]: base64(new Uint8Array([1])),
        [SEAL_HEADERS.nonce]: base64(new Uint8Array(8)),
        [SEAL_HEADERS.sha256]: 'a'.repeat(64),
        [SEAL_HEADERS.contentType]: 'image/png',
      },
    });
    await expect(readMediaResponse(response)).rejects.toThrow(/must be 12 bytes/);
  });

  it('refuses a header that is not base64 at all', async () => {
    const response = new Response(new Uint8Array([1, 2, 3]) as unknown as BodyInit, {
      headers: {
        [SEAL_HEADERS.encryption]: 'seal',
        [SEAL_HEADERS.wrappedKey]: 'not base64 !!!',
        [SEAL_HEADERS.nonce]: base64(new Uint8Array(12)),
        [SEAL_HEADERS.sha256]: 'a'.repeat(64),
        [SEAL_HEADERS.contentType]: 'image/png',
      },
    });
    await expect(readMediaResponse(response)).rejects.toThrow(/not base64/);
  });
});

describe('the identity a reader asks for is the one the contract will check', () => {
  it('derives an unlock identity through the same code the Move tests hold', () => {
    expect([...identityFor(UNLOCK)]).toEqual([
      ...unlockIdentity(VAULT, new TextEncoder().encode('issue-7')),
    ]);
  });

  it('derives a subscription identity from tier and period', () => {
    const subscription: Entitlement = {
      kind: 'subscription',
      vaultId: VAULT,
      tier: 2n,
      period: 7n,
      subscriptionId: `0x${'ef'.repeat(32)}`,
      coinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
    };
    expect([...identityFor(subscription)]).toEqual([...periodIdentity(VAULT, 2n, 7n)]);
  });

  it('builds an unlock approval that names the reader’s own unlock object', () => {
    const call = approvalFor(CONFIG, UNLOCK).getData().commands[0]!.MoveCall!;
    expect(call.function).toBe('seal_approve_unlock');
    expect(call.package).toBe(CONFIG.latestPackageId);
    expect(call.arguments).toHaveLength(2);
  });

  it('builds a subscription approval carrying tier and period alongside the identity', () => {
    const call = approvalFor(CONFIG, {
      kind: 'subscription',
      vaultId: VAULT,
      tier: 2n,
      period: 7n,
      subscriptionId: `0x${'ef'.repeat(32)}`,
      coinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
    })
      .getData()
      .commands[0]!.MoveCall!;
    expect(call.module).toBe('creator');
    expect(call.function).toBe('seal_approve_subscription');
    expect(call.arguments).toHaveLength(5);
  });
});

describe('the entitlement descriptor a sealed response carries', () => {
  async function withHeaders(extra: Record<string, string>): Promise<Response> {
    const { response } = await sealedResponse();
    const headers = new Headers(response.headers);
    for (const [name, value] of Object.entries(extra)) headers.set(name, value);
    return new Response(await response.arrayBuffer(), { headers });
  }

  it('reads an unlock descriptor into the shape the approval builder takes', async () => {
    const media = await readMediaResponse(
      await withHeaders({
        [SEAL_HEADERS.entitlement]: 'unlock',
        [SEAL_HEADERS.vault]: VAULT,
        [SEAL_HEADERS.entitlementObject]: UNLOCK.unlockId,
        [SEAL_HEADERS.contentKey]: 'issue-7',
      }),
    );

    expect(media.kind).toBe('sealed');
    if (media.kind !== 'sealed') return;
    expect(media.entitlement).toEqual(UNLOCK);
  });

  it('leaves it absent when the route said nothing, rather than inventing one', async () => {
    const { response } = await sealedResponse();
    const media = await readMediaResponse(response);
    expect(media.kind).toBe('sealed');
    if (media.kind !== 'sealed') return;
    expect(media.entitlement).toBeUndefined();
  });

  it('refuses a descriptor that names an entitlement without naming the object', async () => {
    await expect(
      readMediaResponse(
        await withHeaders({
          [SEAL_HEADERS.entitlement]: 'unlock',
          [SEAL_HEADERS.vault]: VAULT,
          // No `x-seal-object`. There is nothing to present to a key server.
        }),
      ),
    ).rejects.toThrow(/which object/);
  });

  it('refuses an unlock that does not say which content key it covers', async () => {
    await expect(
      readMediaResponse(
        await withHeaders({
          [SEAL_HEADERS.entitlement]: 'unlock',
          [SEAL_HEADERS.vault]: VAULT,
          [SEAL_HEADERS.entitlementObject]: UNLOCK.unlockId,
        }),
      ),
    ).rejects.toThrow(/content key/);
  });

  it('reads a subscription descriptor into the arguments the contract takes', async () => {
    const media = await readMediaResponse(
      await withHeaders({
        [SEAL_HEADERS.entitlement]: 'subscription',
        [SEAL_HEADERS.vault]: VAULT,
        [SEAL_HEADERS.entitlementObject]: `0x${'ab'.repeat(32)}`,
        [SEAL_HEADERS.tier]: '0',
        [SEAL_HEADERS.period]: '640',
        [SEAL_HEADERS.coinType]: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
      }),
    );

    expect(media.kind).toBe('sealed');
    if (media.kind !== 'sealed') return;

    expect(media.entitlement).toEqual({
      kind: 'subscription',
      vaultId: VAULT,
      subscriptionId: `0x${'ab'.repeat(32)}`,
      tier: 0n,
      period: 640n,
      coinType: '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC',
    });
  });

  it('refuses a subscription descriptor without the vault coin type the approval must name', async () => {
    await expect(
      readMediaResponse(
        await withHeaders({
          [SEAL_HEADERS.entitlement]: 'subscription',
          [SEAL_HEADERS.vault]: VAULT,
          [SEAL_HEADERS.entitlementObject]: `0x${'ab'.repeat(32)}`,
          [SEAL_HEADERS.tier]: '0',
          [SEAL_HEADERS.period]: '640',
        }),
      ),
    ).rejects.toThrow(/coin type/);
  });

  it('refuses a subscription that does not say which period it covers', async () => {
    await expect(
      readMediaResponse(
        await withHeaders({
          [SEAL_HEADERS.entitlement]: 'subscription',
          [SEAL_HEADERS.vault]: VAULT,
          [SEAL_HEADERS.entitlementObject]: `0x${'ab'.repeat(32)}`,
          [SEAL_HEADERS.tier]: '0',
        }),
      ),
    ).rejects.toThrow(/tier and period/);
  });

  it('refuses an entitlement kind this build has never heard of', async () => {
    await expect(
      readMediaResponse(
        await withHeaders({
          [SEAL_HEADERS.entitlement]: 'bearer-token',
          [SEAL_HEADERS.vault]: VAULT,
          [SEAL_HEADERS.entitlementObject]: `0x${'ab'.repeat(32)}`,
        }),
      ),
    ).rejects.toThrow(/cannot open media entitled by "bearer-token"/);
  });
});

describe('the settling retry fires on the error it was written for', () => {
  it('recognises a settling Unlock, which the text predicate did not', () => {
    const settling = new InvalidParameterError(
      'PTB contains an invalid parameter, possibly a newly created object that the FN has not yet seen',
    );
    expect(isSettling(settling)).toBe(true);

    const old = (e: unknown) =>
      /NoAccess|does not have access|InvalidParameter|NotFound|not yet exist/i.test(
        e instanceof Error ? `${e.name} ${e.message}` : String(e),
      );
    expect(old(settling)).toBe(false);
  });

  it('reports name "Error" for every seal class, which is why matching on it failed', () => {
    expect(new InvalidParameterError('x').name).toBe('Error');
    expect(new NoAccessError('x').name).toBe('Error');
  });

  it('still retries a refusal that may be the chain catching up, and bounded', () => {
    expect(isSettling(new NoAccessError('no access'))).toBe(true);
  });

  it('does not retry a corrupt ciphertext, which no amount of waiting fixes', () => {
    expect(isSettling(new InvalidCiphertextError('bad'))).toBe(false);
  });
});
