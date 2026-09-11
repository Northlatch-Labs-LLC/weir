// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { beforeEach, describe, expect, it, vi } from 'vitest';

// How many SealClients have been constructed, and what each encrypt did. The real client
// verifies its key server committee on chain when it is built, which is the cost this file
// exists to hold down.
const built = { count: 0 };
const encrypt = vi.fn();

vi.mock('@mysten/seal', () => ({
  SealClient: class {
    constructor() {
      built.count += 1;
    }
    encrypt = encrypt;
  },
}));

vi.mock('@/lib/chain', () => ({
  siteConfig: () => ({
    ok: true,
    value: {
      network: 'mainnet',
      grpcUrl: 'https://fullnode.example.invalid:443',
      packageId: `0x${'a1'.repeat(32)}`,
      latestPackageId: `0x${'b2'.repeat(32)}`,
    },
    observedAtMs: 0,
  }),
}));

const seal = await import('../lib/seal');

const KEY = Buffer.alloc(32, 7).toString('base64');
const ENV = {
  PROJECTX_SOCIAL_SEAL_KEY_SERVERS: `0x${'c3'.repeat(32)}|1,0x${'d4'.repeat(32)}|1`,
  PROJECTX_SOCIAL_SEAL_THRESHOLD: '1',
};

function sealOnce() {
  return seal.sealUnlockKey({ vaultId: `0x${'e5'.repeat(32)}`, contentKey: 'k', key: KEY });
}

beforeEach(() => {
  seal.forgetSealClient();
  built.count = 0;
  encrypt.mockReset();
  encrypt.mockResolvedValue({ encryptedObject: new Uint8Array([1, 2, 3]), key: new Uint8Array() });
  Object.assign(process.env, ENV);
});

describe('the seal client is built once, not once per seal', () => {
  it('four seals build one client', async () => {
    for (let i = 0; i < 4; i += 1) expect((await sealOnce()).ok).toBe(true);
    expect(built.count, 'one committee verification, not four').toBe(1);
    expect(encrypt).toHaveBeenCalledTimes(4);
  });

  it('a paid post seals twice and still builds one client', async () => {
    // sealBothEditions seals the human edition and the machine edition in turn.
    expect((await sealOnce()).ok).toBe(true);
    expect((await sealOnce()).ok).toBe(true);
    expect(built.count).toBe(1);
  });
});

describe('a seal that fails once is retried against a fresh client', () => {
  it('recovers, and the caller never sees the flake', async () => {
    encrypt
      .mockRejectedValueOnce(new Error('key server unreachable'))
      .mockResolvedValueOnce({ encryptedObject: new Uint8Array([9]), key: new Uint8Array() });

    const r = await sealOnce();
    expect(r.ok, 'one transport failure must not 503 a post that has already paid gas').toBe(true);
    expect(encrypt).toHaveBeenCalledTimes(2);
    expect(built.count, 'the retry rebuilds rather than re-asking the same committee').toBe(2);
  });

  it('twice failing is the answer, reported as transport', async () => {
    encrypt.mockRejectedValue(new Error('key server unreachable'));

    const r = await sealOnce();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure.kind).toBe('transport');
    expect(encrypt).toHaveBeenCalledTimes(2);
  });
});
