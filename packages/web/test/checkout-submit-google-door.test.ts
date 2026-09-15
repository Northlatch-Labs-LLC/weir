// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { describe, expect, it, vi } from 'vitest';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import { getZkLoginSignature, toZkLoginPublicIdentifier } from '@mysten/sui/zklogin';

/*
  A zkLogin proof is checked against the JSON Web Keys of the epoch it was made in, so the verdict
  belongs to a node. What is asserted here is what this deployment contributes: that the node is
  reached, with the bytes and the address the reader signed for, and that its three answers — yes,
  no, and silence — arrive as three different ones.
*/
interface Asked {
  bytes: string;
  signature: string;
  intentScope: string;
  address: string;
}
const asked: Asked[] = [];
let nodeAnswers: (asked: Asked) => { success: boolean; errors: string[] } = () => ({
  success: true,
  errors: [],
});

vi.mock('@/lib/rate-limit', () => ({
  simulateLimit: async () => null,
  quotaLimit: async () => null,
}));
vi.mock('@/lib/checkout', () => ({
  submitSigned: async () => ({ ok: true, value: 'DIGEST', observedAtMs: 0 }),
}));
vi.mock('@/lib/chain', () => ({
  siteConfig: () => ({
    ok: true,
    value: { network: 'mainnet', grpcUrl: 'https://fullnode.example.invalid:443' },
    observedAtMs: 0,
  }),
}));
vi.mock('@projectx-social/sdk', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@projectx-social/sdk')>()),
  createClient: () => ({
    core: {
      verifyZkLoginSignature: async (options: Asked) => {
        asked.push(options);
        return nodeAnswers(options);
      },
    },
  }),
}));

const { POST } = await import('../app/api/checkout/submit/route');

const ISS = 'https://accounts.google.com';
const ADDRESS_SEED = '15003662465165100657925599573950488063273572927438916476631347955230546477480';

/* The `iss` claim as the circuit hands it over: base64url, tightly packed, offset zero. */
const issBase64Details = {
  value: Buffer.from(`"iss":"${ISS}",`).toString('base64url'),
  indexMod4: 0,
};

const GOOGLE_ADDRESS = toZkLoginPublicIdentifier(BigInt(ADDRESS_SEED), ISS, {
  legacyAddress: false,
}).toSuiAddress();

/* A registration signed the way the join screen signs one: ephemeral key, wrapped in zkLogin. */
async function signedWithGoogle(): Promise<{ bytes: string; signature: string }> {
  const ephemeral = new Ed25519Keypair();
  const tx = new Transaction();
  tx.setSender(GOOGLE_ADDRESS);
  tx.setGasPrice(1000n);
  tx.setGasBudget(10_000_000n);
  tx.setGasPayment([{ objectId: `0x${'11'.repeat(32)}`, version: '1', digest: '1'.repeat(32) }]);
  tx.moveCall({ target: `0x${'e5'.repeat(32)}::account::open`, arguments: [] });
  const built = await tx.build();
  const { bytes, signature: userSignature } = await ephemeral.signTransaction(built);

  return {
    bytes,
    signature: getZkLoginSignature({
      inputs: {
        proofPoints: { a: ['1', '2', '1'], b: [['1', '2'], ['3', '4'], ['1', '0']], c: ['1', '2', '1'] },
        issBase64Details,
        headerBase64: Buffer.from('{"alg":"RS256","kid":"1","typ":"JWT"}').toString('base64url'),
        addressSeed: ADDRESS_SEED,
      },
      maxEpoch: 1000,
      userSignature,
    }),
  };
}

const submit = (body: unknown): Promise<Response> =>
  POST(
    new Request('https://weir.social/api/checkout/submit', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  );

describe('a transaction signed at the Google door', () => {
  it('is taken to the node, with the bytes and the address it was signed for', async () => {
    asked.length = 0;
    nodeAnswers = () => ({ success: true, errors: [] });

    const { bytes, signature } = await signedWithGoogle();
    const response = await submit({ bytes, signature });

    expect(asked).toHaveLength(1);
    expect(asked[0]!.address).toBe(GOOGLE_ADDRESS);
    expect(asked[0]!.intentScope).toBe('TransactionData');
    expect(asked[0]!.bytes).toBe(bytes);
    expect(await response.clone().json()).toEqual({ digest: 'DIGEST' });
    expect(response.status).toBe(200);
  });

  it('is refused, not submitted, when the node says the proof does not stand', async () => {
    asked.length = 0;
    nodeAnswers = () => ({ success: false, errors: ['signature error'] });

    const { bytes, signature } = await signedWithGoogle();
    const response = await submit({ bytes, signature });

    expect(response.status).toBe(401);
    expect(((await response.json()) as { kind: string }).kind).toBe('denied');
  });

  it('says the network could not be asked, rather than blaming the reader, when the node cannot answer', async () => {
    asked.length = 0;
    nodeAnswers = () => {
      throw new Error('the node did not respond');
    };

    const { bytes, signature } = await signedWithGoogle();
    const response = await submit({ bytes, signature });
    const body = (await response.json()) as { error: string; kind: string };

    expect(response.status).toBe(503);
    expect(body.kind).toBe('transport');
    expect(body.error).not.toContain('does not verify');
  });
});
