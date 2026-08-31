// @vitest-environment node
// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/**
 * The manifest is the root of trust, and this file is what makes that sentence checkable.
 *
 * # Why this is separate from `test/agent-manifest.test.ts`
 *
 * That file asserts the document's CONTENT — that every published statement is the one the verifier
 * builds, that every endpoint's `proof` matches its route, that no credential leaks. It is about
 * whether the claims are true.
 *
 * This file is about whether the claims are *ours*. A perfectly true manifest that an intermediary
 * rewrote in flight is the more dangerous document of the two, because everything in it still looks
 * right. So what is asserted here is the machinery a stranger uses to tell one from the other: that
 * the signature covers the exact bytes served, that a single edited character breaks it, that the
 * digest is a digest of the response and not of something adjacent to it, and that an unsigned
 * deployment says so rather than sending a signature nobody can trust.
 *
 * # The key here is generated, and never read from anywhere
 *
 * `Ed25519Keypair.generate()` per run. Nothing in this file may reach a real operator key: a test
 * that could load one is a test that puts one in a CI log the first time an assertion prints the
 * object it was given.
 */

import { createHash, createPublicKey, type KeyObject } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { compactVerify, decodeProtectedHeader } from 'jose';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import {
  fail,
  ok,
  type PlatformState,
  type ProjectXSocialConfig,
  type SealConfig,
} from '@projectx-social/sdk';

import {
  AGENT_MANIFEST_DNS_ANCHOR,
  AGENT_MANIFEST_KEY_ENV,
  AGENT_MANIFEST_REVISION,
  MANIFEST_HEADERS,
  SEAL_COMMITTEE_REFRESH_MS,
  loadManifestSigner,
  manifestFrom,
  readPackageLineage,
  resolveKeyServers,
  signManifest,
  type KeyServerState,
  type ManifestInputs,
  type PackageLineage,
} from '../lib/agent-manifest';

/** Synthetic ids of the right shape, belonging to nothing. Same discipline as the sibling suite. */
const CONFIG: ProjectXSocialConfig = {
  network: 'mainnet',
  grpcUrl: 'https://fullnode.example.invalid:443',
  packageId: `0x${'a1'.repeat(32)}`,
  latestPackageId: `0x${'b2'.repeat(32)}`,
  platformId: `0x${'c3'.repeat(32)}`,
  registryId: `0x${'d4'.repeat(32)}`,
};

const PLATFORM: PlatformState = {
  version: 1n,
  feeBps: 290n,
  referralShareBps: 500n,
  creationFeeMist: 29_000_000_000n,
  creationPaused: false,
  paymentsPaused: false,
  treasuryMist: 29_000_000_000n,
  accountsCreated: 9n,
  vaultsCreated: 17n,
};

const KEY_SERVER = `0x${'e5'.repeat(32)}`;

const SEAL: SealConfig = {
  keyServers: [
    {
      objectId: KEY_SERVER,
      weight: 1,
      aggregatorUrl: 'https://seal-aggregator.example.invalid',
      apiKeyName: 'X-API-Key',
      apiKey: 'the-committee-credential-that-must-never-be-published',
    },
  ],
  threshold: 1,
};

function inputs(overrides: Partial<ManifestInputs> = {}): ManifestInputs {
  return {
    origin: 'https://weir.social',
    observedAtMs: 1_756_600_000_000,
    config: ok(CONFIG),
    keyRegistryId: ok(`0x${'f6'.repeat(32)}`),
    seal: ok(SEAL),
    coinTypes: [`0x${'a7'.repeat(32)}::usdc::USDC`],
    platform: ok(PLATFORM),
    ...overrides,
  };
}

/** A throwaway operator key, and the environment a deployment holding it would have. */
function operatorKey(): { keypair: Ed25519Keypair; env: Record<string, string | undefined> } {
  const keypair = Ed25519Keypair.generate();
  return { keypair, env: { [AGENT_MANIFEST_KEY_ENV]: keypair.getSecretKey() } };
}

/**
 * The published public key, turned into something a verifier can use — from the manifest's own
 * base64 and nothing else.
 *
 * Deliberately built from the STRING the document publishes rather than from the keypair object,
 * because that is all a stranger has. `302a300506032b6570032100` is the fixed SPKI header for an
 * Ed25519 public key of exactly 32 bytes: SEQUENCE, AlgorithmIdentifier 1.3.101.112, BIT STRING.
 * A test that verified with the keypair in hand would prove we can check our own signature and
 * nothing about whether anybody else can.
 */
function publishedKey(base64: string): KeyObject {
  return createPublicKey({
    key: Buffer.concat([
      Buffer.from('302a300506032b6570032100', 'hex'),
      Buffer.from(base64, 'base64'),
    ]),
    format: 'der',
    type: 'spki',
  });
}

/* ------------------------------------------------------------------------------------------------
   The signing key itself.
   ------------------------------------------------------------------------------------------------ */

describe('the operator key', () => {
  it('publishes an address a verifier can derive from the public key it publishes beside it', () => {
    const { keypair, env } = operatorKey();
    const signer = loadManifestSigner(env);
    expect(signer.ok).toBe(true);
    if (!signer.ok) return;

    // The cross-check the manifest tells an agent to perform, performed. If these two could
    // disagree, publishing both would be publishing one fact twice and calling it corroboration.
    expect(signer.value.identity.address).toBe(keypair.toSuiAddress());
    expect(signer.value.identity.publicKey).toBe(
      Buffer.from(keypair.getPublicKey().toRawBytes()).toString('base64'),
    );
    expect(signer.value.identity.algorithm).toBe('EdDSA');
  });

  it('reports an absent key as unconfigured rather than inventing one', () => {
    const signer = loadManifestSigner({});
    expect(signer.ok).toBe(false);
    if (signer.ok) return;
    expect(signer.failure.kind).toBe('unconfigured');
    expect(signer.failure.detail).toContain(AGENT_MANIFEST_KEY_ENV);
  });

  it('never echoes the key material in the failure it reports', () => {
    /*
      This detail string is serialised into the response body. A loader that quoted the value it
      could not parse would publish a malformed private key to every reader of the manifest — and a
      malformed Sui key is usually a correct one with a typo.
    */
    const secret = 'suiprivkey1qqqqqqqqqqqqqqqqqqqqqqqqqqnotarealkeyatallxxxxx';
    const signer = loadManifestSigner({ [AGENT_MANIFEST_KEY_ENV]: secret });
    expect(signer.ok).toBe(false);
    if (signer.ok) return;
    expect(signer.failure.kind).toBe('malformed');
    expect(JSON.stringify(signer.failure)).not.toContain(secret);
    expect(JSON.stringify(signer.failure)).not.toContain('suiprivkey');
  });
});

/* ------------------------------------------------------------------------------------------------
   The signature over the served bytes.
   ------------------------------------------------------------------------------------------------ */

describe('the detached signature', () => {
  it('verifies against the published public key, over exactly the bytes served', async () => {
    const { keypair, env } = operatorKey();
    const signer = loadManifestSigner(env);
    if (!signer.ok) throw new Error('the fixture key failed to load');

    const manifest = manifestFrom(inputs({ signer: ok(signer.value.identity) }));
    const served = await signManifest(manifest, signer);
    expect(served.jws).not.toBeNull();
    if (served.jws === null) return;

    // Re-attaching the payload is the whole verification procedure the manifest documents. If this
    // does not work here it does not work for anybody.
    const [header, signature] = served.jws.split('..');
    const payload = Buffer.from(served.body, 'utf8').toString('base64url');
    const verified = await compactVerify(
      `${header ?? ''}.${payload}.${signature ?? ''}`,
      publishedKey(manifest.integrity.signer?.publicKey ?? ''),
      { algorithms: ['EdDSA'] },
    );
    // And the key the document published is the key that signed it.
    expect(manifest.integrity.signer?.address).toBe(keypair.toSuiAddress());
    expect(new TextDecoder().decode(verified.payload)).toBe(served.body);
  });

  it('is detached — the payload segment is empty, not a second copy of the body', async () => {
    const { env } = operatorKey();
    const signer = loadManifestSigner(env);
    if (!signer.ok) throw new Error('the fixture key failed to load');
    const served = await signManifest(manifestFrom(inputs()), signer);
    if (served.jws === null) throw new Error('expected a signature');

    const segments = served.jws.split('.');
    expect(segments).toHaveLength(3);
    expect(segments[1]).toBe('');
    // A header that carried the body would double every response for no gain and create a second
    // copy that can disagree with the first.
    expect(served.jws.length).toBeLessThan(served.body.length);
  });

  it('fails to verify when a single character of the body is changed', async () => {
    const { keypair, env } = operatorKey();
    const signer = loadManifestSigner(env);
    if (!signer.ok) throw new Error('the fixture key failed to load');
    const served = await signManifest(manifestFrom(inputs()), signer);
    if (served.jws === null) throw new Error('expected a signature');

    /*
      The attack this exists to stop, at its smallest: an intermediary changes one id and leaves
      everything else alone. The document still parses, still looks right, and points every agent
      that trusts it at somebody else's package.
    */
    const tampered = served.body.replace(CONFIG.latestPackageId, `0x${'99'.repeat(32)}`);
    expect(tampered).not.toBe(served.body);

    const [header, signature] = served.jws.split('..');
    const payload = Buffer.from(tampered, 'utf8').toString('base64url');
    await expect(
      compactVerify(
        `${header ?? ''}.${payload}.${signature ?? ''}`,
        publishedKey(Buffer.from(keypair.getPublicKey().toRawBytes()).toString('base64')),
        { algorithms: ['EdDSA'] },
      ),
    ).rejects.toThrow();
  });

  it('signs the revision and the issue time into the protected header, so a replay is detectable', async () => {
    const { env } = operatorKey();
    const signer = loadManifestSigner(env);
    if (!signer.ok) throw new Error('the fixture key failed to load');
    const manifest = manifestFrom(inputs());
    const served = await signManifest(manifest, signer);
    if (served.jws === null) throw new Error('expected a signature');

    const [header] = served.jws.split('..');
    const decoded = decodeProtectedHeader(`${header ?? ''}..`) as Record<string, unknown>;

    expect(decoded['alg']).toBe('EdDSA');
    expect(decoded['kid']).toBe(signer.value.identity.address);
    // Both are inside the signature. An old document replayed at an agent carries an old `iat` and
    // an old `ver`, and neither can be edited forward without breaking the signature over them.
    expect(decoded['ver']).toBe(AGENT_MANIFEST_REVISION);
    expect(decoded['iat']).toBe(Math.floor(manifest.observedAtMs / 1000));
  });

  it('serves no signature at all rather than an empty one when no key is configured', async () => {
    const served = await signManifest(
      manifestFrom(inputs()),
      fail('unconfigured', 'agent manifest signing key', 'not set'),
    );
    expect(served.jws).toBeNull();
    // The digest is still there. It cannot prove who wrote the document, and it still catches a
    // response mangled in transit, which is the cheaper of the two failures and the commoner one.
    expect(served.contentDigest).toMatch(/^sha-256=:[A-Za-z0-9+/=]+:$/);
  });
});

/* ------------------------------------------------------------------------------------------------
   The digest and the tag.
   ------------------------------------------------------------------------------------------------ */

describe('the digest and the tag', () => {
  it('digests the bytes that are served, not the object they came from', async () => {
    const { env } = operatorKey();
    const signer = loadManifestSigner(env);
    const served = await signManifest(manifestFrom(inputs()), signer);

    const expected = createHash('sha256').update(Buffer.from(served.body, 'utf8')).digest();
    expect(served.contentDigest).toBe(`sha-256=:${expected.toString('base64')}:`);
    // Strong and quoted, per RFC 9110. A weak tag would say two different documents were
    // interchangeable, which for a signed document is exactly the claim that must not be made.
    expect(served.etag).toBe(`"${expected.toString('hex')}"`);
  });

  it('is the digest of a body that JSON.parse round-trips to the manifest', async () => {
    // The property that makes "sign what you serve" safe: nobody has to re-serialise to read it.
    const served = await signManifest(
      manifestFrom(inputs()),
      fail('unconfigured', 'agent manifest signing key', 'not set'),
    );
    expect(JSON.parse(served.body)).toEqual(JSON.parse(JSON.stringify(served.manifest)));
  });
});

/* ------------------------------------------------------------------------------------------------
   The integrity block inside the document.
   ------------------------------------------------------------------------------------------------ */

describe('the integrity block', () => {
  it('has the wire shape a consumer pins', () => {
    const manifest = manifestFrom(inputs());
    expect(Object.keys(manifest.integrity).sort()).toEqual(
      [
        'scheme',
        'signer',
        'signerUnavailable',
        'headers',
        'dnsAnchor',
        'dnsAnchorNote',
        'verifyNote',
        'packageLineage',
        'packageLineageUnavailable',
      ].sort(),
    );
    expect(manifest.version).toBe(AGENT_MANIFEST_REVISION);
  });

  it('names the headers the route actually sets', () => {
    /*
      A document that tells an agent to read `x-weir-signature` while the route sets
      `x-weir-manifest-jws` is a document that makes every verifier conclude we do not sign at all.
      Read from the route source rather than from a second copy of the string.
    */
    const manifest = manifestFrom(inputs());
    const source = readFileSync(
      new URL('../app/.well-known/weir-agent.json/route.ts', import.meta.url),
      'utf8',
    );

    expect(manifest.integrity.headers).toEqual({
      jws: MANIFEST_HEADERS.jws,
      digest: MANIFEST_HEADERS.digest,
      etag: MANIFEST_HEADERS.etag,
    });
    expect(source).toContain('MANIFEST_HEADERS.jws');
    expect(source).toContain('MANIFEST_HEADERS.digest');
    // Without this the browser-based agent receives every integrity header and can read none.
    expect(source).toContain('access-control-expose-headers');
  });

  it('publishes the DNS anchor it tells an agent to resolve', () => {
    const manifest = manifestFrom(inputs());
    expect(manifest.integrity.dnsAnchor).toBe(AGENT_MANIFEST_DNS_ANCHOR);
    expect(manifest.integrity.dnsAnchorNote).toContain(AGENT_MANIFEST_DNS_ANCHOR);
    // The point of the anchor is that it is not us. A document that told an agent to check a
    // signature and nothing else would have told it to trust the document about the document.
    expect(manifest.integrity.dnsAnchorNote).toContain('out of band');
  });

  it('says a deployment is unsigned rather than leaving the field empty', () => {
    const manifest = manifestFrom(
      inputs({ signer: fail('unconfigured', 'agent manifest signing key', 'PX_KEY is not set') }),
    );
    expect(manifest.integrity.signer).toBeNull();
    expect(manifest.integrity.signerUnavailable).toBe('PX_KEY is not set');
  });

  it('distinguishes a check that was not attempted from one that failed', () => {
    // The `Reading` discipline, applied to the document's own metadata: absent is not zero, and it
    // is not an error either. A consumer deciding whether to trust us needs to know which.
    expect(manifestFrom(inputs()).integrity.packageLineageUnavailable).toBe(
      'this build did not attempt the on-chain package cross-check',
    );
    expect(
      manifestFrom(inputs({ packageLineage: fail('timeout', 'package', 'deadline exceeded') }))
        .integrity.packageLineageUnavailable,
    ).toBe('deadline exceeded');
  });
});

/* ------------------------------------------------------------------------------------------------
   The package cross-check.
   ------------------------------------------------------------------------------------------------ */

describe('the package lineage cross-check', () => {
  const lineage = (originalId: string): PackageLineage => ({ originalId, version: '2' });

  it('agrees when the latest package is a version of the original this document publishes', () => {
    const manifest = manifestFrom(
      inputs({ packageLineage: ok(lineage(CONFIG.packageId)) }),
    );
    expect(manifest.integrity.packageLineage?.matchesManifest).toBe(true);
    expect(manifest.integrity.packageLineage?.originalFromChain).toBe(CONFIG.packageId);
    expect(manifest.integrity.packageLineage?.latestVersion).toBe('2');
  });

  it('says so plainly when the two package ids are not one package', () => {
    /*
      The configuration mistake this catches costs nothing at the door and everything afterwards:
      every `moveCall` resolves against the latest, every type filter silently matches nothing
      against the wrong original, and the Seal namespace is derived from a package the approvals are
      never called against — which reaches a paying reader as "you cannot open what you bought".
    */
    const manifest = manifestFrom(
      inputs({ packageLineage: ok(lineage(`0x${'11'.repeat(32)}`)) }),
    );
    expect(manifest.integrity.packageLineage?.matchesManifest).toBe(false);
    expect(manifest.integrity.packageLineage?.note).toContain('Refuse to transact');
  });

  it('does not report a mismatch for two spellings of the same id', () => {
    // A node may strip leading zeros where an environment variable padded them. Comparing strings
    // would raise the loudest alarm in this document for a formatting difference.
    const padded = `0x${'0'.repeat(62)}a1`;
    const stripped = '0xa1';
    const manifest = manifestFrom({
      ...inputs({ packageLineage: ok(lineage(stripped)) }),
      config: ok({ ...CONFIG, packageId: padded }),
    });
    expect(manifest.integrity.packageLineage?.matchesManifest).toBe(true);
  });

  it('reads original_id and the version over gRPC, and reports a node fault as a failure', async () => {
    /*
      The transport is asserted rather than the network. What matters is that this calls
      `MovePackageService.GetPackage` — there is no JSON-RPC path in this repository and a reader of
      this test should be able to see that the gRPC one is the one being used.
    */
    const client = {
      movePackageService: {
        getPackage: (input: { packageId?: string }) => {
          expect(input.packageId).toBe(CONFIG.latestPackageId);
          return Promise.resolve({
            response: { package: { originalId: CONFIG.packageId, version: 3n } },
          });
        },
      },
    };
    const reading = await readPackageLineage(
      client as never,
      CONFIG.latestPackageId,
    );
    expect(reading.ok).toBe(true);
    if (!reading.ok) return;
    expect(reading.value).toEqual({ originalId: CONFIG.packageId, version: '3' });
  });

  it('reports an id that names no package as not-found rather than as a match', async () => {
    const client = {
      movePackageService: { getPackage: () => Promise.resolve({ response: {} }) },
    };
    const reading = await readPackageLineage(client as never, CONFIG.latestPackageId);
    expect(reading.ok).toBe(false);
    if (reading.ok) return;
    expect(reading.failure.kind).toBe('not-found');
  });
});

/* ------------------------------------------------------------------------------------------------
   The key server committee.
   ------------------------------------------------------------------------------------------------ */

describe('the key server committee', () => {
  it('is resolved against the chain rather than echoed back from configuration', async () => {
    const client = {
      getObject: (input: { objectId: string }) => {
        expect(input.objectId).toBe(KEY_SERVER);
        return Promise.resolve({ object: { type: '0xseal::key_server::KeyServer' } });
      },
    };
    const states = await resolveKeyServers(client as never, SEAL.keyServers);
    expect(states).toEqual([
      {
        objectId: KEY_SERVER,
        weight: 1,
        aggregatorUrl: 'https://seal-aggregator.example.invalid',
        onChain: 'present',
        objectType: '0xseal::key_server::KeyServer',
        detail: null,
      },
    ]);
  });

  it('reports a retired committee member as absent, which is the state that strands agents', async () => {
    /*
      The failure the pinned list was worried about, made visible. A member removed on chain used to
      be echoed out of an environment variable forever; an agent would encrypt to a threshold it can
      no longer meet and nobody would learn until a reader could not open what they had paid for.
    */
    const client = { getObject: () => Promise.resolve({ object: null }) };
    const [state] = await resolveKeyServers(client as never, SEAL.keyServers);
    expect(state?.onChain).toBe('absent');
    expect(state?.objectType).toBeNull();
  });

  it('tells a node that said "nothing there" apart from a node that did not answer', async () => {
    const missing = {
      getObject: () => Promise.reject(new Error('object NOT_FOUND on this network')),
    };
    const broken = { getObject: () => Promise.reject(new Error('connection refused')) };

    expect((await resolveKeyServers(missing as never, SEAL.keyServers))[0]?.onChain).toBe('absent');
    // An outage is not evidence the committee changed. Folding the two together would either
    // panic an operator over a blip or hide a real removal behind one.
    expect((await resolveKeyServers(broken as never, SEAL.keyServers))[0]?.onChain).toBe(
      'unreadable',
    );
  });

  it('does not let one unreadable server hide the others', async () => {
    const second = `0x${'ee'.repeat(32)}`;
    const client = {
      getObject: ({ objectId }: { objectId: string }) =>
        objectId === KEY_SERVER
          ? Promise.reject(new Error('connection refused'))
          : Promise.resolve({ object: { type: '0xseal::key_server::KeyServer' } }),
    };
    const states = await resolveKeyServers(client as never, [
      ...SEAL.keyServers,
      { objectId: second, weight: 2 },
    ]);
    expect(states.map((s) => s.onChain)).toEqual(['unreadable', 'present']);
    expect(states[1]?.weight).toBe(2);
  });

  it('publishes the committee state and tells a client not to cache it', () => {
    const states: KeyServerState[] = [
      {
        objectId: KEY_SERVER,
        weight: 1,
        onChain: 'present',
        objectType: '0xseal::key_server::KeyServer',
        detail: null,
      },
    ];
    const manifest = manifestFrom(inputs({ keyServerStates: ok(states) }));
    expect(manifest.seal?.committee).toEqual(states);
    expect(manifest.seal?.committeeUnavailable).toBeNull();
    expect(manifest.seal?.refreshAfterMs).toBe(SEAL_COMMITTEE_REFRESH_MS);
    expect(manifest.seal?.committeeNote).toContain('Do not cache this');
  });

  it('still never publishes the committee credential, now that a second block describes it', () => {
    /*
      The sibling suite asserts this for the configured list. `committee` is a SECOND rendering of
      the same servers, built in a different function, and a credential that leaked through it would
      leak just as completely — so the guard is repeated against the shape that did not exist when
      the original guard was written.
    */
    const states = serialised(
      manifestFrom(
        inputs({
          keyServerStates: ok([
            {
              objectId: KEY_SERVER,
              weight: 1,
              aggregatorUrl: 'https://seal-aggregator.example.invalid',
              onChain: 'present',
              objectType: '0xseal::key_server::KeyServer',
              detail: null,
            },
          ]),
        }),
      ),
    );
    expect(states).not.toContain('the-committee-credential-that-must-never-be-published');
    expect(states).not.toContain('apiKey');
    expect(states).not.toContain('X-API-Key');
  });
});

/** Serialise, so a search covers every nested string rather than the keys of the top level. */
function serialised(value: unknown): string {
  return JSON.stringify(value);
}
