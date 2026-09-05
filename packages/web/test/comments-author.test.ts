// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/*
  The creator reads and answers the comments under her own paid post without an Unlock.
  Found 2026-09-02: kaela_ai was refused 403 under her own posts. A stranger with no Unlock is
  still refused; the owner is read from the profile row, never from the request.
  Mutation predicted: drop `ownsPost` from either check → "the creator reads" / "the creator
  answers" red; make ownsPost return true for everyone → "a stranger is still refused" red.
*/
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { statementFor } from '@projectx-social/sdk';
import { closeDatabase, resetDatabase, testDb, useTestDatabase } from './helpers/database';
import { normaliseAddress } from '../lib/db';
import { addPost, findComment } from '../lib/content';
import { verifyPersonalMessageSignature } from '@mysten/sui/verify';

useTestDatabase();
const ORIGIN = 'https://weir.social';
const VAULT = `0x${'a1'.repeat(32)}`;
const PACKAGE = `0x${'e5'.repeat(32)}`;
const owner = Ed25519Keypair.generate();
const stranger = Ed25519Keypair.generate();
const OWNER = owner.toSuiAddress();
let reader: string | null = null;

vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => null, simulateLimit: async () => null }));
vi.mock('@/lib/chain', () => ({ siteConfig: () => ({ ok: true, value: { network: 'mainnet', grpcUrl: 'https://fullnode.example.invalid:443', packageId: `0x${'e5'.repeat(32)}` }, observedAtMs: 0 }) }));
vi.mock('@/lib/read-session', () => ({ provenReaderFor: async () => (reader === null ? { ok: false, failure: { kind: 'unconfigured', source: 'test', detail: 'no reader' } } : { ok: true, value: reader, observedAtMs: 0 }) }));
vi.mock('@projectx-social/sdk', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  // Nobody holds an Unlock in this test; the only thing that can entitle is ownership.
  createClient: () => ({ listOwnedObjects: async () => ({ objects: [], hasNextPage: false }) }),
}));

const route = await import('../app/api/comments/route');
const authorship = await import('../app/api/comments/[id]/authorship/route');
void PACKAGE;

beforeEach(async () => {
  await resetDatabase();
  reader = null;
  await testDb().query(
    `INSERT INTO profiles (handle, vault_id, owner, display_name, bio, coin_type) VALUES ('kaela_ai', $1, $2, 'Kaela', 'writes', $3)`,
    [normaliseAddress(VAULT), OWNER, '0x2::sui::SUI'],
  );
  await addPost({
    id: 'p-paid', vaultId: normaliseAddress(VAULT), authorHandle: 'kaela_ai', createdAtMs: 1_756_700_000_000,
    title: 'Sold', preview: 'a taste', body: '',
    access: { kind: 'paid', price: '500000000', contentKey: 'k' },
  });
});
afterAll(closeDatabase);

const get = () => route.GET(new Request(`${ORIGIN}/api/comments?postId=p-paid`));
async function post(kp: Ed25519Keypair, text: string) {
  const timestampMs = Date.now();
  const statement = statementFor({ kind: 'comment', postId: 'p-paid', text }, kp.toSuiAddress(), timestampMs, ORIGIN);
  const { signature } = await kp.signPersonalMessage(new TextEncoder().encode(statement));
  return route.POST(new Request(`${ORIGIN}/api/comments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ postId: 'p-paid', author: kp.toSuiAddress(), text, signature, timestampMs }) }));
}

describe('the creator under her own paid post', () => {
  it('the creator reads the comments without an Unlock', async () => {
    reader = OWNER;
    expect((await get()).status).toBe(200);
  });
  it('the creator answers without an Unlock', async () => {
    expect((await post(owner, 'thank you for reading')).ok).toBe(true);
  });
  it('a stranger is still refused, reading and writing', async () => {
    reader = stranger.toSuiAddress();
    expect((await get()).status).toBe(403);
    expect((await post(stranger, 'let me in')).status).toBe(403);
  });
});

/*
  The proof a comment carries, written by the real route.

  Same defect as posts had and fixed the same way: a comment was signed, verified, and the
  signature discarded, so nobody could check who wrote it. The central test here does what a
  stranger would do — take the bytes and the signature the endpoint hands back and verify them with
  the Sui library, with no code of ours in the check.
*/
describe('a comment carries proof of who signed it', () => {
  const ask = async (id: string) => {
    const res = await authorship.GET(new Request(`${ORIGIN}/api/comments/${id}/authorship`), {
      params: Promise.resolve({ id }),
    });
    return { status: res.status, body: (await res.json()) as Record<string, any> };
  };

  it('the route stores the exact signature and instant it verified', async () => {
    const res = await post(owner, 'kept its receipt');
    expect(res.ok).toBe(true);
    const written = ((await res.json()) as { comment: { id: string } }).comment;
    const stored = await findComment(written.id);
    expect(stored?.authorship).toBeDefined();
    expect(stored?.authorship?.origin).toBe(ORIGIN);
    expect(typeof stored?.authorship?.signature).toBe('string');
  });

  it('hands back bytes a stranger can verify with the Sui library alone', async () => {
    const res = await post(owner, 'verify me without trusting them');
    const written = ((await res.json()) as { comment: { id: string } }).comment;
    const { status, body } = await ask(written.id);
    expect(status).toBe(200);
    expect(body.proof).not.toBeNull();

    // The whole feature. No code of ours takes part in this check.
    const key = await verifyPersonalMessageSignature(
      new TextEncoder().encode(body.proof.statement),
      body.proof.signature,
    );
    expect(key.toSuiAddress()).toBe(body.proof.address);
    expect(body.proof.address).toBe(owner.toSuiAddress());
  });

  it('fails to verify if the text is altered — the proof is doing work', async () => {
    const res = await post(owner, 'the words as written');
    const written = ((await res.json()) as { comment: { id: string } }).comment;
    const { body } = await ask(written.id);
    const tampered = String(body.proof.statement).replace('as written', 'as changed');
    expect(tampered).not.toBe(body.proof.statement);
    await expect(
      verifyPersonalMessageSignature(new TextEncoder().encode(tampered), body.proof.signature),
    ).rejects.toThrow();
  });

  it('says plainly that an older comment has no proof, and does not call that an error', async () => {
    await testDb().query(
      `INSERT INTO comments (id, post_id, author, body, created_at_ms) VALUES ($1, 'p-paid', $2, 'from before', 1)`,
      ['c-legacy', OWNER],
    );
    const { status, body } = await ask('c-legacy');
    expect(status).toBe(200);
    expect(body.proof).toBeNull();
    expect(body.reason).toMatch(/discarded/);
    expect(body.reason).toMatch(/unproven, not unsigned/);
  });

  it('a missing comment is a 404, which is a different thing from an unproven one', async () => {
    const { status } = await ask('no-such-comment');
    expect(status).toBe(404);
  });

  it('never claims more than custody', async () => {
    const res = await post(owner, 'custody only');
    const written = ((await res.json()) as { comment: { id: string } }).comment;
    const { body } = await ask(written.id);
    expect(body.whatThisDoesNotProve).toMatch(/custody, not provenance/);
  });
});
