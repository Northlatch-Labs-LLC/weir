// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { describe, expect, it } from 'vitest';
import { loadSealConfig, SEAL_ENV } from '../src/index.js';

const SERVER_A = `0x${'11'.repeat(32)}`;
const SERVER_B = `0x${'22'.repeat(32)}`;
const SERVER_C = `0x${'33'.repeat(32)}`;

function env(overrides: Record<string, string | undefined>): Record<string, string | undefined> {
  return {
    [SEAL_ENV.keyServers]: `${SERVER_A},${SERVER_B}`,
    [SEAL_ENV.threshold]: '2',
    ...overrides,
  };
}

describe('loading the key server committee', () => {
  it('reads a plain comma-separated list, weighting each server once', () => {
    const config = loadSealConfig(env({}));
    expect(config.ok).toBe(true);
    if (!config.ok) return;
    expect(config.value.keyServers).toEqual([
      { objectId: SERVER_A, weight: 1 },
      { objectId: SERVER_B, weight: 1 },
    ]);
    expect(config.value.threshold).toBe(2);
  });

  it('reads weights and aggregator urls when they are given', () => {
    const config = loadSealConfig(
      env({
        [SEAL_ENV.keyServers]: `${SERVER_A}|2|https://aggregator.example, ${SERVER_B}|1`,
        [SEAL_ENV.threshold]: '3',
      }),
    );
    expect(config.ok).toBe(true);
    if (!config.ok) return;
    expect(config.value.keyServers).toEqual([
      { objectId: SERVER_A, weight: 2, aggregatorUrl: 'https://aggregator.example' },
      { objectId: SERVER_B, weight: 1 },
    ]);
  });

  it('leaves aggregatorUrl absent rather than empty for an independent server', () => {
    const config = loadSealConfig(env({ [SEAL_ENV.keyServers]: `${SERVER_A}||`, [SEAL_ENV.threshold]: '1' }));
    expect(config.ok).toBe(true);
    if (!config.ok) return;
    expect('aggregatorUrl' in config.value.keyServers[0]!).toBe(false);
  });
});

describe('an unset or malformed value fails at load, naming the variable', () => {
  it('names the key server variable when it is unset', () => {
    const config = loadSealConfig(env({ [SEAL_ENV.keyServers]: undefined }));
    expect(config.ok).toBe(false);
    if (config.ok) return;
    expect(config.failure.kind).toBe('unconfigured');
    expect(config.failure.detail).toContain(SEAL_ENV.keyServers);
  });

  it('names the key server variable when it is blank', () => {
    const config = loadSealConfig(env({ [SEAL_ENV.keyServers]: '   ' }));
    expect(config.ok).toBe(false);
    if (config.ok) return;
    expect(config.failure.detail).toContain(SEAL_ENV.keyServers);
  });

  it('names the threshold variable when it is unset', () => {
    const config = loadSealConfig(env({ [SEAL_ENV.threshold]: undefined }));
    expect(config.ok).toBe(false);
    if (config.ok) return;
    expect(config.failure.kind).toBe('unconfigured');
    expect(config.failure.detail).toContain(SEAL_ENV.threshold);
  });

  it('refuses an object id that is not a full 32-byte id', () => {
    const config = loadSealConfig(env({ [SEAL_ENV.keyServers]: '0x1234' }));
    expect(config.ok).toBe(false);
    if (config.ok) return;
    expect(config.failure.detail).toContain('0x1234');
  });

  it('refuses the whole list when one entry is malformed, rather than dropping that entry', () => {
    const config = loadSealConfig(env({ [SEAL_ENV.keyServers]: `${SERVER_A},oops,${SERVER_B}` }));
    expect(config.ok).toBe(false);
    if (config.ok) return;
    expect(config.failure.detail).toContain('oops');
  });

  it('refuses a duplicated key server', () => {
    const config = loadSealConfig(env({ [SEAL_ENV.keyServers]: `${SERVER_A},${SERVER_A}` }));
    expect(config.ok).toBe(false);
    if (config.ok) return;
    expect(config.failure.detail).toContain('twice');
  });

  it('refuses a non-http aggregator url', () => {
    const config = loadSealConfig(
      env({ [SEAL_ENV.keyServers]: `${SERVER_A}|1|aggregator.example` }),
    );
    expect(config.ok).toBe(false);
    if (config.ok) return;
    expect(config.failure.detail).toContain('aggregator.example');
  });

  it.each(['0', '-1', '1.5', 'two', ''])('refuses a weight of "%s"', (weight) => {
    const config = loadSealConfig(
      env({ [SEAL_ENV.keyServers]: `${SERVER_A}|${weight}`, [SEAL_ENV.threshold]: '1' }),
    );
    if (weight === '') {
      expect(config.ok).toBe(true);
      return;
    }
    expect(config.ok).toBe(false);
  });

  it.each(['0', '-1', '1.5', 'two'])('refuses a threshold of "%s"', (threshold) => {
    const config = loadSealConfig(env({ [SEAL_ENV.threshold]: threshold }));
    expect(config.ok).toBe(false);
  });

  it('refuses a threshold no committee could ever meet', () => {
    const config = loadSealConfig(
      env({ [SEAL_ENV.keyServers]: `${SERVER_A},${SERVER_B}`, [SEAL_ENV.threshold]: '3' }),
    );
    expect(config.ok).toBe(false);
    if (config.ok) return;
    expect(config.failure.detail).toContain('total weight of 2');
  });

  it('allows a threshold that weights make reachable', () => {
    const config = loadSealConfig(
      env({ [SEAL_ENV.keyServers]: `${SERVER_A}|2,${SERVER_B}`, [SEAL_ENV.threshold]: '3' }),
    );
    expect(config.ok).toBe(true);
  });

  it('refuses a list of nothing but separators', () => {
    const config = loadSealConfig(env({ [SEAL_ENV.keyServers]: ',,,' }));
    expect(config.ok).toBe(false);
    if (config.ok) return;
    expect(config.failure.detail).toContain('names no key server');
  });

  it('tolerates whitespace around entries, because a pasted list carries it', () => {
    const config = loadSealConfig(
      env({ [SEAL_ENV.keyServers]: `  ${SERVER_A} ,\t${SERVER_B} , ${SERVER_C} `, [SEAL_ENV.threshold]: '2' }),
    );
    expect(config.ok).toBe(true);
    if (!config.ok) return;
    expect(config.value.keyServers.map((s) => s.objectId)).toEqual([SERVER_A, SERVER_B, SERVER_C]);
  });
});

describe('credentials for a permissioned committee', () => {
  it('attaches the credential to every configured server', () => {
    const config = loadSealConfig(
      env({
        [SEAL_ENV.apiKeyName]: 'X-API-Key',
        [SEAL_ENV.apiKey]: 'not-a-real-credential',
      }),
    );
    expect(config.ok).toBe(true);
    if (!config.ok) return;
    for (const server of config.value.keyServers) {
      expect(server.apiKeyName).toBe('X-API-Key');
      expect(server.apiKey).toBe('not-a-real-credential');
    }
  });

  it('leaves both absent for open servers, rather than setting them empty', () => {
    const config = loadSealConfig(env({}));
    expect(config.ok).toBe(true);
    if (!config.ok) return;
    expect('apiKey' in config.value.keyServers[0]!).toBe(false);
    expect('apiKeyName' in config.value.keyServers[0]!).toBe(false);
  });

  it('refuses a credential with no header name', () => {
    const config = loadSealConfig(env({ [SEAL_ENV.apiKey]: 'not-a-real-credential' }));
    expect(config.ok).toBe(false);
    if (config.ok) return;
    expect(config.failure.detail).toContain(SEAL_ENV.apiKeyName);
  });

  it('refuses a header name with no credential', () => {
    const config = loadSealConfig(env({ [SEAL_ENV.apiKeyName]: 'X-API-Key' }));
    expect(config.ok).toBe(false);
    if (config.ok) return;
    expect(config.failure.detail).toContain(SEAL_ENV.apiKey);
  });

  it('never puts the credential in a failure message', () => {
    const secret = 'super-secret-credential-value';
    const config = loadSealConfig(env({ [SEAL_ENV.apiKey]: secret }));
    expect(config.ok).toBe(false);
    if (config.ok) return;
    expect(config.failure.detail).not.toContain(secret);
  });
});
