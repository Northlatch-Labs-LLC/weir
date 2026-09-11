// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const REQUIRED = {
  database: ['PROJECTX_DATABASE_URL'],
  chain: [
    'PROJECTX_SOCIAL_NETWORK',
    'PROJECTX_SOCIAL_GRPC_URL',
    'PROJECTX_SOCIAL_PACKAGE_ID',
    'PROJECTX_SOCIAL_LATEST_PACKAGE_ID',
    'PROJECTX_SOCIAL_PLATFORM_ID',
    'PROJECTX_SOCIAL_REGISTRY_ID',
  ],
  zklogin: [
    'PROJECTX_SOCIAL_ZKLOGIN_SEED',
    'PROJECTX_SOCIAL_GOOGLE_CLIENT_ID',
    'PROJECTX_SOCIAL_ZKLOGIN_PROVER_URL',
  ],
  tests: ['PROJECTX_TEST_DATABASE_URL'],
};

function parse(text) {
  const out = new Map();
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    let key = line.slice(0, eq).trim();
    if (key.startsWith('export ')) key = key.slice(7).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length > 1) ||
      (value.startsWith("'") && value.endsWith("'") && value.length > 1)
    ) {
      value = value.slice(1, -1);
    }
    out.set(key, value);
  }
  return out;
}

const fingerprint = (value) =>
  value === '' ? '—' : createHash('sha256').update(value, 'utf8').digest('hex').slice(0, 8);

const PLACEHOLDERS = new Set(['[SENSITIVE]', '[REDACTED]', 'changeme', 'xxx', 'TODO']);
const isPlaceholder = (value) => PLACEHOLDERS.has(value.trim());

const paths = process.argv.slice(2);
if (paths.length === 0) {
  console.error('usage: node scripts/env-report.mjs <path-to-env-file> [more paths...]');
  process.exit(2);
}

const seen = new Map();
const stubbed = new Set();

for (const p of paths) {
  const full = resolve(p);
  console.log(`\n${full}`);
  if (!existsSync(full)) {
    console.log('  (not present)');
    continue;
  }
  const entries = parse(readFileSync(full, 'utf8'));
  if (entries.size === 0) {
    console.log('  (no keys)');
    continue;
  }
  console.log(`  ${'KEY'.padEnd(38)} ${'SET'.padEnd(5)} ${'LEN'.padEnd(5)} FINGERPRINT`);
  for (const [key, value] of [...entries].sort(([a], [b]) => a.localeCompare(b))) {
    const placeholder = isPlaceholder(value);
    const set = value === '' ? 'no' : placeholder ? 'STUB' : 'yes';
    console.log(
      `  ${key.padEnd(38)} ${set.padEnd(5)} ${String(value.length).padEnd(5)} ${
        placeholder ? 'not a real value' : fingerprint(value)
      }`,
    );
    if (!seen.has(key) && value !== '' && !placeholder) seen.set(key, full);
    if (placeholder) stubbed.add(key);
  }
}

console.log('\nCoverage of what this application needs\n');
let missingCount = 0;
for (const [area, keys] of Object.entries(REQUIRED)) {
  console.log(`  ${area}`);
  for (const key of keys) {
    const where = seen.get(key);
    if (where === undefined) {
      missingCount += 1;
      console.log(
        stubbed.has(key)
          ? `    STUB     ${key}  (present but holds a placeholder, not the secret)`
          : `    MISSING  ${key}`,
      );
    } else {
      console.log(`    ok       ${key}`);
    }
  }
}
console.log(
  missingCount === 0
    ? '\nEverything required is present. No value was printed.\n'
    : `\n${missingCount} required key(s) not found in the files given. No value was printed.\n`,
);
