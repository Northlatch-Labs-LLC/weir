// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { describe, expect, it, vi } from 'vitest';

/*
  An address one minute old holds nothing, and gas selection fails inside `build` before there is
  anything to simulate. What the reader is told then is the whole of this file.
*/
const PACKAGE = `0x${'e5'.repeat(32)}`;
let suiBalance = '0';
let balanceReadable = true;

vi.mock('@/lib/rate-limit', () => ({ simulateLimit: async () => null }));
vi.mock('@/lib/chain', () => ({
  siteConfig: () => ({
    ok: true,
    value: {
      network: 'mainnet',
      grpcUrl: 'https://fullnode.example.invalid:443',
      packageId: PACKAGE,
      latestPackageId: PACKAGE,
      platformId: `0x${'a1'.repeat(32)}`,
      registryId: `0x${'b2'.repeat(32)}`,
    },
    observedAtMs: 0,
  }),
  vaultCoinTypes: () => [],
}));
vi.mock('@projectx-social/sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@projectx-social/sdk')>()),
  /* A node that cannot select gas, which is what an unfunded sender meets. */
  createClient: () => ({
    core: {
      getBalance: async () => {
        if (!balanceReadable) throw new Error('the node did not answer');
        return { balance: { coinType: '0x2::sui::SUI', balance: suiBalance, coinBalance: suiBalance, addressBalance: suiBalance } };
      },
    },
  }),
}));

const { POST } = await import('../app/api/account/prepare/route');

const SENDER = `0x${'7c'.repeat(32)}`;

const prepare = (): Promise<Response> =>
  POST(
    new Request('https://weir.social/api/account/prepare', {
      method: 'POST',
      body: JSON.stringify({ sender: SENDER, handle: 'stderr', referrer: null }),
    }),
  );

describe('registering from an address that holds no SUI', () => {
  it('names the empty purse, the cost and the next move', async () => {
    suiBalance = '0';
    balanceReadable = true;

    const response = await prepare();
    const body = (await response.json()) as { error: string; kind: string };

    expect(body.kind).toBe('precondition');
    expect(response.status).toBe(409);
    expect(body.error).toContain('holds no SUI');
    expect(body.error).toContain('0.006');
    expect(body.error).toContain('Send some to this address');
  });

  it('does not describe our plumbing to the reader', async () => {
    suiBalance = '0';
    balanceReadable = true;

    const { error } = (await (await prepare()).json()) as { error: string };

    for (const machine of ["deployment's logs", 'simulation', 'undefined', 'Error:']) {
      expect(error).not.toContain(machine);
    }
  });

  it('claims nothing about a purse it could not read', async () => {
    balanceReadable = false;

    const response = await prepare();
    const body = (await response.json()) as { error: string; kind: string };

    expect(body.kind).not.toBe('precondition');
    expect(body.error).not.toContain('holds no SUI');
  });

  it('claims nothing about a purse that holds something', async () => {
    suiBalance = '5000000000';
    balanceReadable = true;

    const body = (await (await prepare()).json()) as { error: string; kind: string };

    expect(body.kind).not.toBe('precondition');
    expect(body.error).not.toContain('holds no SUI');
  });
});
