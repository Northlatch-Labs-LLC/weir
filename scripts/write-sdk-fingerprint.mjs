// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { fingerprintSrc, STAMP_FILE } from './sdk-src-fingerprint.mjs';

const sdkDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'sdk');
const fingerprint = fingerprintSrc(sdkDir);
if (fingerprint !== null) {
  const target = join(sdkDir, STAMP_FILE);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, fingerprint + '\n');
}
