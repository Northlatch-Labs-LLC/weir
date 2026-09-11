// @vitest-environment node
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function codeOf(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
}

const route = () => codeOf('app/api/studio/upload/route.ts');

describe('the body is refused before it is read', () => {
  it('checks the declared length before parsing the body', () => {
    const code = route();
    const guard = code.indexOf('tooLarge(');
    const parse = code.indexOf('request.formData()');
    expect(guard).toBeGreaterThan(-1);
    expect(parse).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(parse);
  });

  it('keeps the check on the parsed size as well', () => {
    expect(route()).toMatch(/file\.size\s*>\s*MAX_BYTES/);
  });
});

describe('nothing of ours is spent before the caller is proved', () => {
  const code = route();
  const verify = code.indexOf('verifyAction(');
  const chainRead = code.indexOf('readCreatorVault(');
  const findPost = code.indexOf('findPost(');

  it('proves the signature before reading the chain', () => {
    expect(verify).toBeGreaterThan(-1);
    expect(chainRead).toBeGreaterThan(-1);
    expect(verify).toBeLessThan(chainRead);
  });

  it('proves the signature before looking the post up', () => {
    expect(findPost).toBeGreaterThan(-1);
    expect(verify).toBeLessThan(findPost);
  });

  it('still hashes before verifying, because the statement binds the hash', () => {
    const hash = code.indexOf('createHash(');
    expect(hash).toBeGreaterThan(-1);
    expect(hash).toBeLessThan(verify);
  });
});

describe('the file is read once', () => {
  it('calls arrayBuffer exactly once', () => {
    const reads = [...route().matchAll(/\.arrayBuffer\(\)/g)].length;
    expect(reads).toBe(1);
  });

  it('hands the same bytes to the hash and to storage', () => {
    const code = route();
    expect(code).toMatch(/const bytes = new Uint8Array\(await file\.arrayBuffer\(\)\)/);
    expect(code).toMatch(/update\(Buffer\.from\(bytes\)\)/);
    expect(code).toMatch(/\bbytes,/);
  });
});

describe('the guard itself', () => {
  it('refuses a body that declares more than the limit', async () => {
    const { tooLarge } = await import('../lib/body-limit');
    const request = new Request('https://weir.social/x', {
      method: 'POST',
      headers: { 'content-length': '999999999' },
    });

    expect(tooLarge(request, 1000)?.status).toBe(413);
  });

  it('allows a body within the limit', async () => {
    const { tooLarge } = await import('../lib/body-limit');
    const request = new Request('https://weir.social/x', {
      method: 'POST',
      headers: { 'content-length': '500' },
    });

    expect(tooLarge(request, 1000)).toBeNull();
  });

  it('does not refuse a request that declares nothing', async () => {
    const { tooLarge } = await import('../lib/body-limit');
    const none = new Request('https://weir.social/x', { method: 'POST' });
    const junk = new Request('https://weir.social/x', {
      method: 'POST',
      headers: { 'content-length': 'not-a-number' },
    });

    expect(tooLarge(none, 1000)).toBeNull();
    expect(tooLarge(junk, 1000)).toBeNull();
  });
});
