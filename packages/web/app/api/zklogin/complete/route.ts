// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { NextResponse } from 'next/server';
import { simulateLimit } from '@/lib/rate-limit';
import { computeZkLoginAddressFromSeed, genAddressSeed } from '@mysten/sui/zklogin';
import { checkProveResponse, KEY_CLAIM_NAME, type ProveRequest } from '@/lib/zklogin';
import { deriveUserSalt, requestProof, verifyGoogleIdToken, zkLoginConfig } from '@/lib/zklogin-server';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const limited = await simulateLimit(request);
  if (limited !== null) return limited;

  const body = (await request.json()) as Record<string, unknown>;

  const required = ['jwt', 'extendedEphemeralPublicKey', 'jwtRandomness'] as const;
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

  const claims = await verifyGoogleIdToken({
    jwt: body['jwt'] as string,
    clientId: config.value.googleClientId,
    commitment: {
      extendedEphemeralPublicKey: body['extendedEphemeralPublicKey'] as string,
      maxEpoch,
      jwtRandomness: body['jwtRandomness'] as string,
    },
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
      { status: 424 },
    );
  }

  const checked = checkProveResponse(proof.value);
  if (!checked.ok) {
    return NextResponse.json(
      { error: checked.failure.detail, kind: checked.failure.kind },
      { status: 424 },
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
