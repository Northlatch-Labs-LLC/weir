// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { loadChainConfig } from '../src/chain.js';
import { askPurse } from '../src/client.js';
import { planLedgerTick } from '../src/ledger.js';
import { readCurrentEpoch, readSoul, readVaultEarnings } from '../src/soul-read.js';

const FLAGS = [
  '--agent',
  '--chain',
  '--socket',
  '--graphql',
  '--package',
  '--registry',
  '--registry-version',
  '--soul',
  '--soul-version',
  '--vault',
  '--ledger-cap',
  '--ledger-cap-version',
  '--ledger-cap-digest',
  '--clock',
  '--clock-version',
  '--burn-per-epoch-mist',
  '--state',
] as const;

const values = new Map<string, string>();
let allowRetire = false;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 1) {
  const flag = argv[i]!;
  if (flag === '--allow-retire') {
    allowRetire = true;
    continue;
  }
  if (!FLAGS.includes(flag as (typeof FLAGS)[number])) {
    console.error(
      `ledger-tick: ${flag} is not a flag this takes. It takes: ${FLAGS.join(' ')} [--allow-retire].`,
    );
    process.exit(1);
  }
  const value = argv[i + 1];
  if (value === undefined || value.startsWith('--')) {
    console.error(`ledger-tick: ${flag} needs a value.`);
    process.exit(1);
  }
  values.set(flag, value);
  i += 1;
}
for (const flag of FLAGS) {
  if (!values.has(flag)) {
    console.error(
      `ledger-tick: ${flag} is required. Nothing is defaulted here: every one of these names an ` +
        `object on mainnet or the cost of a day.`,
    );
    process.exit(1);
  }
}

const agent = values.get('--agent')!;
const prefix = `${agent}-ledger`;
const burnRaw = values.get('--burn-per-epoch-mist')!;
if (!/^(0|[1-9][0-9]{0,19})$/.test(burnRaw)) {
  console.error(`${prefix}: --burn-per-epoch-mist is a u64 written as a decimal string.`);
  process.exit(1);
}
const burnPerEpochMist = BigInt(burnRaw);

const chain = await loadChainConfig(values.get('--chain')!);
if (!chain.ok) {
  console.error(`${prefix}: ${chain.refused.reason}`);
  process.exit(1);
}

const endpoint = values.get('--graphql')!;
const statePath = values.get('--state')!;

const epoch = await readCurrentEpoch(endpoint);
if (!epoch.ok) {
  console.error(`${prefix}: ${epoch.refused.reason}`);
  process.exit(1);
}
const soul = await readSoul(endpoint, values.get('--soul')!);
if (!soul.ok) {
  console.error(`${prefix}: ${soul.refused.reason}`);
  process.exit(1);
}
const vault = await readVaultEarnings(endpoint, values.get('--vault')!);
if (!vault.ok) {
  console.error(`${prefix}: ${vault.refused.reason}`);
  process.exit(1);
}

let lastSeenEarningsMist = 0n;
try {
  const raw = await readFile(statePath, 'utf8');
  const parsed = JSON.parse(raw) as { lastSeenEarningsMist?: unknown };
  if (
    typeof parsed.lastSeenEarningsMist !== 'string' ||
    !/^(0|[1-9][0-9]{0,19})$/.test(parsed.lastSeenEarningsMist)
  ) {
    console.error(
      `${prefix}: ${statePath} exists but its lastSeenEarningsMist is not a u64 string. Refusing to guess.`,
    );
    process.exit(1);
  }
  lastSeenEarningsMist = BigInt(parsed.lastSeenEarningsMist);
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
    console.error(`${prefix}: ${statePath} could not be read: ${(error as Error).message}`);
    process.exit(1);
  }
}

const plan = planLedgerTick({
  currentEpoch: epoch.value,
  soul: soul.value,
  vaultEarningsMist: vault.value,
  lastSeenEarningsMist,
  burnPerEpochMist,
});

if (plan.kind === 'wait') {
  console.log(`${prefix}: nothing to do — ${plan.reason}`);
  process.exit(0);
}

console.log(
  `${prefix}: epoch ${String(soul.value.epochOpenedAt)} closing at chain epoch ${String(epoch.value)}; ` +
    `earned ${String(plan.bookEarnedMist)} burned ${String(plan.bookBurnedMist)} ` +
    `cover ${String(plan.vaultSui)} against allowance ${String(soul.value.allowancePerEpoch)}; ` +
    `net ${plan.epochNetNonneg ? 'non-negative' : 'NEGATIVE'}${plan.willBeCritical ? '; CRITICAL' : ''}`,
);

if (plan.willRetire && !allowRetire) {
  console.error(
    `${prefix}: REFUSING. This settlement is the second consecutive critical epoch, so settle_epoch ` +
      `would retire ${agent} inside the same call. The vault holds ${String(plan.vaultSui)} MIST ` +
      `against an allowance of ${String(soul.value.allowancePerEpoch)} MIST. Give the citizen cover, ` +
      `lower the allowance, or pass --allow-retire if ending it is what you mean.`,
  );
  process.exit(4);
}

const packageId = values.get('--package')!;
const ledgerCap = {
  objectId: values.get('--ledger-cap')!,
  version: values.get('--ledger-cap-version')!,
  digest: values.get('--ledger-cap-digest')!,
};
const soulRef = {
  objectId: values.get('--soul')!,
  initialSharedVersion: values.get('--soul-version')!,
  mutable: true,
};

const asks: { readonly what: string; readonly intent: unknown }[] = [];
if (plan.bookEarnedMist > 0n) {
  asks.push({
    what: 'book_earned',
    intent: {
      kind: 'book_earned',
      packageId,
      ledgerCap,
      soul: soulRef,
      amountMist: String(plan.bookEarnedMist),
    },
  });
}
if (plan.bookBurnedMist > 0n) {
  asks.push({
    what: 'book_burned',
    intent: {
      kind: 'book_burned',
      packageId,
      ledgerCap,
      soul: soulRef,
      amountMist: String(plan.bookBurnedMist),
    },
  });
}
asks.push({
  what: 'settle_epoch',
  intent: {
    kind: 'settle_epoch',
    packageId,
    ledgerCap,
    registry: {
      objectId: values.get('--registry')!,
      initialSharedVersion: values.get('--registry-version')!,
      mutable: true,
    },
    soul: soulRef,
    clock: {
      objectId: values.get('--clock')!,
      initialSharedVersion: values.get('--clock-version')!,
      mutable: false,
    },
    vaultSui: String(plan.vaultSui),
    epochNetNonneg: plan.epochNetNonneg,
  },
});

const socketPath = values.get('--socket')!;
for (const ask of asks) {
  const answer = await askPurse({ socketPath, intent: ask.intent });
  if (!answer.ok) {
    console.error(`${prefix}: ${ask.what} — ${answer.refused.reason}`);
    process.exit(3);
  }
  if (!answer.value.ok) {
    console.error(`${prefix}: ${ask.what} refused — ${JSON.stringify(answer.value)}`);
    process.exit(3);
  }
  console.log(`${prefix}: ${ask.what} signed.`);
}

await mkdir(dirname(statePath), { recursive: true });
await writeFile(
  statePath,
  `${JSON.stringify({ lastSeenEarningsMist: String(plan.vaultSui), settledAtEpoch: String(epoch.value) }, null, 2)}\n`,
  'utf8',
);
console.log(`${prefix}: epoch settled.`);
process.exit(0);
