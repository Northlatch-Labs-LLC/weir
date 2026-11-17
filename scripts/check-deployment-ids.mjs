// Built-by: @projectx.sui · Co-authored-by: Claude <no-reply@anthropic.com>
//
// The three places a deployment's ids are written, kept agreeing.
//
// WHY THIS EXISTS. .env.example calls its mainnet ids "a RECORD, from sui-contracts/deploy/
// mainnet.json" — and until 2026-11-17 that claim was false in the most dangerous way: it named
// upgrade v3 as PROJECTX_SOCIAL_LATEST_PACKAGE_ID while the chain (and the record) were at v5.
// Nothing compared the two, so nothing said so, and a deployment provisioned from the example
// file would have executed v3 bytecode — missing v5's price-ranked Seal approval. CUSTODY.md had
// drifted the same way, still claiming both capabilities sat in the multisig months after the
// PlatformCap moved hot. "Check them against that file" was advice; this script is the check.
//
// What it compares, offline, on every PR:
//   .env.example  <->  sui-contracts/deploy/mainnet.json   (the five chain ids + the cap ids)
//   CUSTODY.md    <->  sui-contracts/deploy/mainnet.json   (capability object ids and owners)
//
// It reads files only. It does not touch the chain: the record's own custody block states its
// owners were verified on chain, and this script keeps the RECORDS honest with each other so a
// human verifying against the chain has one place to check, not three that may disagree.
//
// After publishing an upgrade: update mainnet.json (it is the record), then .env.example's
// PROJECTX_SOCIAL_LATEST_PACKAGE_ID in the same commit. That has always been the rule; now the
// rule fails CI when it is broken instead of when a deployer is.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const record = JSON.parse(readFileSync(join(root, 'sui-contracts/deploy/mainnet.json'), 'utf8'));
const envExample = readFileSync(join(root, '.env.example'), 'utf8');
const custody = readFileSync(join(root, 'CUSTODY.md'), 'utf8');

const problems = [];
const refuse = (message) => problems.push(message);

// --- .env.example assignments ---------------------------------------------------------------
const env = new Map();
for (const line of envExample.split('\n')) {
  const match = line.match(/^(PROJECTX_[A-Z0-9_]+)=(.*)$/);
  if (match !== null) env.set(match[1], match[2].trim());
}

const newestUpgrade = (upgrades) => {
  let newest = null;
  for (const [version, entry] of Object.entries(upgrades)) {
    const n = Number(version.replace(/^v/, ''));
    if (newest === null || n > newest.n) newest = { n, id: entry.packageId };
  }
  return newest;
};

const latest = newestUpgrade(record.upgrades);
if (latest === null) refuse('mainnet.json records no upgrades; LATEST cannot be derived.');

const expected = [
  ['PROJECTX_SOCIAL_PACKAGE_ID', record.packageId, 'the ORIGINAL package id (mainnet.json packageId)'],
  ['PROJECTX_SOCIAL_PLATFORM_ID', record.shared?.platform, 'the shared Platform object (mainnet.json shared.platform)'],
  ['PROJECTX_SOCIAL_REGISTRY_ID', record.shared?.registry, 'the shared account Registry (mainnet.json shared.registry)'],
  ['PROJECTX_SOCIAL_KEY_REGISTRY_ID', record.upgrades?.v2?.created?.keyRegistry, 'the shared KeyRegistry (mainnet.json upgrades.v2.created.keyRegistry)'],
  ['PROJECTX_SOCIAL_LATEST_PACKAGE_ID', latest?.id, `the NEWEST upgrade (mainnet.json is at v${latest?.n}); Sui will not resolve an older id to it`],
];

for (const [name, id, why] of expected) {
  const got = env.get(name);
  if (got === undefined) {
    refuse(`${name} is missing from .env.example entirely — it names ${why}.`);
  } else if (id === undefined) {
    refuse(`mainnet.json has no id for ${name} (${why}); the record and the example cannot agree.`);
  } else if (got.toLowerCase() !== id.toLowerCase()) {
    refuse(
      `${name} in .env.example is ${got}, but ${why} is ${id}. ` +
        (name === 'PROJECTX_SOCIAL_LATEST_PACKAGE_ID'
          ? 'A deployment provisioned from the example file would execute old bytecode.'
          : 'The example file claims to be a record of mainnet.json; make them the same commit.'),
    );
  }
}

// Cap ids are optional in .env.example (blank = the agent manifest publishes no custody section),
// but if one IS set it must be the real object.
for (const [name, id] of [
  ['PROJECTX_SOCIAL_PLATFORM_CAP_ID', record.capabilities?.platformCap],
  ['PROJECTX_SOCIAL_UPGRADE_CAP_ID', record.capabilities?.upgradeCap],
]) {
  const got = env.get(name);
  if (got !== undefined && got !== '' && id !== undefined && got.toLowerCase() !== id.toLowerCase()) {
    refuse(`${name} in .env.example is ${got}, but mainnet.json records ${id}.`);
  }
}

// --- CUSTODY.md capability table ------------------------------------------------------------
for (const [id, owner, what] of [
  [record.capabilities?.platformCap, record.capabilities?.custody?.platformCapOwner, 'PlatformCap'],
  [record.capabilities?.upgradeCap, record.capabilities?.custody?.upgradeCapOwner, 'UpgradeCap'],
]) {
  if (id === undefined || owner === undefined) {
    refuse(`mainnet.json records no id/owner for ${what}; CUSTODY.md cannot be checked against it.`);
    continue;
  }
  if (!custody.includes(id)) {
    refuse(`CUSTODY.md does not name the ${what} object id ${id} from mainnet.json.`);
  }
  if (!custody.includes(owner)) {
    refuse(
      `CUSTODY.md does not name ${what}'s recorded holder ${owner} (mainnet.json capabilities.custody, ` +
        `verified ${record.capabilities?.custody?.verifiedAtIso ?? 'unknown date'}). If custody HAS moved, ` +
        `update mainnet.json's custody block and CUSTODY.md in the same commit — the document has lagged the chain before.`,
    );
  }
}

if (problems.length > 0) {
  console.error(`deployment records REFUSED — ${problems.length} disagreement${problems.length === 1 ? '' : 's'}:`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log(
  `deployment records agree: .env.example, CUSTODY.md and deploy/mainnet.json (latest v${latest?.n} ` +
    `${String(latest?.id).slice(0, 10)}…, custody verified ${record.capabilities?.custody?.verifiedAtIso}).`,
);
