// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/**
 * What is in an env file, without putting any of it on a screen.
 *
 *     node scripts/env-report.mjs <path-to-env-file> [more paths...]
 *
 * # Why this exists
 *
 * Reading a `.env.local` to find out whether a key is set means the whole file — every key in it —
 * lands in a terminal, a scrollback buffer, a screen share, or an agent's transcript. The question
 * being asked is almost never "what is the value"; it is "is it set, and is it the one I think".
 *
 * So this answers exactly that and nothing else. For each key it prints the name, whether a value
 * is present, its length, and the first eight hex characters of its SHA-256. **No value is ever
 * printed, in whole or in part.** A fingerprint is enough to tell two deployments apart, or to
 * confirm a value matches one you hold elsewhere, without disclosing it.
 *
 * Eight hex characters is 32 bits. That is a comparison aid, not a commitment: it is deliberately
 * too short to brute-force a long secret back from, and too short to be worth treating as proof of
 * equality for anything that matters.
 */
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** The keys this application cannot start without, by area. */
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

/**
 * Parse dotenv syntax.
 *
 * Deliberately small and deliberately not `dotenv`: this file must be readable by somebody deciding
 * whether to trust it with a secrets file, and a dependency is a thing they would have to go and
 * read too. It handles `export ` prefixes, `#` comments, blank lines, and single or double quoted
 * values — which is the whole of what these files use.
 */
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

/**
 * Values that are present but are not the secret.
 *
 * `vercel env pull` writes the literal string `[SENSITIVE]` for any variable marked Sensitive,
 * because Vercel does not permit those to be read back — correct of them, and it means a pulled
 * file looks complete while holding nothing usable.
 *
 * This check exists because the first version of this script did not have it and reported eleven
 * placeholders as `ok`. A report that cannot tell a secret from the word "[SENSITIVE]" is worse
 * than no report: it answers the question confidently and wrongly.
 */
const PLACEHOLDERS = new Set(['[SENSITIVE]', '[REDACTED]', 'changeme', 'xxx', 'TODO']);
const isPlaceholder = (value) => PLACEHOLDERS.has(value.trim());

const paths = process.argv.slice(2);
if (paths.length === 0) {
  console.error('usage: node scripts/env-report.mjs <path-to-env-file> [more paths...]');
  process.exit(2);
}

/** Everything found, merged in the order the paths were given, for the coverage summary. */
const seen = new Map();
/** Keys whose value is a placeholder rather than the secret. */
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
