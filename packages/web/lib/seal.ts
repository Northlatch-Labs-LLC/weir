// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import 'server-only';

/**
 * Handing the media key to Seal.
 *
 * # What this file can do, and what it deliberately cannot
 *
 * It can **seal** a key. It cannot open one. There is no decrypt function here and adding one is
 * not possible rather than discouraged: a Seal key is released by key servers that first execute
 * `entitlement::seal_approve_*` with the *reader* as sender, against a `SessionKey` that reader
 * signed with their own wallet. This server is not the reader and holds no such signature, so it
 * has nothing to present. That asymmetry is the entire feature. Our Creator Terms §4.3 tell
 * creators "Northlatch cannot read them"; this is the file where that stops being a promise and
 * starts being an inability.
 *
 * # The envelope, and why the bytes never move
 *
 * `blob-crypto.ts` already encrypts each blob under a fresh random 32-byte AES-256-GCM key, and
 * said from the beginning what the plan was: "The migration is designed to move the key, not the
 * bytes. Ciphertext stored today stays exactly where it is; what changes is who can produce the key
 * that opens it... the key is opaque 32 bytes with no structure of ours in it."
 *
 * So that is what happens. The blob on Walrus is untouched — same ciphertext, same nonce, same blob
 * id. Only the 32-byte key is encrypted to a Seal identity and stored in `seal_wrapped_key`, and
 * `enc_key` is surrendered. Sealing the blob itself instead would re-encrypt and re-upload every
 * asset, pay for the storage a second time, invalidate every blob id, and gain nothing: a threshold
 * key protecting a 32-byte key protects everything that key protects.
 *
 * # The identity belongs to the contract
 *
 * Every identity is derived by `@projectx-social/sdk`'s `seal.ts`, which is held byte-for-byte
 * against `entitlement.move` by tests in both languages. Nothing here invents an identity, and
 * nothing here may start.
 */

import {
  createClient,
  fail,
  loadSealConfig,
  ok,
  periodIdentity,
  sealId,
  sealPackageId,
  unlockIdentity,
  type ProjectXSocialConfig,
  type Reading,
  type SealConfig,
} from '@projectx-social/sdk';
import { SealClient } from '@mysten/seal';
import { siteConfig } from './chain';

/** The 32-byte AES key `blob-crypto.ts` produces, as raw bytes. */
const KEY_BYTES = 32;

/**
 * Seal configuration for this deployment.
 *
 * Read on demand rather than at module load. A module-level throw would take down every page in
 * the application — including the ones that serve free content and have no interest in threshold
 * encryption — the moment a variable was missing, which is how an unset value becomes an outage
 * instead of a refused upload.
 */
export function sealSettings(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): Reading<SealConfig> {
  return loadSealConfig(env);
}

/**
 * A client bound to this deployment's key server committee.
 *
 * `verifyKeyServers` is set explicitly and set to `true`. The installed SDK defaults it to `false`
 * (`dist/client.mjs`: `options.verifyKeyServers ?? false`), which its own documentation contradicts
 * — so the value is written here rather than left to a default that is both surprising and
 * disputed. Unverified key servers mean encrypting a creator's media to whatever an object id
 * currently points at, and this runs once per upload, not once per read.
 */
function client(config: ProjectXSocialConfig, seal: SealConfig): SealClient {
  return new SealClient({
    suiClient: createClient(config),
    serverConfigs: seal.keyServers.map((server) => ({
      objectId: server.objectId,
      weight: server.weight,
      // Spread rather than assigned: the SDK distinguishes a committee-mode server from an
      // independent one by whether this key is *present*, so `aggregatorUrl: undefined` is not the
      // same thing as absent.
      ...(server.aggregatorUrl === undefined ? {} : { aggregatorUrl: server.aggregatorUrl }),
      /*
        Same reason, and it matters more here. The SDK throws `InvalidClientOptionsError` unless
        `apiKeyName` and `apiKey` are both present or both absent, and an explicit `undefined`
        counts as present. Every mainnet key server is permissioned, so this is the path a
        production deployment actually takes.
      */
      ...(server.apiKeyName === undefined || server.apiKey === undefined
        ? {}
        : { apiKeyName: server.apiKeyName, apiKey: server.apiKey }),
    })),
    verifyKeyServers: true,
  });
}

export interface SealedKey {
  /** The Seal `EncryptedObject`, base64. Public: it is useless without a threshold of key servers. */
  wrappedKey: string;
  /**
   * The identity it was sealed to, as unprefixed hex.
   *
   * Returned so the migration can verify what it just produced, and so a failure can be logged
   * against something specific. **Not for storage.** The identity is already inside the encrypted
   * object — `EncryptedObject.parse(wrapped).id` — and a second copy in a column beside it is two
   * records of one fact, which is the arrangement that drifts.
   */
  identity: string;
}

/**
 * Seal a 32-byte blob key to one Seal identity.
 *
 * Everything below this line is common to both gates, and it is one function so that they cannot
 * drift: the same committee, the same threshold, the same original-package rule, the same refusal
 * to keep the symmetric key, the same failure taxonomy. Only the identity differs, and it is
 * computed by the caller from the SDK's derivations — never here, and never by hand.
 *
 * # Why a `Reading` and not a throw
 *
 * Every way this fails is a fact the creator needs told differently: an unconfigured committee is
 * ours and they can do nothing about it; an unreachable key server is transient; a package id that
 * is not the first version is a deployment mistake. A thrown string collapses those into one 500.
 */
async function sealTo(
  identity: Uint8Array,
  /** The blob key from `blob-crypto.ts`, base64. */
  key64: string,
  source: string,
): Promise<Reading<SealedKey>> {
  const config = siteConfig();
  if (!config.ok) return config;

  const seal = sealSettings();
  if (!seal.ok) return seal;

  const raw = Buffer.from(key64, 'base64');
  if (raw.length !== KEY_BYTES) {
    // Length checked rather than accepted. Sealing a truncated key produces something that
    // decrypts to a key that opens nothing, discovered only when a buyer asks for what they paid
    // for — by which point the plaintext is gone.
    return fail('malformed', source, `a blob key must be ${KEY_BYTES} bytes; this one is ${raw.length}`);
  }


  try {
    const { encryptedObject, key } = await client(config.value, seal.value).encrypt({
      threshold: seal.value.threshold,
      // The ORIGINAL package, never the latest. Seal reads the package object and refuses anything
      // whose version is not 1.
      packageId: sealPackageId(config.value),
      id: sealId(identity),
      data: new Uint8Array(raw),
    });

    /*
      `key` is discarded here, deliberately and load-bearingly.

      `SealClient.encrypt` also returns the symmetric key it used, described in its own doc comment
      as usable "e.g. for backup". Keeping it would be the whole defect this work exists to remove:
      a backup key stored next to the wrapped key is `enc_key` again under a longer name, and we
      would once more be able to open a creator's paid media while telling them we cannot.

      It is destructured only so that this comment has something to point at. Nothing returns it,
      nothing logs it, and nothing may persist it.
    */
    void key;

    return ok({
      wrappedKey: Buffer.from(encryptedObject).toString('base64'),
      identity: sealId(identity),
    });
  } catch (error) {
    /*
      Not `classify`d into a transient failure.

      Reported as `transport` because that is the honest kind for "we asked the committee and did
      not get an answer", and because the caller turns it into a 502 rather than a 400 — the creator
      did nothing wrong. It is not passed through `classify`, which inspects error shapes this SDK
      never produces and would silently downgrade a Seal `InvalidPackageError` to a retryable
      timeout. What matters far more than the kind is the ordering: this runs *before* the blob is
      paid for and stored, so a committee we cannot reach costs nothing and stores nothing.
    */
    return fail('transport', source, error instanceof Error ? error.message : String(error));
  }
}

/**
 * Seal the key to one piece of priced content.
 *
 * The identity is `unlock_identity(vault, content_key)`, so the only reader who can ever reconstruct
 * this key is one holding an `Unlock` for exactly this content, in exactly this vault, and the key
 * servers establish that by running the contract rather than by trusting us.
 */
export async function sealUnlockKey(input: {
  vaultId: string;
  contentKey: string;
  /** The blob key from `blob-crypto.ts`, base64. */
  key: string;
}): Promise<Reading<SealedKey>> {
  /*
    `content_key` is `vector<u8>` in Move and the contract matches it byte-for-byte, never
    interpreting it. The application stores it as text, so UTF-8 is the encoding that round-trips —
    and it must be the same encoding `creator::unlock` was called with, or the buyer holds an
    `Unlock` whose identity does not match the one their media was sealed to.
  */
  const identity = unlockIdentity(input.vaultId, new TextEncoder().encode(input.contentKey));
  return sealTo(identity, input.key, 'seal media key');
}

/**
 * Seal the key to one creator-period at one tier.
 *
 * The identity is `period_identity(vault, tier, period)`, released by `seal_approve_subscription` to
 * a reader holding a `Subscription` to this vault, at this tier or above, whose paid window covers
 * the period's start.
 *
 * # Why the period is in the identity at all
 *
 * A Seal key, once derived, is permanent — it is a deterministic function of the identity, not a
 * session token, and no later check runs. Seal every subscriber post to `<vault> ‖ 0x01 ‖ <tier>`
 * and the product silently becomes *pay for one month, read this creator forever, including
 * everything published after you stop paying*. Nothing would look wrong: the entitlement check
 * passes at derivation time and there is no second one. The period index is what makes a lapsed
 * subscription stop granting new content while still opening what it paid for.
 *
 * # Why the caller supplies the period rather than this reading a clock
 *
 * The period must be the one the post was published in, forever. A `periodOf(Date.now())` here
 * would seal correctly today and, thirty days on, seal a post to a period the publisher is no
 * longer in — or, worse, be re-derived at read time and stop opening every post older than a month.
 * The number is decided once, at publish, and stored beside the ciphertext.
 */
export async function sealPeriodKey(input: {
  vaultId: string;
  /** The tier the creator published at. Subscribers at this tier **or above** can open it. */
  tier: bigint;
  /** `periodOf(publishedAtMs)`. Not `periodOf(now)` — see above. */
  period: bigint;
  /** The blob key from `blob-crypto.ts`, base64. */
  key: string;
}): Promise<Reading<SealedKey>> {
  const identity = periodIdentity(input.vaultId, input.tier, input.period);
  return sealTo(identity, input.key, 'seal subscriber key');
}
