// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import 'server-only';
import { opaqueDetail } from './opaque';

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
  proverKey: string;
  seed: Uint8Array;
}

export const PROVER_KEY_HEADER = 'x-projectx-prover-key';

export const ZKLOGIN_ENV = [
  'PROJECTX_SOCIAL_GOOGLE_CLIENT_ID',
  'PROJECTX_SOCIAL_ZKLOGIN_REDIRECT_URI',
  'PROJECTX_SOCIAL_ZKLOGIN_PROVER_URL',
  'PROJECTX_SOCIAL_ZKLOGIN_SEED',
] as const;

export const MIN_SEED_BYTES = 32;

export function zkLoginConfig(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): Reading<ZkLoginServerConfig> {
  const source = 'zkLogin configuration';

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
  if (!proverUrl.startsWith('https://') && !proverUrl.startsWith('http://localhost')) {
    return fail(
      'malformed',
      source,
      'PROJECTX_SOCIAL_ZKLOGIN_PROVER_URL must be https, or http://localhost for a prover on this machine',
    );
  }

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

const googleKeys = createRemoteJWKSet(new URL(GOOGLE_JWKS_URL));

export interface VerifiedClaims {
  iss: string;
  aud: string;
  sub: string;
  nonce: string;
}

export type NonceCommitment = {
  extendedEphemeralPublicKey: string;
  maxEpoch: number;
  jwtRandomness: string;
};

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

export async function verifyGoogleIdToken(input: {
  jwt: string;
  clientId: string;
  commitment: NonceCommitment;
  keys?: Parameters<typeof jwtVerify>[1];
}): Promise<Reading<VerifiedClaims>> {
  const source = 'Google identity token';
  try {
    const { payload } = await jwtVerify(input.jwt, input.keys ?? googleKeys, {
      algorithms: ['RS256'],
      audience: input.clientId,
      issuer: [...GOOGLE_ISSUERS],
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
      return fail('malformed', source, expected.failure.detail);
    }
    if (nonce !== expected.value) {
      return fail(
        'malformed',
        source,
        'this token belongs to a different sign-in attempt — start again',
      );
    }

    return ok({ iss: normaliseIssuer(iss), aud, sub, nonce });
  } catch (error) {
    return fail('malformed', source, opaqueDetail(source, error));
  }
}

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
  let salt = 0n;
  for (const byte of bytes) salt = (salt << 8n) | BigInt(byte);
  return salt;
}

function originIsDown(status: number): boolean {
  return status === 502 || status === 503 || status === 504 || (status >= 520 && status <= 530);
}

function proverDetail(status: number, body: string): string {
  const looksLikeMarkup = /^\s*<(?:!doctype|html|head|body)/i.test(body);
  if (looksLikeMarkup || originIsDown(status)) {
    return `the proving service did not answer (${status} from the host in front of it)`;
  }
  const trimmed = body.trim().slice(0, 200);
  return `the prover answered ${status}${trimmed === '' ? '' : `: ${trimmed}`}`;
}

let proverProbe: { atMs: number; result: Reading<'reachable'> } | null = null;

export async function proverReachable(
  config: ZkLoginServerConfig,
  nowMs: number = Date.now(),
): Promise<Reading<'reachable'>> {
  const source = 'the proving service';
  const CACHE_MS = 60_000;
  if (proverProbe !== null && nowMs - proverProbe.atMs < CACHE_MS) return proverProbe.result;

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 4_000);
  let result: Reading<'reachable'>;
  try {
    const key = config.proverKey.trim();
    const response = await fetch(config.proverUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(key === '' ? {} : { [PROVER_KEY_HEADER]: key }),
      },
      body: '{}',
      signal: abort.signal,
    });
    result =
      response.status === 403
        ? fail(
            'transport',
            source,
            "refused at the edge — PROJECTX_SOCIAL_ZKLOGIN_PROVER_KEY does not match the rule guarding the proving service's hostname",
          )
        : originIsDown(response.status)
          ? fail(
              'transport',
              source,
              `the host in front of the prover answered ${response.status}, which is what it says when the machine behind it is not connected`,
            )
          : ok('reachable' as const, nowMs);
  } catch (cause) {
    result = fail(
      'transport',
      source,
      cause instanceof Error && cause.name === 'AbortError'
        ? 'did not answer within four seconds'
        : 'could not be reached',
    );
  } finally {
    clearTimeout(timer);
  }

  proverProbe = { atMs: nowMs, result };
  return result;
}

export function forgetProverProbe(): void {
  proverProbe = null;
}

export async function requestProof(input: {
  proverUrl: string;
  proverKey?: string;
  payload: Record<string, unknown>;
  timeoutMs?: number;
}): Promise<Reading<unknown>> {
  const source = 'the proving service';
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
      if (response.status === 403) {
        return fail(
          'transport',
          source,
          "refused at the edge, not by the prover — PROJECTX_SOCIAL_ZKLOGIN_PROVER_KEY does not match the rule guarding the proving service's hostname",
        );
      }
      return fail('transport', source, proverDetail(response.status, detail));
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
