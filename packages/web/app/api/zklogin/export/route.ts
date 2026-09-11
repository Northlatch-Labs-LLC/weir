// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { NextResponse } from 'next/server';
import { simulateLimit } from '@/lib/rate-limit';
import { deriveUserSalt, verifyGoogleIdToken, zkLoginConfig } from '@/lib/zklogin-server';

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

  return NextResponse.json({
    salt: salt.toString(),
    iss: claims.value.iss,
    aud: claims.value.aud,
    sub: claims.value.sub,
    keyClaimName: 'sub',
    legacyAddress: false,
    note: 'Keep all five values together. With them, a Google sign-in and any zkLogin proving service reconstruct this address and sign from it without this platform.',
  });
}
