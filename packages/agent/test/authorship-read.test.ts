// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MAINNET_RECORD, createAgent, type ReadOnlyAgent } from '../src/index.js';

const POST = 'pmtke3kkjlYRoilQ7yfd2';
const PROOF = {
  address: `0x${'ab'.repeat(32)}`,
  signature: 'AQAAsignature',
  statement: 'Weir\naddress: 0x…\nissued: 1\norigin: https://weir.social\naction: publish',
  origin: 'https://weir.social',
  contentSha256: 'f'.repeat(64),
  issuedAtMs: 1788376431390,
};

let server: Server;
let baseUrl: string;
let answer: { status: number; body: unknown } = { status: 200, body: {} };
const paths: string[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    paths.push(req.url ?? '');
    res.writeHead(answer.status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(answer.body));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
});

function reader(): ReadOnlyAgent {
  const made = createAgent({
    keypair: null,
    config: {
      PROJECTX_SOCIAL_NETWORK: 'mainnet',
      PROJECTX_SOCIAL_GRPC_URL: 'https://fullnode.mainnet.sui.io:443',
      PROJECTX_SOCIAL_PACKAGE_ID: MAINNET_RECORD.packageId,
      PROJECTX_SOCIAL_LATEST_PACKAGE_ID: MAINNET_RECORD.latestPackageId,
      PROJECTX_SOCIAL_PLATFORM_ID: MAINNET_RECORD.platformId,
      PROJECTX_SOCIAL_REGISTRY_ID: MAINNET_RECORD.registryId,
      PROJECTX_SOCIAL_AGENT_COIN_TYPE: MAINNET_RECORD.usdcType,
      PROJECTX_SOCIAL_AGENT_BASE_URL: baseUrl,
    },
  });
  if (!made.ok) throw new Error(made.failure.detail);
  return made.value;
}

describe('reading who signed a post', () => {
  it('asks the documented path, with the id encoded', async () => {
    paths.length = 0;
    answer = { status: 200, body: { postId: POST, proof: PROOF, handleStillResolvesToSigner: true } };
    await reader().authorship({ postId: 'a/b?c' });
    expect(paths[0]).toBe('/api/posts/a%2Fb%3Fc/authorship');
  });

  it('returns the bytes and the signature untouched, for the caller to verify', async () => {
    answer = { status: 200, body: { postId: POST, proof: PROOF, handleStillResolvesToSigner: true } };
    const read = await reader().authorship({ postId: POST });
    expect(read.ok).toBe(true);
    if (!read.ok || read.value.proof === null) throw new Error('expected a proof');
    expect(read.value.proof.statement).toBe(PROOF.statement);
    expect(read.value.proof.address).toBe(PROOF.address);
    expect(read.value.handleStillResolvesToSigner).toBe(true);
  });

  it('treats a post with no kept proof as an answer, never a failure', async () => {
    const reason = 'No proof was kept for this post. It is unproven, not unsigned.';
    answer = { status: 200, body: { postId: POST, proof: null, reason } };
    const read = await reader().authorship({ postId: POST });
    expect(read.ok).toBe(true);
    if (!read.ok || read.value.proof !== null) throw new Error('expected an absence');
    expect(read.value.reason).toBe(reason);
  });

  it('refuses half a proof rather than handing one on', async () => {
    for (const missing of ['address', 'signature', 'statement', 'origin', 'contentSha256'] as const) {
      const partial: Record<string, unknown> = { ...PROOF };
      delete partial[missing];
      answer = { status: 200, body: { postId: POST, proof: partial } };
      const read = await reader().authorship({ postId: POST });
      expect(read.ok, `a proof missing ${missing} must be refused`).toBe(false);
      if (!read.ok) expect(read.failure.kind).toBe('malformed');
    }
  });

  it('refuses a non-numeric instant, which would name different bytes', async () => {
    answer = { status: 200, body: { postId: POST, proof: { ...PROOF, issuedAtMs: '1788376431390' } } };
    expect((await reader().authorship({ postId: POST })).ok).toBe(false);
  });

  it('says null when the deployment did not say, rather than guessing false', async () => {
    answer = { status: 200, body: { postId: POST, proof: PROOF } };
    const read = await reader().authorship({ postId: POST });
    if (!read.ok || read.value.proof === null) throw new Error('expected a proof');
    expect(read.value.handleStillResolvesToSigner).toBeNull();
  });

  it('a post that does not exist is a failure, not an absent proof', async () => {
    answer = { status: 404, body: { error: 'no such post' } };
    expect((await reader().authorship({ postId: 'nope' })).ok).toBe(false);
  });
});
