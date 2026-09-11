// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { describe, expect, it } from 'vitest';

import { MAINNET_RECORD, isCoinType, isObjectId, loadAgentManifest } from '../src/index.js';

const CHAIN_ONLY = {
  PROJECTX_SOCIAL_NETWORK: 'mainnet',
  PROJECTX_SOCIAL_GRPC_URL: 'https://fullnode.mainnet.sui.io:443',
  PROJECTX_SOCIAL_PACKAGE_ID: MAINNET_RECORD.packageId,
  PROJECTX_SOCIAL_LATEST_PACKAGE_ID: MAINNET_RECORD.latestPackageId,
  PROJECTX_SOCIAL_PLATFORM_ID: MAINNET_RECORD.platformId,
  PROJECTX_SOCIAL_REGISTRY_ID: MAINNET_RECORD.registryId,
};

export const FULL_ENV = {
  ...CHAIN_ONLY,
  PROJECTX_SOCIAL_AGENT_COIN_TYPE: MAINNET_RECORD.usdcType,
  PROJECTX_SOCIAL_AGENT_BASE_URL: 'https://weir.social/',
};

describe('nothing is guessed', () => {
  it('an empty environment is `unconfigured`, not a mainnet default', () => {
    const reading = loadAgentManifest({});
    expect(reading.ok).toBe(false);
    if (!reading.ok) expect(reading.failure.kind).toBe('unconfigured');
  });

  it('a missing coin type is refused', () => {
    const reading = loadAgentManifest(CHAIN_ONLY);
    expect(reading.ok).toBe(false);
    if (!reading.ok) expect(reading.failure.detail).toContain('AGENT_COIN_TYPE');
  });

  it('a malformed coin type is refused', () => {
    expect(loadAgentManifest({ ...CHAIN_ONLY, PROJECTX_SOCIAL_AGENT_COIN_TYPE: '0xabc' }).ok).toBe(
      false,
    );
  });

  it('a missing base URL is refused', () => {
    const { PROJECTX_SOCIAL_AGENT_BASE_URL: _drop, ...rest } = FULL_ENV;
    expect(loadAgentManifest(rest).ok).toBe(false);
  });

  it('a non-http base URL is refused', () => {
    expect(
      loadAgentManifest({ ...FULL_ENV, PROJECTX_SOCIAL_AGENT_BASE_URL: 'ftp://weir.social' }).ok,
    ).toBe(false);
  });

  it('a non-positive gas budget is refused', () => {
    expect(loadAgentManifest(FULL_ENV, { gasBudgetMist: 0n }).ok).toBe(false);
  });
});

describe('a complete environment loads', () => {
  const reading = loadAgentManifest(FULL_ENV);

  it('loads', () => {
    expect(reading.ok).toBe(true);
  });

  it('strips the trailing slash', () => {
    expect(reading.ok && reading.value.baseUrl).toBe('https://weir.social');
  });

  it('carries BOTH package ids, and they are different values', () => {
    expect(reading.ok && reading.value.config.packageId).toBe(MAINNET_RECORD.packageId);
    expect(reading.ok && reading.value.config.latestPackageId).toBe(MAINNET_RECORD.latestPackageId);
    expect(MAINNET_RECORD.packageId).not.toBe(MAINNET_RECORD.latestPackageId);
  });
});

describe('the recorded mainnet ids are well formed', () => {
  it.each([
    ['packageId', MAINNET_RECORD.packageId],
    ['latestPackageId', MAINNET_RECORD.latestPackageId],
    ['platformId', MAINNET_RECORD.platformId],
    ['registryId', MAINNET_RECORD.registryId],
  ])('%s is a full 32-byte id', (_name, id) => {
    expect(isObjectId(id)).toBe(true);
  });

  it('the USDC type is a fully-qualified Move coin type', () => {
    expect(isCoinType(MAINNET_RECORD.usdcType)).toBe(true);
  });
});
