// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectType, isValidAssetId, MAX_BYTES } from '../lib/media';

const root = join(import.meta.dirname, '..');
const read = (p: string): string => readFileSync(join(root, p), 'utf8');

const bytes = (...values: number[]) => Uint8Array.from(values);
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
    expect(detectType(bytes(0x89, 0x50))).toBeNull();
    expect(detectType(bytes(0xff, 0xd8))).toBeNull();
  });

  it('refuses a file whose magic is correct but not at the start', () => {
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
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/node:fs|readFile|writeFile|mkdir|node:path/);
  });

  it('still generates its own ids rather than trusting an upload', () => {
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).toContain('ASSET_ID');
    expect(code).toMatch(/randomBytes\(16\)/);
  });

  it('never constructs a public path', () => {
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/public\/uploads/);
    expect(code).not.toMatch(/return\s+[`'"]\/media\//);
  });

  it('ignores the uploader’s declared content type', () => {
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
    expect(route).toContain("'x-content-type-options': 'nosniff'");
  });

  it('marks the body private and uncacheable', () => {
    expect(route).toContain("'cache-control': 'private, no-store'");
  });

  it('sends the sniffed type, not one supplied with the request', () => {
    expect(route).toContain("'content-type': record.contentType");
  });
});

describe('media keys are held by Seal, not by us', () => {
  const media = read('lib/media.ts');
  const route = read('app/api/media/[postId]/[assetId]/route.ts');

  it('never puts a plaintext key on a stored record', () => {
    expect(media).not.toMatch(/encryption:\s*\{[^}]*\bkey:/);
    expect(media).toContain("scheme: 'seal'");
  });

  it('seals the key before the blob is paid for or stored', () => {
    const sealAt = media.indexOf('sealUnlockKey(');
    const grantAt = media.indexOf('grantUpload(');
    const storeAt = media.indexOf('storeBlob(');
    expect(sealAt).toBeGreaterThan(-1);
    expect(sealAt).toBeLessThan(grantAt);
    expect(sealAt).toBeLessThan(storeAt);
  });

  it('dispatches on the recorded scheme rather than the shape of the row', () => {
    expect(media).toContain("record.encryption.scheme === 'seal'");
  });

  it('never serves sealed bytes under the image type they will become', () => {
    expect(route).toContain("'content-type': 'application/octet-stream'");
    expect(route).toContain("'x-plaintext-content-type': record.contentType");
  });

  it('still checks entitlement before releasing anything at all', () => {
    expect(route).toContain('canRead(post, entitlements)');
    expect(route.indexOf('canRead(post, entitlements)')).toBeLessThan(route.indexOf('readAsset('));
  });
});
