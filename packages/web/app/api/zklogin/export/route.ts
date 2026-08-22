// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { deriveUserSalt, verifyGoogleIdToken, zkLoginConfig } from '@/lib/zklogin-server';

export const dynamic = 'force-dynamic';

/**
 * The escape hatch: hand a user their own salt.
 *
 * # Why this route has to exist
 *
 * This platform's claim is that identity and payments are on-chain objects rather than database
 * rows. zkLogin, as deployed here, quietly puts an asterisk on that: the salt is derived from a
 * seed this deployment holds, so an account created through Google is reachable only for as long
 * as this deployment keeps that seed. If it disappeared, so would every zkLogin address it issued.
 *
 * That is a real dependency and it cannot be argued away. It can be *ended*, which is what this
 * route does. Salt plus a Google sign-in plus any proving service reconstructs the address and
 * signs from it with nothing from us — the same address, the same funds, no permission asked.
 *
 * A user who exports their salt has converted a hosted convenience into self-custody. That is the
 * property that lets the rest of the design stand up honestly.
 *
 * # Why it is a POST, and separate
 *
 * It costs a fresh, nonce-bound, Google-signed token: the same proof of control that signing in
 * requires, spent again, deliberately, for this one purpose. Folding it into `/complete` would hand
 * the salt to every page that ever signed a user in, which is how a secret ends up in a log, an
 * analytics payload, or a session store that was never designed to hold one.
 */
export async function POST(request: Request) {
  const limited = rateLimit(request, 'simulate');
  if (limited !== null) return limited;

  const body = (await request.json()) as Record<string, unknown>;

  const required = ['jwt', 'nonce'] as const;
  const missing = required.filter((key) => typeof body[key] !== 'string' || body[key] === '');
  if (missing.length > 0) {
    return NextResponse.json({ error: `missing: ${missing.join(', ')}` }, { status: 400 });
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

  // The claims come back too. A salt on its own recovers nothing — the address is a function of
  // `iss`, `aud`, `sub` *and* the salt, so a user who keeps only the number has kept a quarter of
  // what they need. Anyone building a recovery tool needs all four, and finding that out later,
  // without a working deployment to ask, is too late.
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
