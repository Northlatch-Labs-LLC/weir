// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { readdirSync, statSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';

export const STAMP_FILE = 'dist/.build-fingerprint';

export function fingerprintSrc(sdkDir) {
  const src = join(sdkDir, 'src');
  if (!existsSync(src)) return null;

  const rows = [];
  for (const entry of readdirSync(src, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    const full = join(entry.parentPath ?? entry.path, entry.name);
    const s = statSync(full);
    rows.push(`${relative(src, full)}\0${s.size}\0${s.mtimeMs}`);
  }
  rows.sort();
  return createHash('sha256').update(rows.join('\n')).digest('hex');
}
