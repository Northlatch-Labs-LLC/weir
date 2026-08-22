// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { computeZkLoginAddressFromSeed, genAddressSeed } from '@mysten/sui/zklogin';
import { checkProveResponse, KEY_CLAIM_NAME, type ProveRequest } from '@/lib/zklogin';
import { deriveUserSalt, requestProof, verifyGoogleIdToken, zkLoginConfig } from '@/lib/zklogin-server';

export const dynamic = 'force-dynamic';

/**
 * Turn a Google identity token into a usable Sui account.
 *
 * Verify the token → derive the salt → derive the address → get a proof. One round trip, because
 * every step after the first depends on the one before it and splitting them would only give the
 * browser more chances to hold a half-finished session.
 *
 * # The salt does not come back
 *
 * The response carries the *address seed*, not the salt. The seed is what `ZkLoginSigner` needs and
 * it is already public — it is embedded in every zkLogin signature this account will ever produce.
 * The salt is not, and it stays here.
 *
 * A user who wants their salt can have it, from `/api/zklogin/export`, deliberately and knowingly.
 * That is the difference between a secret being available on request and a secret being handed to
 * every page that happens to sign in.
 *
 * # Legacy address derivation is off, permanently
 *
 * `legacyAddress: false` on both derivations. The flag selects between two incompatible ways of
 * hashing the same inputs, so it is not a preference — it decides which address a given Google
 * account maps to. Flipping it later would not migrate anybody; it would silently point every
 * existing user at an empty address that looks exactly as legitimate as their real one.
 */
export async function POST(request: Request) {
  const limited = rateLimit(request, 'simulate');
  if (limited !== null) return limited;

  const body = (await request.json()) as Record<string, unknown>;

  // Named individually so the message says which one is missing, rather than "bad request".
  const required = ['jwt', 'nonce', 'extendedEphemeralPublicKey', 'jwtRandomness'] as const;
  const missing = required.filter((key) => typeof body[key] !== 'string' || body[key] === '');
  if (missing.length > 0) {
    return NextResponse.json({ error: `missing: ${missing.join(', ')}` }, { status: 400 });
  }
  const maxEpoch = body['maxEpoch'];
  if (typeof maxEpoch !== 'number' || !Number.isInteger(maxEpoch) || maxEpoch <= 0) {
    return NextResponse.json({ error: 'maxEpoch must be a positive integer' }, { status: 400 });
  }

  const config = zkLoginConfig();
  if (!config.ok) {
    return NextResponse.json(
      { error: config.failure.detail, kind: config.failure.kind },
      { status: config.failure.kind === 'unconfigured' ? 501 : 500 },
    );
  }

  // Everything downstream trusts these claims completely, so nothing downstream runs until the
  // signature, the audience, the issuer, the expiry and the nonce have all been checked.
  const claims = await verifyGoogleIdToken({
    jwt: body['jwt'] as string,
    clientId: config.value.googleClientId,
    expectedNonce: body['nonce'] as string,
  });
  if (!claims.ok) {
    return NextResponse.json(
      { error: claims.failure.detail, kind: claims.failure.kind },
      { status: 401 },
    );
  }

  const salt = deriveUserSalt({
    seed: config.value.seed,
    iss: claims.value.iss,
    aud: claims.value.aud,
    sub: claims.value.sub,
  });

  /*
   * @mysten/sui 2.24.0, quoted verbatim so review is a comparison rather than a memory exercise:
   *
   *   genAddressSeed(salt: string | bigint, name: string, value: string, aud: string, …): bigint
   *   computeZkLoginAddressFromSeed(addressSeed: bigint, iss: string, legacyAddress: boolean): string
   *
   * `name` is the claim name and `value` is that claim's value — two same-typed strings, adjacent,
   * where swapping them yields a valid-looking seed for an address nobody controls.
   */
  const addressSeed = genAddressSeed(salt, KEY_CLAIM_NAME, claims.value.sub, claims.value.aud);
  const address = computeZkLoginAddressFromSeed(addressSeed, claims.value.iss, false);

  const payload: ProveRequest = {
    jwt: body['jwt'] as string,
    extendedEphemeralPublicKey: body['extendedEphemeralPublicKey'] as string,
    maxEpoch,
    jwtRandomness: body['jwtRandomness'] as string,
    salt: salt.toString(),
    keyClaimName: KEY_CLAIM_NAME,
  };

  const proof = await requestProof({
    proverUrl: config.value.proverUrl,
    proverKey: config.value.proverKey,
    payload: payload as unknown as Record<string, unknown>,
  });
  if (!proof.ok) {
    return NextResponse.json(
      { error: proof.failure.detail, kind: proof.failure.kind },
      { status: 502 },
    );
  }

  // A prover can answer 200 with something that is not a proof — a proxy error page, an HTML
  // challenge, a truncated body. Checked here, where the cause is still visible, rather than
  // several steps later inside BCS serialisation.
  const checked = checkProveResponse(proof.value);
  if (!checked.ok) {
    return NextResponse.json(
      { error: checked.failure.detail, kind: checked.failure.kind },
      { status: 502 },
    );
  }

  return NextResponse.json({
    address,
    addressSeed: addressSeed.toString(),
    proofPoints: checked.value.proofPoints,
    issBase64Details: checked.value.issBase64Details,
    headerBase64: checked.value.headerBase64,
  });
}
