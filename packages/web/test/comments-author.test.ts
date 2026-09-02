// @vitest-environment node
// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
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
import { addPost } from '../lib/content';

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
