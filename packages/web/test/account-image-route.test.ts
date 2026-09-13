// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';

const verifyAction = vi.fn();
const accountHandle = vi.fn();
const findProfile = vi.fn();
const setProfileImage = vi.fn();
const grantUpload = vi.fn();
const storeBlob = vi.fn();

vi.mock('@/lib/rate-limit', () => ({ simulateLimit: async () => null, rateLimit: () => null }));
vi.mock('@/lib/body-limit', () => ({ tooLarge: () => null }));
vi.mock('@/lib/identity', () => ({ verifyAction: (...a: unknown[]) => verifyAction(...a) }));
vi.mock('@/lib/accounts', () => ({ accountHandle: (...a: unknown[]) => accountHandle(...a) }));
vi.mock('@/lib/content', () => ({
  findProfile: (...a: unknown[]) => findProfile(...a),
  setProfileImage: (...a: unknown[]) => setProfileImage(...a),
}));
vi.mock('@/lib/publisher-token', () => ({ grantUpload: (...a: unknown[]) => grantUpload(...a) }));
vi.mock('@/lib/walrus', async () => {
  const real = await vi.importActual<typeof import('../lib/walrus')>('../lib/walrus');
  return { ...real, storeBlob: (...a: unknown[]) => storeBlob(...a) };
});

const { POST } = await import('../app/api/account/image/route');

const ADDRESS = '0x9c8f6a1d2b4e7c05a3f18d6b29e4c7a0f5b3d8e1c6a94f27b0d5e83a1c6f492b';
const BLOB = 'A'.repeat(43);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const TEXT = new TextEncoder().encode('not a picture at all');

function upload(bytes: Uint8Array, fields: Record<string, string> = {}): Request {
  const form = new FormData();
  form.set('address', ADDRESS);
  form.set('handle', 'nova');
  form.set('file', new File([bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer], 'face.png', { type: 'image/png' }));
  form.set('signature', 'sig');
  form.set('timestampMs', String(Date.now()));
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return new Request('http://localhost/api/account/image', { method: 'POST', body: form });
}

function allGood() {
  verifyAction.mockResolvedValue({ ok: true, value: null });
  accountHandle.mockResolvedValue({ ok: true, value: 'nova' });
  findProfile.mockResolvedValue({ handle: 'nova' });
  grantUpload.mockResolvedValue({ ok: true, value: { epochs: 53, token: 't', maxBytes: 1 } });
  storeBlob.mockResolvedValue({ ok: true, value: { blobId: BLOB, size: 12, endEpoch: 999, alreadyExisted: false } });
  setProfileImage.mockResolvedValue(true);
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('what may become the picture on a page', () => {
  it('refuses bytes that are not a picture before anything is verified', async () => {
    allGood();
    const response = await POST(upload(TEXT));
    expect(response.status).toBe(415);
    expect(verifyAction).not.toHaveBeenCalled();
    expect(storeBlob).not.toHaveBeenCalled();
  });

  it('binds the signature to the handle and the sha256 of the bytes', async () => {
    allGood();
    await POST(upload(PNG));
    const [input] = verifyAction.mock.calls[0] as [{ action: { kind: string; handle: string; imageSha256: string } }];
    expect(input.action).toEqual({
      kind: 'set-image',
      handle: 'nova',
      imageSha256: createHash('sha256').update(Buffer.from(PNG)).digest('hex'),
    });
  });

  it('refuses an unsigned request and stores nothing', async () => {
    allGood();
    verifyAction.mockResolvedValue({ ok: false, failure: { detail: 'no signature' } });
    const response = await POST(upload(PNG));
    expect(response.status).toBe(401);
    expect(storeBlob).not.toHaveBeenCalled();
    expect(setProfileImage).not.toHaveBeenCalled();
  });

  it('refuses an address that holds a different handle', async () => {
    allGood();
    accountHandle.mockResolvedValue({ ok: true, value: 'someone-else' });
    const response = await POST(upload(PNG));
    expect(response.status).toBe(403);
    expect(storeBlob).not.toHaveBeenCalled();
  });

  it('refuses an address holding no account yet', async () => {
    allGood();
    accountHandle.mockResolvedValue({ ok: true, value: null });
    expect((await POST(upload(PNG))).status).toBe(409);
    expect(storeBlob).not.toHaveBeenCalled();
  });

  it('stores the bytes under the account’s own grant, then names the blob on the page', async () => {
    allGood();
    const response = await POST(upload(PNG));
    expect(response.status).toBe(200);
    expect(grantUpload).toHaveBeenCalledWith({ owner: ADDRESS, size: PNG.length, tier: 'durable' });
    const [, options] = storeBlob.mock.calls[0] as [Uint8Array, { sendObjectTo: string; epochs: number }];
    expect(options.sendObjectTo).toBe(ADDRESS);
    expect(setProfileImage).toHaveBeenCalledWith('nova', BLOB);
    expect(await response.json()).toMatchObject({ blobId: BLOB, url: `/api/avatar/${BLOB}` });
  });

  it('names nothing when Walrus refused the bytes', async () => {
    allGood();
    storeBlob.mockResolvedValue({ ok: false, failure: { kind: 'transport', source: 'w', detail: 'the publisher answered 502' } });
    const response = await POST(upload(PNG));
    expect(response.status).toBe(502);
    expect(setProfileImage).not.toHaveBeenCalled();
  });
});
