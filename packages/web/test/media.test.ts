// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
/**
 * Media: type sniffing, identifier validation, and the headers that stop a stored file behaving
 * like a page on this origin.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectType, isValidAssetId, MAX_BYTES } from '../lib/media';

const root = join(import.meta.dirname, '..');
const read = (p: string): string => readFileSync(join(root, p), 'utf8');

const bytes = (...values: number[]) => Uint8Array.from(values);
/** Enough trailing bytes that a magic check has something to read past the header. */
const pad = (head: number[], length = 32) =>
  Uint8Array.from([...head, ...new Array<number>(Math.max(0, length - head.length)).fill(0)]);

describe('type is read from the bytes, never from the upload', () => {
  it.each([
    ['png', [0x89, 0x50, 0x4e, 0x47], 'image/png'],
    ['jpeg', [0xff, 0xd8, 0xff], 'image/jpeg'],
    ['gif', [0x47, 0x49, 0x46, 0x38], 'image/gif'],
  ])('identifies %s', (_label, magic, expected) => {
    expect(detectType(pad(magic))).toBe(expected);
  });

  it('identifies webp only when the RIFF container says WEBP', () => {
    const riff = [0x52, 0x49, 0x46, 0x46];
    const size = [0, 0, 0, 0];
    const webp = [...riff, ...size, ...[...'WEBP'].map((c) => c.charCodeAt(0))];
    expect(detectType(pad(webp))).toBe('image/webp');
  });

  it('refuses another RIFF container that is not webp', () => {
    /*
     * RIFF is shared with WAV and AVI. Accepting the container alone would let an audio or video
     * file be stored and then served with `content-type: image/webp`.
     */
    const wav = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, ...[...'WAVE'].map((c) => c.charCodeAt(0))];
    expect(detectType(pad(wav))).toBeNull();
  });

  it.each([
    ['HTML', '<!DOCTYPE html><script>alert(1)</script>'],
    ['SVG, which browsers execute script inside', '<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'],
    ['a shell script', '#!/bin/sh\nrm -rf /'],
    ['plain text', 'hello'],
  ])('refuses %s', (_label, text) => {
    expect(detectType(new TextEncoder().encode(text))).toBeNull();
  });

  it('refuses an empty upload', () => {
    expect(detectType(bytes())).toBeNull();
  });

  it('refuses bytes shorter than the magic they would match', () => {
    // `bytes[index]` is `undefined` past the end, which compares unequal — asserted rather than
    // assumed, because a truncated file matching a prefix is exactly how a sniffer is fooled.
    expect(detectType(bytes(0x89, 0x50))).toBeNull();
    expect(detectType(bytes(0xff, 0xd8))).toBeNull();
  });

  it('refuses a file whose magic is correct but not at the start', () => {
    // Offsetting the signature is the classic way to smuggle one format inside another.
    expect(detectType(pad([0x00, 0x89, 0x50, 0x4e, 0x47]))).toBeNull();
  });
});

describe('asset ids are generated, never taken from a filename', () => {
  it('accepts exactly 32 lowercase hex characters', () => {
    expect(isValidAssetId('a'.repeat(32))).toBe(true);
    expect(isValidAssetId('0123456789abcdef0123456789abcdef')).toBe(true);
  });

  it.each([
    ['a traversal', '../../etc/passwd'],
    ['a bare traversal segment', '..'],
    ['an absolute path', '/etc/passwd'],
    ['a nested path', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/../x'],
    ['a null byte', `${'a'.repeat(31)}\0`],
    ['uppercase hex', 'A'.repeat(32)],
    ['too short', 'a'.repeat(31)],
    ['too long', 'a'.repeat(33)],
    ['non-hex', 'g'.repeat(32)],
    ['empty', ''],
    ['a newline suffix', `${'a'.repeat(32)}\n`],
  ])('refuses %s', (_label, id) => {
    expect(isValidAssetId(id)).toBe(false);
  });

  it('anchors the pattern at both ends', () => {
    // An unanchored regex would match a valid id embedded in a traversal. Asserted directly rather
    // than trusting the source, since this is the guard that keeps a path inside the media root.
    expect(isValidAssetId(`../${'a'.repeat(32)}`)).toBe(false);
    expect(isValidAssetId(`${'a'.repeat(32)}/..`)).toBe(false);
  });
});

describe('the upload ceiling', () => {
  it('is eight megabytes', () => {
    expect(MAX_BYTES).toBe(8 * 1024 * 1024);
  });
});

describe('storage keeps two independent guards', () => {
  const source = read('lib/media.ts');

  it('touches no filesystem at all, so traversal is not expressible', () => {
    /*
     * This used to assert two guards: an id pattern, and a re-check that the resolved path had not
     * escaped the media root. Both existed because bytes were written to local disk under a name
     * derived from an id.
     *
     * The bytes now live on Walrus and the id is a database key, so the question "could this path
     * escape?" has no subject. That is strictly stronger than the guards it replaces — a rule that
     * cannot be loosened because there is nothing left to loosen — and this fails if any filesystem
     * call comes back.
     */
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/node:fs|readFile|writeFile|mkdir|node:path/);
  });

  it('still generates its own ids rather than trusting an upload', () => {
    // The id reaches URLs, so it stays opaque and validated even though it is no longer a path.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).toContain('ASSET_ID');
    expect(code).toMatch(/randomBytes\(16\)/);
  });

  it('never constructs a public path', () => {
    /*
     * The structural rule this module exists to enforce: no function here returns a URL, so there
     * is no URL that bypasses the entitlement handler.
     */
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/public\/uploads/);
    expect(code).not.toMatch(/return\s+[`'"]\/media\//);
  });

  it('ignores the uploader’s declared content type', () => {
    // A browser renders whatever the response header claims, so trusting a client-supplied type is
    // how an HTML file gets served as an image and runs as a page on this origin.
    expect(source).toContain('detectType');
    expect(source).not.toMatch(/input\.contentType/);
  });

  it('strips anything path-like from the stored label', () => {
    expect(source).toMatch(/replace\(\/\[\^\\w\.\\- \]\+\/g, ''\)/);
  });
});

describe('the response headers', () => {
  const route = read('app/api/media/[postId]/[assetId]/route.ts');

  it('sends nosniff, so a polyglot file cannot be re-typed by the browser', () => {
    // A file can be a valid image *and* valid HTML. Without this the browser may sniff past the
    // declared type and execute it on this origin.
    expect(route).toContain("'x-content-type-options': 'nosniff'");
  });

  it('marks the body private and uncacheable', () => {
    // A shared cache holding a body released against one reader's entitlement would serve it to
    // another — the entitlement check happens per request precisely so this cannot be skipped.
    expect(route).toContain("'cache-control': 'private, no-store'");
  });

  it('sends the sniffed type, not one supplied with the request', () => {
    expect(route).toContain("'content-type': record.contentType");
  });
});

/**
 * Seal custody, asserted against the source.
 *
 * # Why these read the file rather than call the function
 *
 * `storeAsset` seals through a threshold committee and stores through Walrus, so exercising it
 * needs both a network and key servers — of which there are none open on Sui mainnet. What can be
 * checked without either is the property that actually protects a creator: that no path through
 * this module puts a plaintext media key on a record, and that the ordering which makes an
 * unreachable committee cost nothing is still in place.
 *
 * A source assertion is a weak test in general and a strong one here, because the failure it guards
 * is a line being added — a key assigned back onto the record, a seal moved after the upload — not
 * a value being computed wrongly.
 */
describe('media keys are held by Seal, not by us', () => {
  const media = read('lib/media.ts');
  const route = read('app/api/media/[postId]/[assetId]/route.ts');

  it('never puts a plaintext key on a stored record', () => {
    /*
      The single most important line in this suite.

      `enc_key` is written only for the `platform` scheme, which nothing in this module produces any
      more. A `key:` reappearing on the returned encryption record would restore exactly the custody
      the Terms say we do not have, and it would do so silently — every test would still pass,
      because the media would still decrypt.
    */
    expect(media).not.toMatch(/encryption:\s*\{[^}]*\bkey:/);
    expect(media).toContain("scheme: 'seal'");
  });

  it('seals the key before the blob is paid for or stored', () => {
    // If the committee is unreachable, nothing must have happened: no WAL spent, no blob on
    // Walrus, no row. The only way to guarantee that is to seal first and return on failure.
    const sealAt = media.indexOf('sealUnlockKey(');
    const grantAt = media.indexOf('grantUpload(');
    const storeAt = media.indexOf('storeBlob(');
    expect(sealAt).toBeGreaterThan(-1);
    expect(sealAt).toBeLessThan(grantAt);
    expect(sealAt).toBeLessThan(storeAt);
  });

  it('dispatches on the recorded scheme rather than the shape of the row', () => {
    // "It has a wrapped key, so it must be sealed" is an inference, and the one time it is wrong it
    // is wrong silently.
    expect(media).toContain("record.encryption.scheme === 'seal'");
  });

  it('never serves sealed bytes under the image type they will become', () => {
    // The body of a sealed response is ciphertext. Announcing it as `image/png` is how a browser
    // paints a broken image and the creator gets blamed for the file.
    expect(route).toContain("'content-type': 'application/octet-stream'");
    expect(route).toContain("'x-plaintext-content-type': record.contentType");
  });

  it('still checks entitlement before releasing anything at all', () => {
    /*
      Sealing makes the gate no longer load-bearing for confidentiality; it does not make it
      optional. It keeps blob ids and wrapped keys off the open internet and it is the same one
      predicate the feed uses.
    */
    expect(route).toContain('canRead(post, entitlements)');
    expect(route.indexOf('canRead(post, entitlements)')).toBeLessThan(route.indexOf('readAsset('));
  });
});
