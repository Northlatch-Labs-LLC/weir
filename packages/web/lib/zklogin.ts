// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { fail, ok, type Reading } from '@projectx-social/sdk';

export const KEY_CLAIM_NAME = 'sub' as const;

export const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'] as const;

export function normaliseIssuer(iss: string): string {
  if (iss === 'accounts.google.com') return 'https://accounts.google.com';
  return iss;
}

export const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

export const MAX_EPOCH_WINDOW = 2n;

export const SESSION_STORAGE_KEY = 'projectx.zklogin.session';

export interface PendingSession {
  ephemeralSecretKey: string;
  jwtRandomness: string;
  maxEpoch: number;
  nonce: string;
  returnTo: string;
}

export interface ActiveSession extends PendingSession {
  address: string;
  jwt: string;
  salt: string;
  proofPoints: unknown;
  issBase64Details: unknown;
  headerBase64: string;
  addressSeed: string;
}

export function buildAuthUrl(input: {
  clientId: string;
  redirectUri: string;
  nonce: string;
}): string {
  const url = new URL(GOOGLE_AUTH_ENDPOINT);
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('response_type', 'id_token');
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('scope', 'openid');
  url.searchParams.set('nonce', input.nonce);
  return url.toString();
}

export function readIdTokenFromFragment(fragment: string): Reading<string> {
  const source = 'the sign-in redirect';
  const params = new URLSearchParams(fragment.startsWith('#') ? fragment.slice(1) : fragment);

  const declared = params.get('error');
  if (declared !== null) {
    const description = params.get('error_description');
    return fail('malformed', source, description ?? declared);
  }

  const token = params.get('id_token');
  if (token === null) {
    return fail('malformed', source, 'no identity token came back from the sign-in');
  }
  if (token.split('.').length !== 3) {
    return fail('malformed', source, 'the identity token is not a well-formed JWT');
  }
  return ok(token);
}

export function readUnverifiedClaims(
  jwt: string,
): Reading<{ iss: string; aud: string; sub: string; nonce?: string; email?: string }> {
  const source = 'identity token claims';
  const segments = jwt.split('.');
  const payload = segments[1];
  if (segments.length !== 3 || payload === undefined) {
    return fail('malformed', source, 'the identity token is not a well-formed JWT');
  }
  try {
    const json = new TextDecoder().decode(base64UrlDecode(payload));
    const claims = JSON.parse(json) as Record<string, unknown>;
    if (
      typeof claims['iss'] !== 'string' ||
      typeof claims['aud'] !== 'string' ||
      typeof claims['sub'] !== 'string'
    ) {
      return fail('malformed', source, 'the token is missing iss, aud or sub');
    }
    return ok({
      iss: claims['iss'],
      aud: claims['aud'],
      sub: claims['sub'],
      ...(typeof claims['nonce'] === 'string' ? { nonce: claims['nonce'] } : {}),
      ...(typeof claims['email'] === 'string' ? { email: claims['email'] } : {}),
    });
  } catch (error) {
    return fail('malformed', source, error instanceof Error ? error.message : String(error));
  }
}

export function base64UrlDecode(text: string): Uint8Array {
  const normalised = text.replaceAll('-', '+').replaceAll('_', '/');
  const padded = normalised.padEnd(normalised.length + ((4 - (normalised.length % 4)) % 4), '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export interface ProveRequest {
  jwt: string;
  extendedEphemeralPublicKey: string;
  maxEpoch: number;
  jwtRandomness: string;
  salt: string;
  keyClaimName: typeof KEY_CLAIM_NAME;
}

export interface ProveResponse {
  proofPoints: { a: string[]; b: string[][]; c: string[] };
  issBase64Details: { value: string; indexMod4: number };
  headerBase64: string;
}

export function checkProveResponse(body: unknown): Reading<ProveResponse> {
  const source = 'the proving service';
  const b = body as Partial<ProveResponse> | null | undefined;
  const points = b?.proofPoints;
  const iss = b?.issBase64Details;

  if (
    points === undefined ||
    !Array.isArray(points.a) ||
    !Array.isArray(points.b) ||
    !Array.isArray(points.c)
  ) {
    return fail('malformed', source, 'the response carried no usable proofPoints');
  }
  if (iss === undefined || typeof iss.value !== 'string' || typeof iss.indexMod4 !== 'number') {
    return fail('malformed', source, 'the response carried no usable issBase64Details');
  }
  if (typeof b?.headerBase64 !== 'string') {
    return fail('malformed', source, 'the response carried no headerBase64');
  }
  return ok({ proofPoints: points, issBase64Details: iss, headerBase64: b.headerBase64 });
}

export function maxEpochFrom(currentEpoch: bigint): Reading<number> {
  const source = 'max epoch';
  if (currentEpoch <= 0n) {
    return fail('malformed', source, `the chain reported epoch ${currentEpoch}`);
  }
  const max = currentEpoch + MAX_EPOCH_WINDOW;
  if (max > BigInt(Number.MAX_SAFE_INTEGER)) {
    return fail('malformed', source, 'the epoch is too large to represent exactly');
  }
  return ok(Number(max));
}

export function sessionExpired(session: { maxEpoch: number }, currentEpoch: bigint): boolean {
  return currentEpoch > BigInt(session.maxEpoch);
}
