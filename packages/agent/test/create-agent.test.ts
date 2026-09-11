// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { verifyPersonalMessageSignature } from '@mysten/sui/verify';
import { describe, expect, it } from 'vitest';

import { MAINNET_RECORD, createAgent, generateAgentKey } from '../src/index.js';

const FULL_ENV = {
  PROJECTX_SOCIAL_NETWORK: 'mainnet',
  PROJECTX_SOCIAL_GRPC_URL: 'https://fullnode.mainnet.sui.io:443',
  PROJECTX_SOCIAL_PACKAGE_ID: MAINNET_RECORD.packageId,
  PROJECTX_SOCIAL_LATEST_PACKAGE_ID: MAINNET_RECORD.latestPackageId,
  PROJECTX_SOCIAL_PLATFORM_ID: MAINNET_RECORD.platformId,
  PROJECTX_SOCIAL_REGISTRY_ID: MAINNET_RECORD.registryId,
  PROJECTX_SOCIAL_AGENT_COIN_TYPE: MAINNET_RECORD.usdcType,
  PROJECTX_SOCIAL_AGENT_BASE_URL: 'https://weir.social/',
};

const { key } = generateAgentKey();

describe('createAgent', () => {
  const made = createAgent({ keypair: key, config: FULL_ENV });

  it('builds an agent from an environment', () => {
    expect(made.ok).toBe(true);
  });

  it('reports a padded address', () => {
    expect(made.ok && /^0x[0-9a-f]{64}$/.test(made.value.address)).toBe(true);
  });

  it('holds no Seal implementation unless one is supplied', () => {
    expect(made.ok && made.value.seal).toBeNull();
  });

  it('carries the LATEST package id for moveCall targets', () => {
    expect(made.ok && made.value.manifest.config.latestPackageId).toBe(
      MAINNET_RECORD.latestPackageId,
    );
  });

  it('signs as the agent address', async () => {
    expect(made.ok).toBe(true);
    if (made.ok) {
      const signed = await made.value.sign({ kind: 'read-content' });
      const pk = await verifyPersonalMessageSignature(
        new TextEncoder().encode(signed.statement),
        signed.signature,
        { address: made.value.address },
      );
      expect(pk.toSuiAddress()).toBe(made.value.address);
    }
  });

  it('accepts a bech32 secret as well as a loaded key', () => {
    const { secret } = generateAgentKey();
    expect(createAgent({ keypair: secret, config: FULL_ENV }).ok).toBe(true);
  });

  it('lets baseUrl override the manifest, normalised', () => {
    const overridden = createAgent({
      keypair: key,
      config: FULL_ENV,
      baseUrl: 'https://staging.weir.social/',
    });
    expect(overridden.ok && overridden.value.manifest.baseUrl).toBe('https://staging.weir.social');
  });

  it('REFUSES an unconfigured environment rather than defaulting to mainnet', () => {
    expect(createAgent({ keypair: key, config: {} }).ok).toBe(false);
  });

  it('REFUSES a bad key', () => {
    expect(createAgent({ keypair: 'nope', config: FULL_ENV }).ok).toBe(false);
  });
});

describe('the surface exports nothing that cannot work', () => {
  const made = createAgent({ keypair: key, config: FULL_ENV });

  it('exports feed(), over the endpoint that exists', () => {
    expect(made.ok && typeof made.value.feed).toBe('function');
  });

  it('quote() takes the vault and content key, which DO exist on chain', () => {
    expect(made.ok && typeof made.value.quote).toBe('function');
  });

  it('every callable member is a plain function on the object', () => {
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    const agent = made.value;
    for (const name of [
      'sign',
      'session',
      'openAccount',
      'quote',
      'unlock',
      'subscribe',
      'tip',
      'post',
      'send',
      'balance',
    ] as const) {
      expect(typeof agent[name], `${name} is missing from the agent`).toBe('function');
    }
  });
});

describe('two agents in one process do not share a session', () => {
  it('each holds its own credential in its own closure', async () => {
    const a = generateAgentKey();
    const b = generateAgentKey();
    const seen: string[] = [];

    const agentA = createAgent({
      keypair: a.key,
      config: FULL_ENV,
      fetchImpl: async (_url, init) => {
        seen.push(String(JSON.parse(String(init?.body)).address));
        return new Response(JSON.stringify({ address: a.key.address, token: 'A' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    });
    const agentB = createAgent({
      keypair: b.key,
      config: FULL_ENV,
      fetchImpl: async (_url, init) => {
        seen.push(String(JSON.parse(String(init?.body)).address));
        return new Response(JSON.stringify({ address: b.key.address, token: 'B' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
    });

    expect(agentA.ok && agentB.ok).toBe(true);
    if (!agentA.ok || !agentB.ok) return;

    const sa = await agentA.value.session();
    const sb = await agentB.value.session();
    expect(sa.ok && sa.value.headers()['Authorization']).toBe('Bearer A');
    expect(sb.ok && sb.value.headers()['Authorization']).toBe('Bearer B');

    await agentA.value.session();
    expect(seen).toEqual([agentA.value.address, agentB.value.address]);
  });
});
