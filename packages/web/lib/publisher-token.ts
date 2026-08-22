// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import 'server-only';

/**
 * Authorisation to spend our storage budget, for exactly one upload.
 *
 * # Why the publisher cannot simply be reachable
 *
 * This module is that decision, expressed as a token the publisher can check without knowing
 * anything about creators, vaults or Sui.
 *
 * # The gate is the one the product already has
 *
 * `/api/studio/upload` reads the vault's owner from chain and requires a signature over the post id
 * and a hash of the file. That check already establishes the only thing worth establishing: this
 * person is the creator, and these are the bytes they meant to upload. A token minted after it
 * carries that decision to the publisher; a token cannot be obtained any other way.
 *
 * # Every claim is exact, never a maximum
 *
 * Walrus accepts `max_epochs`/`max_size` (ceilings the client may spend under) or `epochs`/`size`
 * (exact values it must match). This mints exact ones.
 *
 * The difference is who chooses. A ceiling lets the caller pick anything beneath it, so a token
 * issued for a 40 KB avatar at the free tier could be spent on a 7 MB blob for two years. The
 * request has already been measured by the time a token exists — the size is known and the tier is
 * ours to set — so there is nothing legitimate a range would express and a real cost it would
 * expose. Exactness also means `--jwt-verify-upload` on the publisher rejects any mismatch outright
 * rather than approving a cheaper-looking request than the one performed.
 *
 * # The creator owns what we paid for
 *
 * `send_object_to` is the creator's address, so the `Blob` object lands with them. We front the WAL;
 * they hold the object. That is the custody model this product argues for everywhere else — an
 * object you own, checked by a contract — applied to storage, and it costs nothing to honour
 * because the publisher supports it directly.
 *
 * # Single use, and short lived
 *
 * `jti` is a fresh 256-bit nonce, and the publisher keeps used ones until they expire, so a captured
 * token cannot be replayed. The lifetime is a minute: the token is minted at the end of a request
 * that is about to upload, so anything longer is a window with no purpose.
 */

import { randomBytes } from 'node:crypto';
import { SignJWT } from 'jose';
import { fail, ok, type Reading } from '@projectx-social/sdk';
import { MAX_EPOCHS } from './walrus';

/**
 * How long a blob is paid to live, by what the reader had to do to see it.
 *
 * Deliberately two named tiers rather than a number a caller passes. Storage duration is a cost
 * decision, and a route that accepts an epoch count from its own request body is a route that
 * eventually accepts 53 from somebody who wanted 1.
 */
export type StorageTier = 'ephemeral' | 'durable';

/**
 * One epoch is fourteen days on mainnet — measured, not assumed: `walrus info` reports
 * `Epoch duration: 14days` and a 53-epoch ceiling, which is a little over two years.
 *
 * The short tier saves less than it looks. A store's cost is
 * `encoded_MiB × (0.0001 × epochs + 0.0002)`, so the per-write component is charged whatever the
 * duration: a real measurement put one epoch at 0.018 WAL and fifty-three at roughly 0.347 — 19×
 * the cost for 53× the life. Renewing a short lease repeatedly is therefore *more* expensive than
 * buying a long one once. `ephemeral` exists because content that expires is a product decision,
 * not because it is a cheap one.
 */
/*
  Re-exported rather than defined here.

  This module is `server-only`, so the composer could not import the lease it was describing and
  described it from memory — backwards, promising a public image was kept "permanently" when public
  is the one-epoch tier. The values now live in `lib/storage-retention.ts`, which carries no
  `server-only` marker precisely so the browser may read the same number this server spends.
*/
import { TIER_EPOCHS } from './storage-retention';

export { TIER_EPOCHS };

/**
 * A minute — and this number is a **contract with the publisher, not a preference.**
 *
 * The publisher does not treat `--jwt-expiring-sec` as a maximum lifetime. It requires that
 * `exp - iat` **equal it exactly**:
 *
 *     if (self.exp - self.iat.unwrap_or_default()) != auth_config.expiring_sec { … reject }
 *
 * So a publisher started with `--jwt-expiring-sec 120` refuses every token minted here, and the
 * refusal reads `the expiration in the query does not match the token` — which names the *query*,
 * though nothing in the query is involved. Found by running it: three query variants were tried
 * before reading the source, because the message points away from the cause.
 *
 * **The publisher must be started with `--jwt-expiring-sec 60`.** Exported so a deployment check
 * can assert it rather than rediscover this.
 */
export const LIFETIME_SECONDS = 60;

export interface UploadGrant {
  /** The bearer token, for `Authorization: Bearer …` on the publisher's `PUT /v1/blobs`. */
  token: string;
  /** Echoed so the caller builds a query string that matches the claims rather than guessing. */
  epochs: number;
  /** Exact byte count this token permits, and no other. */
  size: number;
}

/**
 * The shared secret the publisher verifies with, from `--jwt-decode-secret`.
 *
 * No default, and no fallback. A publisher configured with a secret this application does not hold
 * refuses every upload, which is a visible outage; an application that invented one would mint
 * tokens that are refused just as completely while looking configured. Both fail — only one says
 * why.
 */
function secret(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): Reading<Uint8Array> {
  const source = 'Walrus publisher token';
  const value = (env['PROJECTX_WALRUS_PUBLISHER_JWT_SECRET'] ?? '').trim();
  if (value === '') {
    return fail(
      'unconfigured',
      source,
      'PROJECTX_WALRUS_PUBLISHER_JWT_SECRET is not set, so no upload can be authorised',
    );
  }
  if (value.length < 32) {
    // HS256's security rests entirely on this. A short secret is brute-forceable offline from one
    // captured token, and the reward is the ability to spend the publisher's wallet.
    return fail('malformed', source, 'the publisher JWT secret must be at least 32 characters');
  }
  return ok(new TextEncoder().encode(value));
}

/**
 * Mint a token authorising one upload of exactly these bytes, for exactly this long, to exactly
 * this owner.
 *
 * Call only after the uploader has been proved to be the creator. Nothing in here re-checks that,
 * by design: there is one authorship predicate in this codebase and a second copy here would be
 * free to drift from it.
 */
export async function grantUpload(input: {
  /** The creator's Sui address. Receives the `Blob` object. */
  owner: string;
  /** Exact size of the bytes being stored, after any encryption. */
  size: number;
  tier: StorageTier;
  env?: Record<string, string | undefined>;
}): Promise<Reading<UploadGrant>> {
  const source = 'Walrus publisher token';

  const key = secret(input.env);
  if (!key.ok) return key;

  if (!Number.isInteger(input.size) || input.size <= 0) {
    return fail('malformed', source, 'the size to authorise must be a positive whole number');
  }
  if (!/^0x[0-9a-fA-F]{64}$/.test(input.owner)) {
    // Checked rather than passed through: this address decides who ends up owning the blob we are
    // about to pay for, and a malformed one is not a thing to discover at the publisher.
    return fail('malformed', source, 'the owner must be a 0x-prefixed 32-byte Sui address');
  }

  const epochs = TIER_EPOCHS[input.tier];
  const now = Math.floor(Date.now() / 1000);

  const token = await new SignJWT({
    // Exact, never a ceiling — see the note at the top of this file.
    epochs,
    size: input.size,
    send_object_to: input.owner,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(now)
    .setExpirationTime(now + LIFETIME_SECONDS)
    // Replay suppression. The publisher remembers this until `exp`, so the token opens one door once.
    .setJti(randomBytes(32).toString('hex'))
    .sign(key.value);

  return ok({ token, epochs, size: input.size });
}
