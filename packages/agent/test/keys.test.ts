// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { describe, expect, it } from 'vitest';

import {
  agentKeyFromEnv,
  agentKeyFromSecret,
  generateAgentKey,
  normaliseAddress,
  sameAddress,
} from '../src/index.js';

describe('loading a key', () => {
  it('a generated secret round-trips', () => {
    const { key, secret } = generateAgentKey();
    const loaded = agentKeyFromSecret(secret);
    expect(loaded.ok).toBe(true);
    expect(loaded.ok && loaded.value.address).toBe(key.address);
  });

  it('raw hex is refused, however plausible it looks', () => {
    expect(agentKeyFromSecret(`0x${'a'.repeat(64)}`).ok).toBe(false);
  });

  it('an empty secret is refused', () => {
    expect(agentKeyFromSecret('   ').ok).toBe(false);
  });

  it('a missing environment variable names the variable', () => {
    const reading = agentKeyFromEnv({});
    expect(reading.ok).toBe(false);
    if (!reading.ok) expect(reading.failure.detail).toContain('PROJECTX_SOCIAL_AGENT_SECRET');
  });
});

describe('a failed decode NEVER quotes its input', () => {
  it('does not echo an obviously bad string', () => {
    const reading = agentKeyFromSecret('not-a-key');
    expect(reading.ok).toBe(false);
    if (!reading.ok) {
      expect(reading.failure.detail).not.toContain('not-a-key');
      expect(reading.failure.detail).toContain('deliberately not shown');
    }
  });

  it('does not echo a CORRUPTED REAL secret either — the dangerous case', () => {
    const { secret } = generateAgentKey();
    const corrupted = `${secret.slice(0, -3)}xyz`;
    const reading = agentKeyFromSecret(corrupted);
    expect(reading.ok).toBe(false);
    if (!reading.ok) {
      expect(reading.failure.detail).not.toContain(secret.slice(10, 40));
      expect(reading.failure.detail).not.toContain(corrupted);
    }
  });

  it('an AgentKey exposes no accessor that returns the secret', () => {
    const { key } = generateAgentKey();
    expect(Object.keys(key).sort()).toEqual(['address', 'keypair']);
    expect(JSON.stringify(key)).not.toContain('suiprivkey');
  });
});

describe('addresses compare by value, not by spelling', () => {
  it('pads a short address to 32 bytes', () => {
    expect(normaliseAddress('0x2')).toBe(`0x${'0'.repeat(63)}2`);
  });

  it('folds case', () => {
    expect(normaliseAddress('0xAB')).toBe(normaliseAddress('0xab'));
  });

  it('treats padded and unpadded forms as the same account', () => {
    expect(sameAddress('0x2', `0x${'0'.repeat(63)}2`)).toBe(true);
  });

  it('does not claim two different addresses are the same', () => {
    expect(sameAddress('0x2', '0x3')).toBe(false);
  });

  it('leaves an unrecognisable string alone rather than padding nonsense', () => {
    expect(normaliseAddress('not-an-address')).toBe('not-an-address');
  });
});
