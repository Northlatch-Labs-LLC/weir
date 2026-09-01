// @vitest-environment node
// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
//
// What the upload route spends before it knows who is calling.
//
// It buffered the entire multipart body, then checked the size; then did a post lookup, a profile
// lookup and a FULLNODE READ; and only then checked the signature. So an anonymous caller could
// make this deployment talk to the chain by posting a file and a made-up address, having already
// been allowed to send a body of any size. It also read the file into memory twice — once to hash
// it and again to store it — so an eight-megabyte upload occupied sixteen.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Source with comments stripped, so prose about a call is never mistaken for the call. */
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
    // Ordering is the property. After the parse, the bytes have already been paid for.
    expect(guard).toBeLessThan(parse);
  });

  it('keeps the check on the parsed size as well', () => {
    /*
      `Content-Length` is a claim, not a fact. The two are layers: the header stops the honest
      mistake without reading, and this stops a body that lied about its length.
    */
    expect(route()).toMatch(/file\.size\s*>\s*MAX_BYTES/);
  });
});

describe('nothing of ours is spent before the caller is proved', () => {
  const code = route();
  const verify = code.indexOf('verifyAction(');
  const chainRead = code.indexOf('readCreatorVault(');
  const findPost = code.indexOf('findPost(');

  it('proves the signature before reading the chain', () => {
    // A fullnode read is this deployment's money and its share of a rate-limited endpoint. It was
    // reachable by anybody who could post a file.
    expect(verify).toBeGreaterThan(-1);
    expect(chainRead).toBeGreaterThan(-1);
    expect(verify).toBeLessThan(chainRead);
  });

  it('proves the signature before looking the post up', () => {
    // Also stops the route answering whether a post id exists to a caller who has proved nothing.
    expect(findPost).toBeGreaterThan(-1);
    expect(verify).toBeLessThan(findPost);
  });

  it('still hashes before verifying, because the statement binds the hash', () => {
    /*
      This one cannot be reordered and the test says so, rather than leaving a reader to wonder why
      the expensive hash is still ahead of the cheap check: the signed statement contains the file
      hash, so the server cannot rebuild the bytes it is verifying without computing it first.
    */
    const hash = code.indexOf('createHash(');
    expect(hash).toBeGreaterThan(-1);
    expect(hash).toBeLessThan(verify);
  });
});

describe('the file is read once', () => {
  it('calls arrayBuffer exactly once', () => {
    // Twice meant an eight-megabyte upload occupied sixteen megabytes of an instance that has a few.
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
    /*
      An absent or unreadable header is a header we cannot read, not a refusal. Treating it as one
      would reject chunked requests, which declare no length at all — and the parsed-size check is
      what catches those.
    */
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
