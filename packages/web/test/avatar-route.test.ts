// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { afterEach, describe, expect, it, vi } from 'vitest';

const isProfileImage = vi.fn();
const readBlob = vi.fn();

vi.mock('@/lib/content', () => ({ isProfileImage: (...a: unknown[]) => isProfileImage(...a) }));
vi.mock('@/lib/rate-limit', () => ({ rateLimit: () => null }));
vi.mock('@/lib/walrus', async () => {
  const real = await vi.importActual<typeof import('../lib/walrus')>('../lib/walrus');
  return { ...real, readBlob: (...a: unknown[]) => readBlob(...a) };
});

const { GET } = await import('../app/api/avatar/[blobId]/route');

const BLOB = 'B'.repeat(43);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9, 9, 9]);

const get = (blobId: string) =>
  GET(new Request(`http://localhost/api/avatar/${blobId}`), { params: Promise.resolve({ blobId }) });

afterEach(() => {
  vi.clearAllMocks();
});

describe('the picture frame', () => {
  it('refuses something that is not a blob id without asking anyone', async () => {
    expect((await get('not-a-blob')).status).toBe(400);
    expect(isProfileImage).not.toHaveBeenCalled();
    expect(readBlob).not.toHaveBeenCalled();
  });

  it('serves only a blob some page names, so it is not a proxy for Walrus', async () => {
    isProfileImage.mockResolvedValue(false);
    expect((await get(BLOB)).status).toBe(404);
    expect(readBlob).not.toHaveBeenCalled();
  });

  it('serves a named picture with its real type and lets browsers keep it', async () => {
    isProfileImage.mockResolvedValue(true);
    readBlob.mockResolvedValue({ ok: true, value: PNG, observedAtMs: 0 });
    const response = await get(BLOB);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('cache-control')).toContain('immutable');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG);
  });

  it('says a blob nobody holds is gone rather than answering with nothing', async () => {
    isProfileImage.mockResolvedValue(true);
    readBlob.mockResolvedValue({ ok: false, failure: { kind: 'not-found', source: 'w', detail: 'lease expired' } });
    expect((await get(BLOB)).status).toBe(404);
  });
});
