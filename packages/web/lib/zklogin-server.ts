// Built-by: @projectx.sui · Co-authored-by: Claude
import 'server-only';
import { opaqueDetail } from './opaque';

/**
 * The two things zkLogin needs a server for: verifying the identity token, and deriving the salt.
 *
 * # The salt, and the trust it actually costs
 *
 * A zkLogin address is `H(iss, aud, sub, salt)`. The salt is what stops the address being a public
 * function of a Google account — without one, anybody could compute the Sui address of anybody
 * whose email they knew, and every payment that address ever made would be linked to a real person
 * on a public ledger, permanently.
 *
 * Here the salt is derived, not stored:
 *
 *     HKDF(ikm = master seed, salt = iss || aud, info = sub)
 *
 * which is construction (4) of the five the zkLogin integration guide sets out. It is chosen over
 * the alternatives for reasons worth writing down, because each rejected option fails somebody:
 *
 *  - *User remembers the salt* — self-custodial and honest, but it reintroduces exactly the
 *    "write this down or lose your money" step this whole feature exists to delete.
 *  - *Salt in browser storage* — silently loses the account when the user clears their browser or
 *    picks up a second device, and the loss is discovered as "my money is gone".
 *  - *A random salt per user in a database row* — the same trust as this, plus a table that must
 *    never lose a row. Deriving has no such row to lose.
 *  - *A managed salt service* — a third party who can then link every user to their address.
 *
 * **Can**: derive any user's salt, and therefore compute their address. That is a real privacy
 * capability and it should be stated plainly rather than glossed: this deployment can link a Google
 * account to an on-chain address.
 *
 * **Cannot**: spend. Moving money needs a proof over a *live, Google-signed* JWT for that user
 * together with the ephemeral key that the proof is bound to. The seed produces neither. There is
 * no combination of this file's secrets that signs a transaction.
 *
 * ## The failure mode that matters, and its escape hatch
 *
 * If the seed is lost, every zkLogin address derived from it becomes unreachable — not drained,
 * unreachable, which for the holder is the same thing. `PROJECTX_SOCIAL_ZKLOGIN_SEED` is therefore
 * a backup-critical key on the order of the `UpgradeCap`, and it is treated as one.
 *
 * That is still a dependency on this platform continuing to exist, which a platform whose thesis is
 * "identity and payments are on-chain objects, not database rows" cannot simply accept. So the salt
 * is exportable: a signed-in user can read their own salt and keep it. Salt plus a Google sign-in
 * plus any proving service reconstructs the address and signs from it with nothing from us. The
 * derivation is convenience; it is not custody.
 */

import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { generateNonce } from '@mysten/sui/zklogin';
import { publicKeyFromSuiBytes } from '@mysten/sui/verify';
import { fail, ok, type Reading } from '@projectx-social/sdk';
import { GOOGLE_ISSUERS, GOOGLE_JWKS_URL, KEY_CLAIM_NAME, normaliseIssuer } from './zklogin';

export interface ZkLoginServerConfig {
  googleClientId: string;
  redirectUri: string;
  proverUrl: string;
  /**
   * The shared secret that gets a request past the edge and into the prover. Empty only for a
   * prover on this machine, which has no edge in front of it. See {@link PROVER_KEY_HEADER}.
   */
  proverKey: string;
  seed: Uint8Array;
}

/**
 * The header the prover's edge rule checks.
 *
 * The proving service is expensive — a dedicated 16 GB machine, and real CPU per request — and it
 * answers at a public hostname because Vercel's functions egress from addresses that change, so
 * there is no source to allowlist. A shared secret checked at Cloudflare is what fits: a request
 * without it is refused before it reaches the VM at all, so abuse costs the edge rather than the
 * prover.
 *
 * This is not authentication of the *user*. The JWT does that, and the circuit will not produce a
 * proof for a token Google did not sign. This is a ceiling on who may spend the machine.
 */
export const PROVER_KEY_HEADER = 'x-projectx-prover-key';

/** Every variable this feature needs. No defaults, and none of them is optional. */
export const ZKLOGIN_ENV = [
  'PROJECTX_SOCIAL_GOOGLE_CLIENT_ID',
  'PROJECTX_SOCIAL_ZKLOGIN_REDIRECT_URI',
  'PROJECTX_SOCIAL_ZKLOGIN_PROVER_URL',
  'PROJECTX_SOCIAL_ZKLOGIN_SEED',
] as const;

/**
 * The minimum seed length, in bytes of entropy after hex decoding.
 *
 * Thirty-two, because the seed is the input keying material for every salt this deployment will
 * ever derive and there is no rotating it later — rotating changes every address. A short seed here
 * is not a weak password that can be improved next month; it is a permanent ceiling on the
 * unlinkability of every account.
 */
export const MIN_SEED_BYTES = 32;

/**
 * Configuration, or a clear statement of what is missing.
 *
 * Absent configuration is `unconfigured`, not `malformed`. The distinction is load-bearing: a
 * deployment that has simply not set zkLogin up should show a calm "signing in with Google is not
 * available here" and keep offering wallets, whereas a deployment that set it up *wrongly* should
 * be loud. Collapsing the two would hide a broken prover behind a friendly message.
 */
export function zkLoginConfig(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): Reading<ZkLoginServerConfig> {
  const source = 'zkLogin configuration';

  /*
    The deliberate off switch, checked before anything else.

    Turning the feature off by deleting one variable works, but it is indistinguishable from
    somebody having deleted it by accident — and re-adding it silently brings the Google button
    back, pointing at a prover that no longer exists. That is the state this deployment was found
    in: the button was live and every press ended at a host we had already torn down.
  */
  if ((env['PROJECTX_SOCIAL_ZKLOGIN_DISABLED'] ?? '').trim() === '1') {
    return fail('unconfigured', source, 'turned off on this deployment');
  }

  const missing = ZKLOGIN_ENV.filter((name) => (env[name] ?? '').trim() === '');
  if (missing.length > 0) {
    return fail('unconfigured', source, `not set: ${missing.join(', ')}`);
  }

  const rawSeed = (env['PROJECTX_SOCIAL_ZKLOGIN_SEED'] ?? '').trim();
  if (!/^(0x)?[0-9a-fA-F]+$/.test(rawSeed)) {
    return fail('malformed', source, 'PROJECTX_SOCIAL_ZKLOGIN_SEED must be hex');
  }
  const hex = rawSeed.startsWith('0x') ? rawSeed.slice(2) : rawSeed;
  if (hex.length % 2 !== 0) {
    return fail('malformed', source, 'PROJECTX_SOCIAL_ZKLOGIN_SEED has an odd number of hex digits');
  }
  const seed = Uint8Array.from(hex.match(/../g)?.map((byte) => parseInt(byte, 16)) ?? []);
  if (seed.length < MIN_SEED_BYTES) {
    return fail(
      'malformed',
      source,
      `PROJECTX_SOCIAL_ZKLOGIN_SEED is ${seed.length} bytes; at least ${MIN_SEED_BYTES} are required and it can never be rotated`,
    );
  }

  const proverUrl = (env['PROJECTX_SOCIAL_ZKLOGIN_PROVER_URL'] ?? '').trim();
  // Refused rather than warned about. The prover receives the JWT, and a JWT in flight over plain
  // HTTP is an identity assertion anyone on the path can replay against this deployment.
  if (!proverUrl.startsWith('https://') && !proverUrl.startsWith('http://localhost')) {
    return fail(
      'malformed',
      source,
      'PROJECTX_SOCIAL_ZKLOGIN_PROVER_URL must be https, or http://localhost for a prover on this machine',
    );
  }

  /*
    Required exactly when the prover is remote, and loud about it when it is missing.

    `unconfigured` would be the wrong kind here even though the literal fault is "a variable is not
    set". That kind means a calm, deliberate absence — the feature is off, keep offering wallets.
    A deployment that has gone to the trouble of pointing at an `https://` prover has not turned the
    feature off; it has left the expensive machine reachable by anyone who learns the hostname. That
    is a misconfiguration and it should be loud.

    A prover on `http://localhost` has no edge in front of it, so no key applies. Demanding one there
    would be a requirement satisfied by any junk value, which teaches people to type junk into the
    variable that protects production.
  */
  const proverKey = (env['PROJECTX_SOCIAL_ZKLOGIN_PROVER_KEY'] ?? '').trim();
  if (proverUrl.startsWith('https://') && proverKey === '') {
    return fail(
      'malformed',
      source,
      'PROJECTX_SOCIAL_ZKLOGIN_PROVER_KEY must be set for a remote prover — without it the proving machine is reachable by anyone who learns its hostname',
    );
  }

  return ok({
    googleClientId: (env['PROJECTX_SOCIAL_GOOGLE_CLIENT_ID'] ?? '').trim(),
    redirectUri: (env['PROJECTX_SOCIAL_ZKLOGIN_REDIRECT_URI'] ?? '').trim(),
    proverUrl,
    proverKey,
    seed,
  });
}

/**
 * Google's signing keys, fetched once and cached by `jose` with its own rotation handling.
 *
 * Module scope on purpose: Google rotates these keys, and a set fetched per request would mean a
 * network round trip to Google on every single sign-in, plus a thundering herd against their
 * endpoint the moment this deployment gets busy.
 */
const googleKeys = createRemoteJWKSet(new URL(GOOGLE_JWKS_URL));

export interface VerifiedClaims {
  iss: string;
  aud: string;
  sub: string;
  nonce: string;
}

/**
 * The three values a zkLogin nonce commits to.
 *
 * `extendedEphemeralPublicKey` is what `getExtendedEphemeralPublicKey()` produces: base64 of the
 * signature-scheme flag followed by the raw public key. `publicKeyFromSuiBytes` is its exact
 * inverse, which is why the server can rebuild the browser's key without being told which curve it
 * is on.
 */
export type NonceCommitment = {
  extendedEphemeralPublicKey: string;
  maxEpoch: number;
  jwtRandomness: string;
};

/**
 * Derive the nonce a commitment must have produced.
 *
 * `generateNonce` is imported from the SDK rather than reimplemented here. It is `base64urlnopad(
 * poseidonHash([key_hi, key_lo, maxEpoch, randomness]))`, and a second implementation of that would
 * be a second thing to keep in step with the circuit — where "in step" is the difference between
 * refusing a stolen token and refusing every real user.
 *
 * Every failure is folded into one `Reading`. The inputs are attacker-controlled: a public key that
 * is not base64, a flag naming no scheme, randomness that is not a number. `generateNonce` throws
 * on all of them, and a throw here would be a 500 for what is a bad request.
 */
export function nonceFor(commitment: NonceCommitment): Reading<string> {
  const source = 'sign-in commitment';
  if (!Number.isInteger(commitment.maxEpoch) || commitment.maxEpoch <= 0) {
    return fail('malformed', source, 'maxEpoch must be a positive integer');
  }
  try {
    const publicKey = publicKeyFromSuiBytes(commitment.extendedEphemeralPublicKey);
    return ok(generateNonce(publicKey, commitment.maxEpoch, commitment.jwtRandomness));
  } catch (error) {
    return fail(
      'malformed',
      source,
      `the ephemeral key, epoch and randomness do not form a nonce: ${
        opaqueDetail(source, error)
      }`,
    );
  }
}

/**
 * Verify an identity token really came from Google, for this application, for this session.
 *
 * **This is the only thing standing between a stranger and another user's salt.** Without a
 * signature check, anyone could POST a self-made token claiming any `sub` and be handed the salt
 * for that account — which does not let them spend, but does let them compute the address, which is
 * precisely the linkage the salt exists to prevent. So the check is not defence in depth here; it
 * is the defence.
 *
 * `jose` is given the algorithm explicitly. Passing the token's own `alg` back in is the classic
 * JWT confusion bug, and the fix is to never read that field for a decision.
 *
 * The nonce is checked too, and that is what makes a token unusable outside the session that asked
 * for it: the nonce commits to the ephemeral public key, `maxEpoch` and the randomness. A token
 * captured from one session cannot be replayed into another, because the other session's nonce is
 * different and Google signed the first one.
 *
 * **That guarantee is only real if the server derives the nonce.** This function used to accept an
 * `expectedNonce: string`, and both callers passed the value straight out of the request body that
 * carried the JWT. The comparison was therefore between the nonce Google signed and a copy of that
 * same nonce, echoed back by whoever sent the token — a self-comparison that passed unconditionally.
 * The whole replay defence was absent, and a Google identity token for this client id functioned as
 * a bearer credential for the account it named.
 *
 * The parameter is now the *commitment* — the ephemeral public key, `maxEpoch` and the randomness —
 * and the nonce is derived here with the SDK's own `generateNonce`, the same function the browser
 * called. A caller cannot hand this function the answer it is checking for, because no parameter
 * accepts one. That is the point of the shape: the unsafe call is unrepresentable rather than
 * merely discouraged.
 *
 * Deriving rather than storing also means there is no pending-nonce table to expire, and no state
 * shared between the instance that started a sign-in and the instance that finishes it.
 */
export async function verifyGoogleIdToken(input: {
  jwt: string;
  clientId: string;
  /**
   * What the signed nonce must commit to. Not a nonce — see the note above.
   *
   * Supplied by the caller and entirely untrusted: every field here is attacker-controlled. That is
   * fine, and it is the reason this works. An attacker who holds somebody else's JWT must produce
   * three values that Poseidon-hash to the nonce Google already signed, which is a preimage search,
   * not an echo. Supplying their own ephemeral key instead yields a nonce that does not match.
   */
  commitment: NonceCommitment;
  /**
   * The key set to verify against. Defaults to Google's, and production never passes anything.
   *
   * Injectable so the verifier itself can be tested — the whole point of this function is that it
   * refuses tokens Google did not sign, and a test cannot demonstrate that without also being able
   * to produce a token that *is* accepted. Without this parameter the only testable assertion is
   * "everything is rejected", which passes just as well against a function that rejects everything
   * unconditionally, including real users.
   *
   * The default is not overridable by configuration or by request data. A caller has to pass a key
   * set object in TypeScript to change it, which route handlers do not and cannot do from input.
   */
  keys?: Parameters<typeof jwtVerify>[1];
}): Promise<Reading<VerifiedClaims>> {
  const source = 'Google identity token';
  try {
    const { payload } = await jwtVerify(input.jwt, input.keys ?? googleKeys, {
      algorithms: ['RS256'],
      audience: input.clientId,
      // Both spellings, because Google issues both and neither is a forgery.
      issuer: [...GOOGLE_ISSUERS],
      // `jose` enforces `exp` itself. No tolerance is granted: an expired identity assertion is
      // exactly the thing being checked for, and "a few seconds of grace" is a window somebody
      // eventually widens.
      clockTolerance: 0,
    });

    const sub = payload.sub;
    const nonce = payload['nonce'];
    const iss = payload.iss;
    const aud = payload.aud;

    if (typeof sub !== 'string' || sub === '') {
      return fail('malformed', source, 'the token carries no subject');
    }
    if (typeof iss !== 'string' || typeof aud !== 'string') {
      return fail('malformed', source, 'the token carries no single issuer and audience');
    }
    if (typeof nonce !== 'string') {
      return fail('malformed', source, 'the token carries no nonce');
    }
    const expected = nonceFor(input.commitment);
    if (!expected.ok) {
      // The commitment did not parse. Reported against this token rather than as a server fault:
      // the values came in on the same request as the JWT and are the caller's to get right.
      return fail('malformed', source, expected.failure.detail);
    }
    if (nonce !== expected.value) {
      return fail(
        'malformed',
        source,
        'this token belongs to a different sign-in attempt — start again',
      );
    }

    // Normalised at the single point every derivation flows from. Google emits two spellings of
    // its own issuer, and they must not become two addresses for one person.
    return ok({ iss: normaliseIssuer(iss), aud, sub, nonce });
  } catch (error) {
    return fail('malformed', source, opaqueDetail(source, error));
  }
}

/**
 * The user's salt.
 *
 *     HKDF(ikm = seed, salt = iss || aud, info = sub)
 *
 * Quoted from the zkLogin integration guide's option 4 and implemented exactly, including the
 * ordering of `iss || aud`. Changing any input — even reordering the concatenation — changes every
 * address this deployment has ever issued, which would strand every existing account. Treat this
 * function as frozen.
 *
 * Sixteen bytes because a zkLogin salt must be less than 2^128; the circuit takes it as a single
 * field element and a wider value is not representable.
 */
export const SALT_BYTES = 16;

export function deriveUserSalt(input: {
  seed: Uint8Array;
  iss: string;
  aud: string;
  sub: string;
}): bigint {
  const encoder = new TextEncoder();
  const bytes = hkdf(
    sha256,
    input.seed,
    encoder.encode(`${input.iss}${input.aud}`),
    encoder.encode(input.sub),
    SALT_BYTES,
  );
  // Big-endian, which is how the reference implementation reads it. Little-endian here would
  // produce a different but equally valid-looking salt, and the mistake would only ever surface as
  // "my address changed" after the code had been in production long enough to matter.
  let salt = 0n;
  for (const byte of bytes) salt = (salt << 8n) | BigInt(byte);
  return salt;
}

/**
 * Ask the proving service for a proof.
 *
 * The prover is called from the server, never the browser, for two reasons. A self-hosted prover
 * usually sits behind credentials or an allowlist that has no business in a client bundle; and the
 * mainnet-hosted service requires allowlisting, so its URL is deployment configuration rather than
 * a public constant.
 *
 * There is no retry. A prover that failed once will fail again for the same JWT, and the JWT is
 * short-lived — retrying spends the user's remaining validity window on a request that has already
 * been answered.
 */
export async function requestProof(input: {
  proverUrl: string;
  /** Sent as {@link PROVER_KEY_HEADER}. Omitted when empty, which is the localhost case. */
  proverKey?: string;
  payload: Record<string, unknown>;
  timeoutMs?: number;
}): Promise<Reading<unknown>> {
  const source = 'the proving service';
  // Proof generation is genuinely slow — seconds, not milliseconds — so the ceiling is generous.
  // It is still a ceiling: without one a hung prover holds the request open until the platform's
  // own timeout kills it, and the user sees nothing at all rather than a reason.
  const timeoutMs = input.timeoutMs ?? 30_000;
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);

  try {
    const key = (input.proverKey ?? '').trim();
    const response = await fetch(input.proverUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(key === '' ? {} : { [PROVER_KEY_HEADER]: key }),
      },
      body: JSON.stringify(input.payload),
      signal: abort.signal,
    });

    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 400);
      /*
        A 403 here is almost always the edge rather than the prover: the shared secret is wrong, or
        absent, or the rule changed. The prover itself has no notion of forbidden — it answers 400
        for bad input and 200 with a proof otherwise. Saying so turns a generic transport failure
        into the one sentence that identifies the fault.
      */
      if (response.status === 403) {
        return fail(
          'transport',
          source,
          "refused at the edge, not by the prover — PROJECTX_SOCIAL_ZKLOGIN_PROVER_KEY does not match the rule guarding the proving service's hostname",
        );
      }
      return fail(
        'transport',
        source,
        `the prover answered ${response.status}${detail === '' ? '' : `: ${detail}`}`,
      );
    }
    return ok((await response.json()) as unknown);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return fail('timeout', source, `no proof within ${timeoutMs}ms`);
    }
    return fail('transport', source, opaqueDetail(source, error));
  } finally {
    clearTimeout(timer);
  }
}
