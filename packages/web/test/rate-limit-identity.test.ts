// Built-by: @projectx.sui · Co-authored-by: the DSH session
// Locks the identity contract of the rate limiter: what names a caller, and whether that name
// was verified. Behaviour of clientKey is unchanged; these tests pin it so a refactor cannot
// quietly turn the limiter into decoration.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { clientKey, identify } from '../lib/rate-limit';

function req(headers: Record<string, string>): Request {
  return new Request('https://x/api/posts', { headers });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('identity source is reported, not assumed', () => {
  it('names x-real-ip as the source outside Cloudflare', () => {
    const id = identify(req({ 'x-real-ip': '9.9.9.9' }));
    expect(id.source).toBe('x-real-ip');
    expect(id.key).toBe('9.9.9.9');
    expect(id.verifiedBySecret).toBe(false);
  });

  it('names cf-connecting-ip once behind Cloudflare', () => {
    vi.stubEnv('PROJECTX_SOCIAL_BEHIND_CLOUDFLARE', 'true');
    const id = identify(req({ 'cf-connecting-ip': '1.1.1.1', 'x-real-ip': '9.9.9.9' }));
    expect(id.source).toBe('cf-connecting-ip');
    expect(id.key).toBe('1.1.1.1');
  });

  it('reports no source when nothing identifies the caller', () => {
    const id = identify(req({}));
    expect(id.source).toBe('none');
    expect(id.key).toBe('unattributed');
  });

  it('does not count a client-set cf-connecting-ip while outside Cloudflare', () => {
    const id = identify(req({ 'cf-connecting-ip': '1.1.1.1' }));
    expect(id.source).toBe('none');
    expect(clientKey(req({ 'cf-connecting-ip': '1.1.1.1' }))).toBe('unattributed');
  });
});

describe('the edge secret decides whether the identifier is verified', () => {
  it('is unverified when Cloudflare is declared but no secret is configured', () => {
    vi.stubEnv('PROJECTX_SOCIAL_BEHIND_CLOUDFLARE', 'true');
    const id = identify(req({ 'cf-connecting-ip': '1.1.1.1' }));
    expect(id.verifiedBySecret).toBe(false);
    expect(id.source).toBe('cf-connecting-ip');
  });

  it('is verified when a secret is configured and presented', () => {
    vi.stubEnv('PROJECTX_SOCIAL_BEHIND_CLOUDFLARE', 'true');
    vi.stubEnv('PROJECTX_SOCIAL_EDGE_SECRET', 's3cret');
    const id = identify(req({ 'cf-connecting-ip': '1.1.1.1', 'x-edge-secret': 's3cret' }));
    expect(id.verifiedBySecret).toBe(true);
    expect(id.key).toBe('1.1.1.1');
  });

  it('falls to the shared bucket, not to trust, when the secret is wrong', () => {
    vi.stubEnv('PROJECTX_SOCIAL_BEHIND_CLOUDFLARE', 'true');
    vi.stubEnv('PROJECTX_SOCIAL_EDGE_SECRET', 's3cret');

    const wrong = identify(req({ 'cf-connecting-ip': '1.1.1.1', 'x-edge-secret': 'nope' }));
    const missing = identify(req({ 'cf-connecting-ip': '1.1.1.1' }));

    expect(wrong.key).toBe('unattributed');
    expect(wrong.source).toBe('none');
    expect(missing.key).toBe('unattributed');
    expect(missing.verifiedBySecret).toBe(false);
  });
});

describe('clientKey still returns exactly the key it always did', () => {
  it('prefers the platform header over cf-connecting-ip outside Cloudflare', () => {
    expect(clientKey(req({ 'x-real-ip': '9.9.9.9', 'cf-connecting-ip': '1.1.1.1' }))).toBe('9.9.9.9');
  });

  it('prefers cf-connecting-ip over x-real-ip inside Cloudflare', () => {
    vi.stubEnv('PROJECTX_SOCIAL_BEHIND_CLOUDFLARE', 'true');
    expect(clientKey(req({ 'x-real-ip': '9.9.9.9', 'cf-connecting-ip': '1.1.1.1' }))).toBe('1.1.1.1');
  });

  it('ignores a rotating x-forwarded-for', () => {
    const keys = ['1.1.1.1', '2.2.2.2', '3.3.3.3'].map((ip) => clientKey(req({ 'x-forwarded-for': ip })));
    expect(new Set(keys)).toEqual(new Set(['unattributed']));
  });
});
