// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { afterEach, describe, expect, it, vi } from 'vitest';

const verifyAction = vi.fn();
const accountHandle = vi.fn();
const setPerks = vi.fn();
const setSupportersFirst = vi.fn();

vi.mock('@/lib/rate-limit', () => ({
  simulateLimit: async () => null, rateLimit: () => null }));
vi.mock('@/lib/identity', () => ({ verifyAction: (...a: unknown[]) => verifyAction(...a) }));
vi.mock('@/lib/accounts', () => ({ accountHandle: (...a: unknown[]) => accountHandle(...a) }));
vi.mock('@/lib/perks', async () => {
  const real = await vi.importActual<typeof import('../lib/perks')>('../lib/perks');
  return {
    ...real,
    setPerks: (...a: unknown[]) => setPerks(...a),
    setSupportersFirst: (...a: unknown[]) => setSupportersFirst(...a),
    listPerks: async () => [],
    readSupportersFirst: async () => false,
  };
});

const { POST } = await import('../app/api/creator/perks/route');
const { perksDigest } = await import('../lib/perks-digest');

const ADDRESS = '0x9c8f6a1d2b4e7c05a3f18d6b29e4c7a0f5b3d8e1c6a94f27b0d5e83a1c6f492b';
const PERK = { thresholdUnits: '1000000', title: 'A message I answer first', detail: '' };

function post(body: unknown): Request {
  return new Request('http://localhost/api/creator/perks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  vi.clearAllMocks();
});

describe('who may write a creator’s promises', () => {
  it('refuses an unsigned request', async () => {
    verifyAction.mockResolvedValue({ ok: false, failure: { detail: 'no signature' } });
    const response = await POST(post({ address: ADDRESS, handle: 'nova', perks: [PERK] }));
    expect(response.status).toBe(401);
    expect(setPerks).not.toHaveBeenCalled();
  });

  it('refuses an address that holds a different handle', async () => {
    verifyAction.mockResolvedValue({ ok: true, value: ADDRESS });
    accountHandle.mockResolvedValue({ ok: true, value: 'someone-else' });
    const response = await POST(post({ address: ADDRESS, handle: 'nova', perks: [PERK] }));
    expect(response.status).toBe(403);
    expect(setPerks).not.toHaveBeenCalled();
  });

  it('refuses an address holding no account yet, and says to try again rather than refusing them', async () => {
    verifyAction.mockResolvedValue({ ok: true, value: ADDRESS });
    accountHandle.mockResolvedValue({ ok: true, value: null });
    expect((await POST(post({ address: ADDRESS, handle: 'nova', perks: [PERK] }))).status).toBe(409);
  });

  it('writes nothing when the chain could not be read — a failed read is not permission', async () => {
    verifyAction.mockResolvedValue({ ok: true, value: ADDRESS });
    accountHandle.mockResolvedValue({ ok: false, failure: { detail: 'node unreachable' } });
    const response = await POST(post({ address: ADDRESS, handle: 'nova', perks: [PERK] }));
    expect(response.status).toBe(503);
    expect(setPerks).not.toHaveBeenCalled();
  });

  it('stores the list when the signature and the handle both check out', async () => {
    verifyAction.mockResolvedValue({ ok: true, value: ADDRESS });
    accountHandle.mockResolvedValue({ ok: true, value: 'nova' });
    const response = await POST(
      post({ address: ADDRESS, handle: 'nova', perks: [PERK], supportersFirst: true }),
    );
    expect(response.status).toBe(200);
    expect(setPerks).toHaveBeenCalledOnce();
    expect(setSupportersFirst).toHaveBeenCalledWith('nova', true);
  });
});

describe('what the signature is checked against', () => {
  it('is the digest of the list the server will store, never one the caller sent', async () => {
    verifyAction.mockResolvedValue({ ok: true, value: ADDRESS });
    accountHandle.mockResolvedValue({ ok: true, value: 'nova' });
    await POST(
      post({
        address: ADDRESS,
        handle: 'nova',
        perks: [PERK],
        supportersFirst: false,
        perksSha256: 'a'.repeat(64),
      }),
    );
    const expected = await perksDigest([PERK], false);
    expect(verifyAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: expect.objectContaining({ kind: 'set-perks', perksSha256: expected }),
      }),
    );
  });

  it('binds supporters-first, so it cannot be flipped with a captured signature', async () => {
    verifyAction.mockResolvedValue({ ok: true, value: ADDRESS });
    accountHandle.mockResolvedValue({ ok: true, value: 'nova' });
    await POST(post({ address: ADDRESS, handle: 'nova', perks: [PERK], supportersFirst: true }));
    const withTrue = await perksDigest([PERK], true);
    expect(verifyAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: expect.objectContaining({ perksSha256: withTrue, supportersFirst: true }) }),
    );
  });

  it('rejects a malformed list before asking for any signature at all', async () => {
    const response = await POST(post({ address: ADDRESS, handle: 'nova', perks: [{ title: '' }] }));
    expect(response.status).toBe(400);
    expect(verifyAction).not.toHaveBeenCalled();
  });
});
