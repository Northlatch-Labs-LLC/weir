// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { closeDatabase, resetDatabase, testDb, useTestDatabase } from '../helpers/database';

useTestDatabase();

const OWNER = `0x${'a1'.repeat(32)}`;
const VAULT = `0x${'b2'.repeat(32)}`;
const COIN = '0xdba34672::usdc::USDC';

let chainHandle: string | null = 'newname';

let vaultCoin: string | null = '0xdba34672::usdc::USDC';
vi.mock('@/lib/creator-setup', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  coinTypeOf: async () => vaultCoin,
}));

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
    expect(rows[0]?.display_name).toBe(name);
  });

  it('does not spend a signature to refuse an over-long field', async () => {
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

    expect(response.status).toBe(400);
  });
});

describe('the coin type is the vault\'s, not the body\'s', () => {
  it('refuses a coinType that is not the vault\'s type parameter', async () => {
    vaultCoin = '0x2::sui::SUI';
    try {
      const r = await save({
      owner: OWNER,
      vaultId: VAULT,
      coinType: COIN,
      displayName: 'Blitz vault',
      bio: 'a new description',
    });
      expect(r.status).toBe(400);
      expect(((await r.json()) as { error: string }).error).toMatch(/does not match the vault/);
    } finally {
      vaultCoin = '0xdba34672::usdc::USDC';
    }
  });

  it('refuses to write when the vault\'s coin cannot be read, rather than trusting the body', async () => {
    vaultCoin = null;
    try {
      const r = await save({
      owner: OWNER,
      vaultId: VAULT,
      coinType: COIN,
      displayName: 'Blitz vault',
      bio: 'a new description',
    });
      expect(r.status).toBe(424);
    } finally {
      vaultCoin = '0xdba34672::usdc::USDC';
    }
  });
});
