// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import 'server-only';

import { randomBytes } from 'node:crypto';
import { SignJWT } from 'jose';
import { fail, ok, type Reading } from '@projectx-social/sdk';
import { MAX_EPOCHS } from './walrus';

export type StorageTier = 'ephemeral' | 'durable';

import { TIER_EPOCHS } from './storage-retention';

export { TIER_EPOCHS };

export const LIFETIME_SECONDS = 60;

export interface UploadGrant {
  token: string;
  epochs: number;
  size: number;
}

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
    return fail('malformed', source, 'the publisher JWT secret must be at least 32 characters');
  }
  return ok(new TextEncoder().encode(value));
}

export async function grantUpload(input: {
  owner: string;
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
    return fail('malformed', source, 'the owner must be a 0x-prefixed 32-byte Sui address');
  }

  const epochs = TIER_EPOCHS[input.tier];
  const now = Math.floor(Date.now() / 1000);

  const token = await new SignJWT({
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
