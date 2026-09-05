// Built-by: @projectx.sui · Co-authored-by: Claude
/**
 * Opening a sealed asset — and, more importantly, failing to.
 *
 * # What this suite is really asserting
 *
 * "Encryption without a test that proves a non-entitled reader cannot open the ciphertext is not
 * evidence of anything." So the centre of this file is the negative: the exact bytes the media
 * route now hands out — ciphertext plus a wrapped key — are put in front of a reader who cannot get
 * a share from the key servers, and the plaintext does not appear.
 *
 * That reader is not a strawman. They are given *everything the network gives them*: the whole
 * ciphertext, the whole wrapped key, the nonce, the hash, the content type. The only thing they do
 * not have is a threshold of key servers willing to run `entitlement::seal_approve_*` for them.
 * Under the scheme this replaces, that same reader — anyone who reached the bytes, from any Walrus
 * aggregator, with no wallet — needed only for our server to be wrong once.
 *
 * # What is proven here and what is not
 *
 * Proven: the response parsing, the AES-GCM unwrap, the tag check, the hash check, the approval
 * transaction, and that none of them leak plaintext without the key.
 *
 * Not proven here, and it cannot be: that a real Seal key server releases a share to an entitled
 * reader and refuses an unentitled one. That property lives in Move, is asserted directly against
 * the contract in `sui-contracts/tests/seal_tests.move`, and its network half needs key servers —
 * of which there are **none open on Sui mainnet**. The seam `RecoverKey` is where that boundary
 * sits, deliberately and visibly.
 */

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

// `lib/seal-open.ts` is browser code and reaches for the global `crypto`. Node has the same
// implementation, exposed under a different name in older majors; bound here so the module under
// test runs unmodified rather than being given a Node-shaped seam it would not have in a browser.
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

/**
 * The smallest client that can turn an object id into an object reference.
 *
 * A mock, and it is inside a test, which is the only place one belongs. It exists because
 * `Unlock` and `Subscription` are **owned** objects: a transaction referencing one carries its
 * version and digest, and neither is derivable from the id. The production path reads them from a
 * fullnode; asserting the approval's shape does not need a fullnode, only an answer.
 *
 * `resolveTransactionPlugin` returns undefined deliberately, so the SDK falls back to its own core
 * resolver — the same code path a real client takes. Substituting a plugin here would test the
 * substitute.
 */
/**
 * The Move signatures of the two approve functions, as the resolver reads them from chain.
 *
 * Needed since `entitlementRef` stopped declaring `mutable`. That key was illegal — it is a
 * *shared*-object property and an entitlement is owned, so `@mysten/sui` refused every approval it
 * appeared on. With it gone the builder does what it always should have: reads the function's
 * signature and learns the reference is immutable from the contract itself.
 *
 * The trailing `&TxContext` is present because the real signature has it and `isTxContext` drops it
 * — a stub that omitted it would leave the resolver one parameter short of the call's arguments and
 * throw "Incorrect number of arguments", which is a fixture bug that reads exactly like a real one.
 */
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
            // Address-owned, like a soulbound entitlement. Not shared: a shared object would
            // resolve to a SharedObjectRef and prove nothing about the owned path.
            owner: { $kind: 'AddressOwner', AddressOwner: `0x${'99'.repeat(32)}` },
          };
        }),
      }),
    },
  } as never;
}

/** A plausible object reference. The digest is 32 bytes, base58 — its content is never inspected. */
const STUB_REF = { version: '7', digest: '11111111111111111111111111111111' };
const PLAINTEXT = new TextEncoder().encode('the creator’s paid photograph, in bytes');

function base64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

/**
 * Exactly what the media route emits for a sealed asset.
 *
 * Built from the real `encryptBlob`, not from invented bytes, so the layout under test is the
 * layout on Walrus — including GCM's tag appended to the ciphertext, which is the detail a
 * hand-rolled fixture would get wrong.
 */
async function sealedResponse(): Promise<{ response: Response; key: Uint8Array; sha256: string }> {
  const blob = encryptBlob(PLAINTEXT);
  const sha256 = await sha256Hex(PLAINTEXT);
  const response = new Response(blob.ciphertext as unknown as BodyInit, {
    headers: {
      'content-type': 'application/octet-stream',
      [SEAL_HEADERS.encryption]: 'seal',
      // Stands in for the Seal EncryptedObject. Its contents are opaque to everything in this file;
      // what matters is that it travels as base64 and reaches `recoverKey` unaltered.
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
    /*
      The whole point, in one test.

      This reader has the complete response — the same bytes any Walrus aggregator would serve to
      anybody, plus the wrapped key our own route hands out. The key servers refuse them, because
      `seal_approve_unlock` aborts for somebody holding no `Unlock`. Nothing here recovers the
      plaintext, and the failure is a refusal rather than a corrupt image.
    */
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
        /*
          What a real key server does for a reader with no entitlement: it declines, and the SDK
          surfaces `NoAccessError` once a threshold cannot be met.

          The REAL class, not an `Error` whose text happens to say so. That substitution used to be
          harmless and is not any more: `lib/seal-open.ts` now classifies by `instanceof`, because
          `@mysten/seal` declares these as anonymous class expressions and never assigns `name`, so
          the `.name` of a genuine refusal is the string "Error". A fake built from a message would
          be classified `unavailable` here — correctly, since an unrecognised throw is treated as an
          outage — and this test would then be asserting a refusal it had not produced.
        */
        recoverKey: () => Promise.reject(new NoAccessError('req-1')),
      }),
    ).rejects.toMatchObject({ failure: { kind: 'denied', httpStatus: 403, alarm: false } });
  });

  it('cannot brute a key out of the ciphertext by guessing', async () => {
    // A wrong key is not a partial answer. GCM's tag check makes it a refusal, so there is no
    // oracle here to iterate against and no plaintext-shaped output to inspect.
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
    /*
      Storage nobody here operates reassembles these bytes from slivers held by many separate nodes.
      A silently altered blob that decoded to *something* would be served under a content type we
      chose — which is the failure GCM's tag exists to prevent.
    */
    const { response, key } = await sealedResponse();
    const media = await readMediaResponse(response);
    if (media.kind !== 'sealed') throw new Error('expected a sealed response');

    const tampered = new Uint8Array(media.ciphertext);
    tampered[0] = tampered[0]! ^ 0x01;
    await expect(openBlob({ ciphertext: tampered, key, nonce: media.nonce })).rejects.toThrow();
  });

  it('is refused the plaintext when the hash does not match, rather than shown it', async () => {
    /*
      The integrity check followed the plaintext into the browser when the server stopped being able
      to decrypt. This proves it still bites: a correct decrypt whose bytes are not what was
      uploaded is an error, not a picture.
    */
    const blob = encryptBlob(PLAINTEXT);
    const response = new Response(blob.ciphertext as unknown as BodyInit, {
      headers: {
        [SEAL_HEADERS.encryption]: 'seal',
        [SEAL_HEADERS.wrappedKey]: base64(new Uint8Array([1])),
        [SEAL_HEADERS.nonce]: blob.nonce,
        // A hash of something else entirely.
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
    /*
      The positive case, with the network step supplied by the seam.

      `recoverKey` stands where a threshold of key servers stands in production. What this proves is
      everything downstream of them: that the key they release opens the blob that is actually
      stored, that the layout matches, and that the bytes come back byte-identical to what was
      encrypted. The key servers' own decision is proven in Move, against the contract.
    */
    const { response, key, sha256 } = await sealedResponse();
    const media = await readMediaResponse(response);
    if (media.kind !== 'sealed') throw new Error('expected a sealed response');

    const opened = await openSealedMedia({
      config: CONFIG,
      media,
      entitlement: UNLOCK,
      client: objectResolvingClient({ [UNLOCK.unlockId]: STUB_REF }),
      recoverKey: async ({ wrappedKey }) => {
        // The wrapped key reaches the recovery step unaltered — base64 in a header, bytes here.
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
    // Public and platform-custody assets keep exactly the behaviour they had. This work must not
    // change what a reader sees for content that already worked.
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
    /*
      The dangerous middle case. A half-formed sealed response read as plain would hand ciphertext
      to an `<img>` — a broken image blamed on the creator's file rather than on us.
    */
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

/*
  The entitlement descriptor.

  These headers are how the route tells the browser *which* owned object opens an asset. The browser
  cannot work it out alone — `seal_approve_unlock` takes `&Unlock`, and finding the right one means
  paging the reader's owned objects, which the route already did to decide whether to serve the
  bytes at all.

  What is under test is the parsing, and specifically that the two ways of getting it wrong are
  distinguished: a response that says nothing is a caller's problem to handle, and a response that
  says half of something is a bug on the wire. Collapsing those was how a partial descriptor would
  have reached a key server as a plausible-looking request built from whatever happened to arrive.
*/
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
    // Deep-equal against the value the offline tests pass by hand: the descriptor path and the
    // explicit path must produce the same entitlement, or only one of them is really tested.
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

    // `bigint`, not `number`. Both are `u64` on chain, and a rounded period builds an identity of
    // the right length and the wrong bytes — refused in a way that reads as "you never subscribed".
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
    // v5: `creator::seal_approve_subscription<T>` names the vault's coin. A descriptor without it
    // would build nothing, so it is refused here rather than at the key servers.
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
    // Guessing one would build an approval for the wrong month and fail exactly like a reader who
    // never subscribed — a wrong answer wearing the right error.
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
  /*
    The regression this pins, measured on `@mysten/seal` 1.4.6:

      new NoAccessError('x').name          === 'Error'
      new InvalidParameterError('x').name  === 'Error'

    Every class in that library is an anonymous class expression and never assigns `name`. The old
    predicate matched `` `${error.name} ${error.message}` `` against
    /NoAccess|does not have access|InvalidParameter|NotFound|not yet exist/i — so the name half
    matched nothing and each class had to be recognised by its prose.

    `InvalidParameterError`'s real message is "PTB contains an invalid parameter, possibly a newly
    created object that the FN has not yet seen". The regex looked for "not yet exist". One word,
    and it is the exact error a just-minted `Unlock` produces while the fullnode indexes it — so a
    reader who had paid seconds earlier was told they had no access, which is the precise failure
    the retry was added to prevent.
  */
  it('recognises a settling Unlock, which the text predicate did not', () => {
    const settling = new InvalidParameterError(
      'PTB contains an invalid parameter, possibly a newly created object that the FN has not yet seen',
    );
    expect(isSettling(settling)).toBe(true);

    // The predicate that shipped, reproduced exactly, to show it says no.
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
