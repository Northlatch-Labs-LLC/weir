// @vitest-environment node
// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
/**
 * `POST /api/creator/profile` against a real database.
 *
 * # The defect this exists to catch
 *
 * The endpoint keys a row by the handle the chain reports. An account whose row was filed under an
 * older name therefore got a *second* row on every save: the write returned 200, and every page
 * carried on reading the first row. From the creator's side their display name simply refused to
 * change, and saving again produced another duplicate rather than fixing it.
 *
 * None of that is visible without a database. The SQL was valid, the handler returned success, and
 * the row it wrote was exactly the row it meant to write — the mistake was *which row it looked
 * for*. A mocked store returns what the mock was told to return, and agrees with the bug.
 *
 * # What is mocked, and why only this much
 *
 * The chain is mocked: ownership and the handle come from Sui, and reaching mainnet here would make
 * the test slow, flaky, and dependent on state nobody controls. Everything below the handler —
 * `lib/content`, `lib/db`, the schema, its constraints and the unique index — is real, which is
 * where the defect lived.
 */

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDatabase, resetDatabase, testDb, useTestDatabase } from '../helpers/database';

// Before the route is imported, so `lib/db` can only ever see the disposable database.
useTestDatabase();

/** Synthetic throughout — no address here corresponds to anything on chain. */
const OWNER = `0x${'a1'.repeat(32)}`;
const VAULT = `0x${'b2'.repeat(32)}`;
const COIN = '0xdba34672::usdc::USDC';

/** What the registry says this address's handle is. Reassigned per test. */
let chainHandle: string | null = 'newname';

/*
  The signature check is stubbed for the tests below, which are about which row gets written. It is
  exercised on its own at the end of this file — a mock that always passes would otherwise remove
  the gate from every test here without anybody noticing.
*/
let proofOk = true;
vi.mock('@/lib/identity', () => ({
  verifyAction: async () =>
    proofOk
      ? { ok: true, value: true }
      : { ok: false, failure: { kind: 'malformed', source: 'proof', detail: 'bad signature' } },
}));

vi.mock('@/lib/chain', () => ({
  siteConfig: () => ({ ok: true, value: { network: 'mainnet' } }),
}));

vi.mock('@/lib/accounts', () => ({
  accountHandle: async () => ({ ok: true, value: chainHandle }),
}));

vi.mock('@projectx-social/sdk', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createClient: () => ({}),
  // The vault exists and belongs to OWNER. Ownership is read from chain, never taken from the body.
  readCreatorVault: async () => ({ ok: true, value: { owner: OWNER } }),
}));

const { POST, MAX_DISPLAY_NAME_LENGTH, MAX_BIO_LENGTH } = await import(
  '@/app/api/creator/profile/route'
);

function save(body: Record<string, string>): Promise<Response> {
  return POST(
    new Request('http://localhost/api/creator/profile', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(async () => {
  await resetDatabase();
  chainHandle = 'newname';
});

afterAll(async () => {
  await closeDatabase();
});

describe('POST /api/creator/profile', () => {
  it('updates the row that already names the vault, whatever handle it is filed under', async () => {
    // A row filed under a name the chain no longer reports — the drift that caused the defect.
    await testDb().query(
      `INSERT INTO profiles (handle, vault_id, owner, display_name, bio, coin_type)
       VALUES ('oldname', $1, $2, 'Before', 'old bio', $3)`,
      [VAULT, OWNER, COIN],
    );

    const response = await save({
      owner: OWNER,
      vaultId: VAULT,
      coinType: COIN,
      displayName: 'Blitz vault',
      bio: 'a new description',
    });

    expect(response.status).toBe(200);
    // The existing row's handle is kept: the row pages already read is the row that is written.
    expect(await response.json()).toEqual({ handle: 'oldname' });

    const { rows } = await testDb().query('SELECT handle, display_name, bio FROM profiles');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      handle: 'oldname',
      display_name: 'Blitz vault',
      bio: 'a new description',
    });
  });

  it('saves twice without producing a second row for one vault', async () => {
    const body = { owner: OWNER, vaultId: VAULT, coinType: COIN, displayName: 'Twice', bio: 'b' };
    expect((await save(body)).status).toBe(200);
    expect((await save(body)).status).toBe(200);

    const { rows } = await testDb().query('SELECT count(*)::int AS n FROM profiles');
    expect(rows[0]?.n).toBe(1);
  });

  /*
    The other half of the same family: a full-row upsert wrote NULL over a column the caller does
    not send, so naming a vault unlinked that creator's no-loss vault while it carried on holding
    deposits.
  */
  it('refuses a vault owned by somebody else', async () => {
    const response = await save({
      owner: `0x${'99'.repeat(32)}`,
      vaultId: VAULT,
      coinType: COIN,
      displayName: 'Theft',
      bio: '',
    });

    expect(response.status).toBe(403);
    const { rows } = await testDb().query('SELECT count(*)::int AS n FROM profiles');
    expect(rows[0]?.n).toBe(0);
  });

  it('refuses an address the registry gives no handle', async () => {
    chainHandle = null;
    const response = await save({
      owner: OWNER,
      vaultId: VAULT,
      coinType: COIN,
      displayName: 'Nameless',
      bio: '',
    });

    expect(response.status).toBe(400);
    const { rows } = await testDb().query('SELECT count(*)::int AS n FROM profiles');
    expect(rows[0]?.n).toBe(0);
  });
});

/**
 * The route compared the request's `owner` against the vault's owner read from chain. That reads
 * like a check and is not one: a vault's owner is public, so anybody could read it, send it, and
 * rename somebody else's vault. Ownership still has to match — this asserts the *other* half, that
 * the caller has to prove they are that owner.
 */
describe('proving the caller is the owner', () => {
  it('refuses a request whose signature does not verify', async () => {
    proofOk = false;
    try {
      const response = await POST(
        new Request('http://x/api/creator/profile', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            owner: OWNER,
            vaultId: VAULT,
            coinType: '0x2::sui::SUI',
            displayName: 'stolen',
            bio: 'not mine',
          }),
        }),
      );
      expect(response.status).toBe(401);
    } finally {
      proofOk = true;
    }
  });
});

describe('what the signature covers is what gets stored', () => {
  /*
    `displayName` and `bio` used to be sliced to 60 and 280 AFTER verifyAction returned, so the
    stored value was not the value the signature covered. These two fields ARE the payload — the
    docblock above says a signature authorising "some change to this vault" would authorise every
    later one too — so a signature over bytes that were never stored authorises a thing that never
    happened.
  */
  it('refuses a display name over the limit rather than shortening it', async () => {
    const response = await save({
      owner: OWNER,
      vaultId: VAULT,
      coinType: COIN,
      displayName: 'n'.repeat(MAX_DISPLAY_NAME_LENGTH + 1),
      signature: 'sig',
      timestampMs: String(Date.now()),
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('displayName');
  });

  it('refuses a bio over the limit rather than shortening it', async () => {
    const response = await save({
      owner: OWNER,
      vaultId: VAULT,
      coinType: COIN,
      bio: 'b'.repeat(MAX_BIO_LENGTH + 1),
      signature: 'sig',
      timestampMs: String(Date.now()),
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain('bio');
  });

  it('stores a name at the limit exactly as it was signed', async () => {
    const name = 'n'.repeat(MAX_DISPLAY_NAME_LENGTH);

    const response = await save({
      owner: OWNER,
      vaultId: VAULT,
      coinType: COIN,
      displayName: name,
      signature: 'sig',
      timestampMs: String(Date.now()),
    });

    expect(response.status).toBe(200);
    const { rows } = await testDb().query('SELECT display_name FROM profiles WHERE vault_id = $1', [
      VAULT,
    ]);
    // Byte for byte. Not "starts with", not "is 60 characters long" — the same string.
    expect(rows[0]?.display_name).toBe(name);
  });

  it('does not spend a signature to refuse an over-long field', async () => {
    /*
      The check runs BEFORE verifyAction, for the reason POST /api/posts gives for its own length
      checks: signatures are single-use, so refusing afterwards charges the creator a signature for
      a request that was never going to be stored.
    */
    proofOk = false;
    const response = await save({
      owner: OWNER,
      vaultId: VAULT,
      coinType: COIN,
      bio: 'b'.repeat(MAX_BIO_LENGTH + 1),
      signature: 'sig',
      timestampMs: String(Date.now()),
    });
    proofOk = true;

    // 400 for the length, not 401 for the signature — so the length was decided first.
    expect(response.status).toBe(400);
  });
});
