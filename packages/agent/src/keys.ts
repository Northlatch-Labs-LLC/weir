// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { fail, ok, type Reading } from '@projectx-social/sdk';
import { AGENT_ENV } from './manifest.js';

export interface AgentKey {
  readonly address: string;
  readonly keypair: Ed25519Keypair;
}

export function agentKeyFromSecret(secret: string): Reading<AgentKey> {
  const source = 'agent key';

  const trimmed = secret.trim();
  if (trimmed === '') {
    return fail('unconfigured', source, 'the signing secret is empty.');
  }

  let keypair: Ed25519Keypair;
  try {
    keypair = Ed25519Keypair.fromSecretKey(trimmed);
  } catch (error) {
    void error;
    return fail(
      'unconfigured',
      source,
      'the signing secret could not be decoded as a bech32 Ed25519 Sui private key ' +
        '(suiprivkey1…). Its value is deliberately not shown.',
    );
  }

  return ok({ address: keypair.toSuiAddress(), keypair });
}

export function agentKeyFromEnv(env: Record<string, string | undefined>): Reading<AgentKey> {
  const value = env[AGENT_ENV.secret];
  if (value === undefined || value.trim() === '') {
    return fail(
      'unconfigured',
      'agent key',
      `${AGENT_ENV.secret} is not set. An agent signs as itself and there is no default key — ` +
        `generate one with generateAgentKey() and fund it, or export an existing one with ` +
        `\`sui keytool export\`.`,
    );
  }
  return agentKeyFromSecret(value);
}

export function generateAgentKey(): { key: AgentKey; secret: string } {
  const keypair = Ed25519Keypair.generate();
  return {
    key: { address: keypair.toSuiAddress(), keypair },
    secret: keypair.getSecretKey(),
  };
}

export function normaliseAddress(address: string): string {
  const lower = address.trim().toLowerCase();
  if (!/^0x[0-9a-f]{1,64}$/.test(lower)) return lower;
  return `0x${lower.slice(2).padStart(64, '0')}`;
}

export function sameAddress(a: string, b: string): boolean {
  return normaliseAddress(a) === normaliseAddress(b);
}
