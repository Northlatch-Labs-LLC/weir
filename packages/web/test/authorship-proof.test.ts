// @vitest-environment node
// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/**
 * A post's authorship, checkable by somebody who does not trust us.
 *
 * The point of the feature is that our agreement is not required, so the central test here does
 * what a stranger would do: take the bytes and the signature the route hands back, and verify them
 * with the Sui library, never with any code of ours. If that passes, the claim holds. If it only
 * passed through a helper of ours, it would prove nothing.
 */
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { verifyPersonalMessageSignature } from '@mysten/sui/verify';
import { createHash } from 'node:crypto';
import { GET } from '@/app/api/posts/[id]/authorship/route';
import { closeDatabase, resetDatabase, testDb, useTestDatabase } from './helpers/database';

useTestDatabase();

const { addPost, upsertProfile } = await import('@/lib/content');
type Post = Awaited<ReturnType<typeof import('@/lib/content').findPost>> & object;
const { statementFor } = await import('@/lib/identity');

const ORIGIN = 'https://weir.social';
const kp = new Ed25519Keypair();
const ADDRESS = kp.getPublicKey().toSuiAddress();
const VAULT = `0x${'ab'.repeat(32)}`;

const digest = (preview: string, text: string) =>
  createHash('sha256').update(`${preview.length}:${preview}${text.length}:${text}`).digest('hex');

async function call(id: string) {
  const res = await GET(new Request(`${ORIGIN}/api/posts/${id}/authorship`), {
    params: Promise.resolve({ id }),
  });
  return { status: res.status, body: (await res.json()) as Record<string, any> };
}

/** A post signed for real, exactly as `POST /api/posts` would have taken it. */
async function publishSigned(overrides: Partial<Post> = {}) {
  const id = `p-${Math.random().toString(36).slice(2, 11)}`;
  const preview = 'the preview a stranger can read';
  const text = 'the body, which they may not be able to';
  const issuedAtMs = Date.now();
  const contentSha256 = digest(preview, text);
  const statement = statementFor(
    { kind: 'publish', handle: 'prover', title: 'A signed post', access: 'public', contentSha256, contentKey: '', price: '' },
    ADDRESS,
    issuedAtMs,
    ORIGIN,
  );
  const { signature } = await kp.signPersonalMessage(new TextEncoder().encode(statement));
  const post: Post = {
    id, vaultId: VAULT, authorHandle: 'prover', createdAtMs: issuedAtMs,
    title: 'A signed post', preview, body: text, access: { kind: 'public' },
    authorship: { address: ADDRESS, issuedAtMs, origin: ORIGIN, contentSha256, signature },
    ...overrides,
  } as Post;
  await addPost(post);
  return { id, statement, signature };
}

describe('a post carries proof of who signed it', () => {
  beforeEach(async () => {
    await resetDatabase();
    await upsertProfile({
      handle: 'prover', owner: ADDRESS, vaultId: VAULT,
      displayName: 'Prover', bio: '', coinType: '0x2::sui::SUI',
    } as never);
  });
  afterAll(closeDatabase);

  it('hands back bytes a stranger can verify with the Sui library alone', async () => {
    const { id } = await publishSigned();
    const { status, body } = await call(id);
    expect(status).toBe(200);
    expect(body.proof).not.toBeNull();

    // This is the whole feature. No code of ours is involved in the check.
    const key = await verifyPersonalMessageSignature(
      new TextEncoder().encode(body.proof.statement),
      body.proof.signature,
    );
    expect(key.toSuiAddress()).toBe(body.proof.address);
    expect(body.proof.address).toBe(ADDRESS);
  });

  it('rebuilds the exact bytes that were signed, not an approximation', async () => {
    const { id, statement } = await publishSigned();
    const { body } = await call(id);
    expect(body.proof.statement).toBe(statement);
  });

  it('fails to verify if any signed field is altered — the proof is doing work', async () => {
    const { id } = await publishSigned();
    const { body } = await call(id);
    const tampered = String(body.proof.statement).replace('A signed post', 'A different post');
    expect(tampered).not.toBe(body.proof.statement);
    await expect(
      verifyPersonalMessageSignature(new TextEncoder().encode(tampered), body.proof.signature),
    ).rejects.toThrow();
  });

  it('says plainly that an older post has no proof, and does not call that an error', async () => {
    // A post from before this existed: signed at the time, proof discarded.
    const id = 'legacy-post';
    await addPost({
      id, vaultId: VAULT, authorHandle: 'prover', createdAtMs: Date.now(),
      title: 'Published before the proof was kept', preview: 'p', body: 'b', access: { kind: 'public' },
    } as Post);
    const { status, body } = await call(id);
    expect(status).toBe(200);
    expect(body.proof).toBeNull();
    expect(body.reason).toMatch(/discarded/);
    // The distinction the whole feature turns on.
    expect(body.reason).toMatch(/unproven, not unsigned/);
  });

  it('a missing post is a 404, which is a different thing from an unproven one', async () => {
    const { status, body } = await call('no-such-post');
    expect(status).toBe(404);
    expect(body.proof).toBeUndefined();
  });

  it('reports whether the handle still resolves to the signer, without calling a mismatch a forgery', async () => {
    const { id } = await publishSigned();
    expect((await call(id)).body.handleStillResolvesToSigner).toBe(true);

    // The account changes hands. The signature is still good; the handle no longer points at it.
    const other = new Ed25519Keypair().getPublicKey().toSuiAddress();
    await testDb().query('UPDATE profiles SET owner = $1 WHERE handle = $2', [other, 'prover']);
    const { body } = await call(id);
    expect(body.handleStillResolvesToSigner).toBe(false);
    expect(body.proof).not.toBeNull();
    const key = await verifyPersonalMessageSignature(
      new TextEncoder().encode(body.proof.statement),
      body.proof.signature,
    );
    expect(key.toSuiAddress()).toBe(ADDRESS);
  });

  it('never claims more than custody', async () => {
    const { id } = await publishSigned();
    const { body } = await call(id);
    expect(body.whatThisDoesNotProve).toMatch(/custody, not provenance/);
  });
});
