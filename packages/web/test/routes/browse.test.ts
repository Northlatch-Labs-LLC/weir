// @vitest-environment node
// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
/**
 * The shop window shows what is for sale and nothing that was bought.
 *
 * # What this pins
 *
 * `GET /api/browse` is the one public read that answers "what is here" to a caller who names
 * nothing. Three properties make it safe to leave open, and each is asserted against the real
 * database rather than a stub, because two of them are about what the SQL returns:
 *
 *   1. The page size is not a parameter. A caller asking for a thousand gets twenty. `truncated`
 *      is measured by fetching one row past the page, not inferred from a full page.
 *   2. Nothing gated leaves. A subscribers-only post's words are stored in plaintext and are not
 *      shown; a paid post's sealed material — blob id, nonce, wrapped key — is not a field the
 *      response has. This is asserted on the serialised JSON, not on the object, so a key that
 *      leaks by any path fails.
 *   3. The cursor continues the listing it came from. A cursor issued for one creator's posts is
 *      refused for the whole feed, and a cursor that was not issued at all is refused.
 *
 * Posts are seeded through `addPost`, the writer the rest of the application uses, so the rows
 * here have the shape production rows have.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDatabase, resetDatabase, testDb, useTestDatabase } from '../helpers/database';

useTestDatabase();

const { addPost } = await import('../../lib/content');
const { BROWSE_PAGE, GET, encodeCursor } = await import('../../app/api/browse/route');

const VAULT_A = `0x${'a1'.repeat(32)}`;
const VAULT_B = `0x${'b2'.repeat(32)}`;
const OWNER_A = `0x${'c3'.repeat(32)}`;
const OWNER_B = `0x${'d4'.repeat(32)}`;
const COIN = '0xdba34672::usdc::USDC';

function browse(query: Record<string, string>): Promise<Response> {
  const url = new URL('http://localhost/api/browse');
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return GET(new Request(url));
}

async function seedProfiles(): Promise<void> {
  await testDb().query(
    `INSERT INTO profiles (handle, vault_id, owner, display_name, bio, coin_type)
     VALUES ('alice', $1, $2, 'Alice', 'writes', $5), ('bob', $3, $4, 'Bob', 'paints', $5)`,
    [VAULT_A, OWNER_A, VAULT_B, OWNER_B, COIN],
  );
}

/** `n` posts for `alice`, oldest first, one of each access kind in rotation. */
async function seedPosts(n: number, handle = 'alice', vaultId = VAULT_A): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i += 1) {
    const kind = (['public', 'subscribers', 'paid'] as const)[i % 3]!;
    const id = `p${handle}${String(i).padStart(3, '0')}`;
    ids.push(id);
    await addPost({
      id,
      vaultId,
      authorHandle: handle,
      createdAtMs: 1_756_700_000_000 + i * 1000,
      title: `Post ${i}`,
      preview: `preview ${i}`,
      body: `the words of post ${i}`,
      access:
        kind === 'paid'
          ? { kind, price: '250000', contentKey: `key-${i}` }
          : { kind },
      ...(kind === 'paid'
        ? {
            sealedBody: {
              blobId: `blob-${i}`,
              endEpoch: 999,
              nonce: `nonce-${i}`,
              sealWrappedKey: `wrapped-${i}`,
              sha256: `sha-${i}`,
            },
          }
        : {}),
    });
  }
  return ids;
}

beforeEach(async () => {
  await resetDatabase();
  await seedProfiles();
});

afterAll(closeDatabase);

describe('what it refuses', () => {
  it('a kind it does not know', async () => {
    expect((await browse({ kind: 'everything' })).status).toBe(400);
    expect((await browse({})).status).toBe(400);
  });

  it('a handle that is not handle-shaped', async () => {
    expect((await browse({ kind: 'posts', handle: 'Not A Handle' })).status).toBe(400);
  });

  it('a handle on the creators listing, where it means nothing', async () => {
    expect((await browse({ kind: 'creators', handle: 'alice' })).status).toBe(400);
  });

  it('a cursor it did not issue', async () => {
    expect((await browse({ kind: 'posts', cursor: 'not-a-cursor' })).status).toBe(400);
    expect((await browse({ kind: 'posts', cursor: Buffer.from('{"k":"posts"}').toString('base64url') })).status).toBe(400);
  });

  it("a cursor issued for one creator's posts, presented against the whole feed", async () => {
    // The cursor is a position in ONE ordering. Accepting it elsewhere would let a caller splice
    // a page boundary from a narrow listing into a wide one and skip or repeat rows.
    const scoped = encodeCursor({ k: 'posts', h: 'alice', t: 1_756_700_000_000, id: 'palice000' });
    expect((await browse({ kind: 'posts', cursor: scoped })).status).toBe(400);
    expect((await browse({ kind: 'posts', cursor: scoped, handle: 'alice' })).status).toBe(200);
  });
});

describe('the page size', () => {
  it('is fixed, and a caller asking for more is ignored rather than obeyed', async () => {
    await seedPosts(BROWSE_PAGE + 3);
    const body = (await (await browse({ kind: 'posts', limit: '1000', pageSize: '1000' })).json()) as {
      items: unknown[];
      pageSize: number;
      truncated: boolean;
    };
    expect(body.items).toHaveLength(BROWSE_PAGE);
    expect(body.pageSize).toBe(BROWSE_PAGE);
    expect(body.truncated).toBe(true);
  });

  it('reports truncated only when a further page actually exists', async () => {
    await seedPosts(BROWSE_PAGE);
    const body = (await (await browse({ kind: 'posts' })).json()) as { items: unknown[]; truncated: boolean; nextCursor: string | null };
    // Exactly one page: a full page is not evidence of a next one, and this says so.
    expect(body.items).toHaveLength(BROWSE_PAGE);
    expect(body.truncated).toBe(false);
    expect(body.nextCursor).toBeNull();
  });
});

describe('paging', () => {
  it('walks every post exactly once, newest first, across page boundaries', async () => {
    const seeded = await seedPosts(BROWSE_PAGE + 7);
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const query: Record<string, string> = { kind: 'posts' };
      if (cursor !== null) query['cursor'] = cursor;
      const body = (await (await browse(query)).json()) as {
        items: Array<{ id: string; createdAtMs: number }>;
        nextCursor: string | null;
        truncated: boolean;
      };
      for (let i = 1; i < body.items.length; i += 1) {
        expect(body.items[i]!.createdAtMs).toBeLessThanOrEqual(body.items[i - 1]!.createdAtMs);
      }
      seen.push(...body.items.map((p) => p.id));
      cursor = body.nextCursor;
      pages += 1;
      expect(body.truncated).toBe(cursor !== null);
    } while (cursor !== null && pages < 10);

    expect(pages).toBe(2);
    expect(new Set(seen).size).toBe(seen.length);
    expect([...seen].sort()).toEqual([...seeded].sort());
  });

  it("narrows to one creator's posts and stays narrowed across pages", async () => {
    await seedPosts(BROWSE_PAGE + 2, 'alice', VAULT_A);
    await seedPosts(3, 'bob', VAULT_B);
    const first = (await (await browse({ kind: 'posts', handle: 'alice' })).json()) as {
      items: Array<{ authorHandle: string }>;
      nextCursor: string;
    };
    expect(first.items.every((p) => p.authorHandle === 'alice')).toBe(true);
    const second = (await (await browse({ kind: 'posts', handle: 'alice', cursor: first.nextCursor })).json()) as {
      items: Array<{ authorHandle: string }>;
    };
    expect(second.items).toHaveLength(2);
    expect(second.items.every((p) => p.authorHandle === 'alice')).toBe(true);
  });

  it('pages creators by handle with the same shape', async () => {
    for (let i = 0; i < BROWSE_PAGE + 1; i += 1) {
      await testDb().query(
        `INSERT INTO profiles (handle, vault_id, owner, display_name, bio, coin_type)
         VALUES ($1, $2, $3, $1, '', $4)`,
        [`creator_${String(i).padStart(2, '0')}`, `0x${(i + 1).toString(16).padStart(64, '0')}`, `0x${(i + 100).toString(16).padStart(64, '0')}`, COIN],
      );
    }
    const first = (await (await browse({ kind: 'creators' })).json()) as {
      items: Array<{ handle: string }>;
      truncated: boolean;
      nextCursor: string;
    };
    expect(first.items).toHaveLength(BROWSE_PAGE);
    expect(first.truncated).toBe(true);
    const second = (await (await browse({ kind: 'creators', cursor: first.nextCursor })).json()) as {
      items: Array<{ handle: string }>;
      truncated: boolean;
    };
    expect(second.truncated).toBe(false);
    const all = [...first.items, ...second.items].map((c) => c.handle);
    expect(new Set(all).size).toBe(all.length);
    expect(all).toHaveLength(BROWSE_PAGE + 1 + 2);
    expect(all).toEqual([...all].sort());
  });
});

describe('what leaves', () => {
  it("shows a public post's words, and never a gated post's", async () => {
    await seedPosts(3); // public, subscribers, paid — in that order of creation
    const body = (await (await browse({ kind: 'posts' })).json()) as {
      items: Array<{ id: string; access: { kind: string }; body?: string; preview: string }>;
    };
    const byKind = new Map(body.items.map((p) => [p.access.kind, p]));
    expect(byKind.get('public')?.body).toBe('the words of post 0');
    expect(byKind.get('subscribers')?.body).toBeUndefined();
    expect(byKind.get('paid')?.body).toBeUndefined();
    // The window still shows the goods: every post has its preview and its access.
    for (const p of body.items) expect(p.preview.length).toBeGreaterThan(0);
  });

  it('carries no sealed material by any path — asserted on the bytes, not the object', async () => {
    await seedPosts(3);
    const text = await (await browse({ kind: 'posts' })).text();
    for (const secret of ['sealWrappedKey', 'wrapped-', 'nonce', 'blobId', 'blob-', 'sha256', 'sealedBody', 'endEpoch']) {
      expect(text, `${secret} is in the response`).not.toContain(secret);
    }
  });

  it('still shows the price and the key a buyer needs, because that is what a window is for', async () => {
    await seedPosts(3);
    const body = (await (await browse({ kind: 'posts' })).json()) as {
      items: Array<{ access: { kind: string; price?: string; contentKey?: string } }>;
    };
    const paid = body.items.find((p) => p.access.kind === 'paid');
    expect(paid?.access.price).toBe('250000');
    expect(paid?.access.contentKey).toBe('key-2');
  });

  it('builds the shown post field by field rather than spreading the row', () => {
    /*
      The property behind the previous two assertions. A `{ ...post }` would show every field the
      Post type has today AND every field added to it later, by default. Building it means a new
      field is hidden until somebody decides otherwise — which is the only safe default for a
      public window over a table that holds sealed keys.
    */
    const source = readFileSync(join(import.meta.dirname, '..', '..', 'app', 'api', 'browse', 'route.ts'), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/^\s*\/\/.*$/gm, ' ');
    const fn = source.slice(source.indexOf('export function toBrowsePost'), source.indexOf('export function toBrowseCreator'));
    expect(fn).not.toMatch(/\.\.\.post\b/);
  });
});
