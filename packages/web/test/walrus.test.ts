// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { afterEach, describe, expect, it, vi } from 'vitest';
import { MAX_EPOCHS, isBlobId, readBlob, storeBlob, walrusConfig } from '../lib/walrus';

const AGG = 'https://agg.example';
const PUB = 'https://pub.example';
const ID = 'M4hsZGQ1oCktdzegB6HnI6Mi28S2nqOPHxK-W7_4BUk';

afterEach(() => vi.unstubAllGlobals());

function env(over: Record<string, string> = {}): Record<string, string | undefined> {
  return { PROJECTX_WALRUS_AGGREGATOR_URL: AGG, PROJECTX_WALRUS_PUBLISHER_URL: PUB, ...over };
}

describe('configuration', () => {
  it('refuses to invent an aggregator', () => {
    const r = walrusConfig({});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure.kind).toBe('unconfigured');
  });

  it('treats a missing publisher as ordinary, not broken', () => {
    const r = walrusConfig({ PROJECTX_WALRUS_AGGREGATOR_URL: AGG });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.publisherUrl).toBeNull();
  });

  it('strips trailing slashes so paths do not double up', () => {
    const r = walrusConfig(env({ PROJECTX_WALRUS_AGGREGATOR_URL: `${AGG}/` }));
    if (r.ok) expect(r.value.aggregatorUrl).toBe(AGG);
  });

  it('refuses plaintext endpoints', () => {
    expect(walrusConfig(env({ PROJECTX_WALRUS_AGGREGATOR_URL: 'http://agg.example' })).ok).toBe(false);
  });
});

describe('blob ids', () => {
  it('accepts a real one', () => {
    expect(isBlobId(ID)).toBe(true);
  });

  it('rejects anything that could escape a URL path', () => {
    expect(isBlobId('../../etc/passwd')).toBe(false);
    expect(isBlobId(`${ID}/..`)).toBe(false);
    expect(isBlobId('')).toBe(false);
  });
});

const TOKEN = 'stub.jwt.token';
const OWNER = `0x${'a1'.repeat(32)}`;

describe('storing', () => {
  it('says plainly that writing needs a funded publisher', async () => {
    vi.stubGlobal('process', { ...process, env: env({ PROJECTX_WALRUS_PUBLISHER_URL: '' }) });
    const r = await storeBlob(new Uint8Array([1, 2, 3]), { epochs: 5, token: TOKEN, sendObjectTo: OWNER });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.failure.kind).toBe('unconfigured');
      expect(r.failure.detail).toContain('WAL');
    }
  });

  it('refuses a purchase longer than Walrus allows', async () => {
    vi.stubGlobal('process', { ...process, env: env() });
    const r = await storeBlob(new Uint8Array([1]), { epochs: MAX_EPOCHS + 1, token: TOKEN, sendObjectTo: OWNER });
    expect(r.ok).toBe(false);
  });

  it('keeps the blob id and the expiry from a fresh write', async () => {
    vi.stubGlobal('process', { ...process, env: env() });
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        newlyCreated: { blobObject: { blobId: ID, size: 17, storage: { endEpoch: 40 } } },
      }),
    })));

    const r = await storeBlob(new Uint8Array([1, 2, 3]), { epochs: 5, token: TOKEN, sendObjectTo: OWNER });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.blobId).toBe(ID);
      expect(r.value.endEpoch).toBe(40);
      expect(r.value.alreadyExisted).toBe(false);
    }
  });

  it('treats an already-certified blob as a success', async () => {
    vi.stubGlobal('process', { ...process, env: env() });
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ alreadyCertified: { blobId: ID, endEpoch: 41 } }),
    })));

    const r = await storeBlob(new Uint8Array([1]), { epochs: 5, token: TOKEN, sendObjectTo: OWNER });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.alreadyExisted).toBe(true);
  });

  it('refuses a response it cannot name a blob from', async () => {
    vi.stubGlobal('process', { ...process, env: env() });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })));

    const r = await storeBlob(new Uint8Array([1]), { epochs: 5, token: TOKEN, sendObjectTo: OWNER });
    expect(r.ok).toBe(false);
  });

  it('buys permanent storage unless told otherwise', async () => {
    vi.stubGlobal('process', { ...process, env: env() });
    const seen: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      seen.push(String(url));
      return { ok: true, json: async () => ({ alreadyCertified: { blobId: ID, endEpoch: 9 } }) };
    }));

    await storeBlob(new Uint8Array([1]), { epochs: 5, token: TOKEN, sendObjectTo: OWNER });
    expect(seen[0]).toContain('permanent=true');
    expect(seen[0]).toContain('epochs=5');
  });
});

describe('reading', () => {
  it('distinguishes an expired lease from an unreachable node', async () => {
    vi.stubGlobal('process', { ...process, env: env() });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));

    const r = await readBlob(ID);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure.kind).toBe('not-found');
  });

  it('never puts an unvalidated id in a URL', async () => {
    vi.stubGlobal('process', { ...process, env: env() });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const r = await readBlob('../../secret');
    expect(r.ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
