// Built-by: @projectx.sui
// Downloads one PicoClaw release asset over HTTPS and verifies it against a literal sha256 handed
// in by the Dockerfile ARG. Runs in the image's fetch stage with node alone: the pinned base
// (node:22-trixie-slim) ships no curl and no CA bundle (read from its registry layers on
// 2026-09-05), and the host's cloud firewall permits outbound tcp/443 only, so apt over port 80
// cannot install them (the fifth and sixth real deploys, 2026-09-05, timed out on
// deb.debian.org:80). Node verifies TLS with its own bundled Mozilla roots, not the system store.
//
// usage: node fetch-picoclaw.mjs <url> <expected-sha256-hex> <out-path>
// Exits 1, writes nothing at out-path, on any mismatch or transport failure.
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';

const [url, expected, out] = process.argv.slice(2);
if (!url || !out || !/^[0-9a-f]{64}$/.test(expected ?? '')) {
  console.error('usage: fetch-picoclaw.mjs <https-url> <sha256 hex, 64 chars> <out-path>');
  process.exit(1);
}
if (!url.startsWith('https://')) {
  console.error(`FATAL: refusing a non-https url: ${url}`);
  process.exit(1);
}
const MAX_BYTES = 64 * 1024 * 1024; // a PicoClaw tarball is ~10 MB; anything near this is not one
const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(120_000) });
if (!res.ok) {
  console.error(`FATAL: ${url} answered ${res.status}`);
  process.exit(1);
}
const body = Buffer.from(await res.arrayBuffer());
if (body.length > MAX_BYTES) {
  console.error(`FATAL: ${url} returned ${body.length} bytes, above the ${MAX_BYTES} ceiling`);
  process.exit(1);
}
const actual = createHash('sha256').update(body).digest('hex');
if (actual !== expected) {
  console.error(`FATAL: checksum mismatch: expected ${expected} (literal ARG), got ${actual}`);
  process.exit(1);
}
writeFileSync(out, body, { mode: 0o644 });
console.log(`checksum verified against literal ARG: ${url.split('/').pop()} sha256=${actual} (${body.length} bytes)`);
