// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/**
 * The two shipped policy documents, read from `policy/` and evaluated.
 *
 * A3 from Security's review of 2026-09-05: "`settle_epoch` is separated by a policy document that
 * does not exist". The binary that holds the hot key can build a `LedgerCap` call — `intent.ts`
 * carries the kind on purpose, because the settlement signer is this same program with a different
 * key — and the only thing that stops it is the deployed document's `allowedTargets`. Until this
 * file existed, no document was on the branch and no test asserted the separation, so decision 6's
 * "one signer per money path" was a sentence in a comment.
 *
 * Three properties are asserted here, each against the real loader and the real evaluator:
 *
 *  1. The content document refuses a **well-formed** `settle_epoch`, by target.
 *  2. The ledger document refuses `post` and `price`, by target.
 *  3. A document naming both arms stops the purse at start, before a key is held open.
 *
 * # Why the documents are loaded and rendered rather than written inline
 *
 * A fixture that restated the document would pass while the shipped file said something else. The
 * files in `policy/` are read here byte for byte; the only thing this file changes is the four
 * addresses and the soul package id, which are `<ANGLE_BRACKET>` substitutions because **no Heron
 * key exists yet** and **the soul package is unpublished** — the same convention, and the same
 * reason, as `<POLICY_SHA256>` in `systemd/heron-purse.service`.
 */

import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import type { PolicyDoc } from '@projectx-social/policy';
import { AuditFile } from '../src/audit-file.js';
import { fixedGas } from '../src/build.js';
import { SpendLedger } from '../src/ledger-file.js';
import { loadPinnedPolicy } from '../src/policy-file.js';
import { createPurse, type Purse } from '../src/purse.js';
import { startPurse } from '../src/server.js';
import {
  CHAIN,
  CLOCK_ID,
  GAS_COIN_ID,
  LEDGER_CAP_ID,
  REGISTRY_ID,
  SETTLE_EPOCH,
  SOUL_ID,
  SOUL_PACKAGE,
  policyFor,
  postIntentFor,
  priceIntentFor,
  setPriceResponse,
  settleEpochIntentFor,
  settleEpochResponse,
  signerFor,
  stubClient,
  stubPort,
  temporaryDirectory,
  throwawayKeypair,
} from './helpers.js';

const POLICY_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'policy');

const GAS = fixedGas({
  price: 1000n,
  payment: [{ objectId: GAS_COIN_ID, version: '1', digest: '11111111111111111111111111111111' }],
});

/** The substitutions `digitalocean/deploy.sh` fills. Fixture values stand in for them here. */
function rendered(text: string, agentAddress: string): string {
  return text
    .replaceAll('<HERON_ADDRESS>', agentAddress)
    .replaceAll('<LEDGER_ADDRESS>', agentAddress)
    .replaceAll('<OPERATOR_ADDRESS>', `0x${'d'.repeat(64)}`)
    .replaceAll('<TREASURY_ADDRESS>', `0x${'e'.repeat(64)}`)
    .replaceAll('<HERON_VAULT_ID>', `0x${'1'.repeat(64)}`)
    .replaceAll('<HERON_CREATOR_CAP_ID>', `0x${'2'.repeat(64)}`)
    .replaceAll('<SOUL_PACKAGE_ID>', SOUL_PACKAGE)
    .replaceAll('<LEDGER_CAP_ID>', LEDGER_CAP_ID)
    .replaceAll('<SOUL_REGISTRY_ID>', REGISTRY_ID)
    .replaceAll('<HERON_SOUL_ID>', SOUL_ID)
    .replaceAll('<CLOCK_ID>', CLOCK_ID);
}

/** Load one of the shipped documents through the real loader, rendered for a throwaway address. */
async function shipped(name: string, agentAddress: string): Promise<PolicyDoc> {
  const raw = await readFile(join(POLICY_DIR, name), 'utf8');
  const dir = await temporaryDirectory('heron-policy-');
  const path = join(dir, name);
  const text = rendered(raw, agentAddress);
  await writeFile(path, text, 'utf8');
  const pin = createHash('sha256').update(text, 'utf8').digest('hex');

  const loaded = await loadPinnedPolicy({ path, expectedSha256: pin });
  if (!loaded.ok) throw new Error(`${name} did not load: ${loaded.refused.reason}`);
  return loaded.value.doc;
}

interface Harness {
  readonly purse: Purse;
  readonly close: () => Promise<void>;
}

async function purseOver(policy: PolicyDoc, response: unknown, address: string): Promise<Harness> {
  const dir = await temporaryDirectory();
  const audit = await AuditFile.open(join(dir, 'audit.jsonl'));
  if (!audit.ok) throw new Error(audit.reason);
  const ledger = await SpendLedger.open({ path: join(dir, 'spend.jsonl'), policy });
  if (!ledger.ok) throw new Error(ledger.reason);

  return {
    purse: createPurse({
      signer: signerFor(keypairsByAddress.get(address)!),
      policy,
      policyHash: 'f'.repeat(64),
      policyFileSha256: 'e'.repeat(64),
      chain: CHAIN,
      client: stubClient(response),
      audit: audit.file,
      ledger: ledger.ledger,
      gas: GAS,
      simulation: stubPort(response, address),
      log: () => undefined,
    }),
    close: async () => {
      await audit.file.close();
      await ledger.ledger.close();
    },
  };
}

const keypairsByAddress = new Map<string, Ed25519Keypair>();
function throwaway(): string {
  const keypair = throwawayKeypair();
  const address = keypair.toSuiAddress();
  keypairsByAddress.set(address, keypair);
  return address;
}

describe('policy/heron-content.json — the content arm', () => {
  it('refuses a well-formed settle_epoch, by target', async () => {
    const address = throwaway();
    const policy = await shipped('heron-content.json', address);
    const h = await purseOver(policy, settleEpochResponse(address), address);

    const response = await h.purse.handle({ intent: settleEpochIntentFor() });

    expect(response.ok).toBe(false);
    if (response.ok) throw new Error('unreachable');
    expect(response.refused.ruleId).toBe('move-call-target');
    expect(response.refused.reason).toContain('settle_epoch');
    await h.close();
  });

  it('names three recipients, SUI only, and the 0.4 SUI epoch ceiling', async () => {
    const address = throwaway();
    const policy = await shipped('heron-content.json', address);

    expect(policy.allowedRecipients).toHaveLength(3);
    expect(policy.allowedRecipients[0]).toBe(address);
    expect(policy.allowedTypeArguments).toEqual([`0x${'0'.repeat(63)}2::sui::SUI`]);
    expect(policy.outflowCeilings).toHaveLength(1);
    expect(policy.outflowCeilings[0]!.maxPerPeriod).toBe('400000000');
    expect(policy.maxGasBudgetMist).toBe('20000000');
  });

  it('allows the post and price entry and record_spend, and nothing else', async () => {
    const policy = await shipped('heron-content.json', throwaway());
    expect(policy.allowedTargets).toHaveLength(2);
    expect(policy.allowedTargets.some((t) => t.endsWith('::creator::set_content_price'))).toBe(true);
    expect(policy.allowedTargets.some((t) => t.endsWith('::soul::record_spend'))).toBe(true);
    expect(policy.allowedTargets.some((t) => t.endsWith('::soul::settle_epoch'))).toBe(false);
  });

  it('pins the package on every target — no bare module::function', async () => {
    const policy = await shipped('heron-content.json', throwaway());
    for (const target of policy.allowedTargets) {
      expect(target).toMatch(/^0x[0-9a-f]{1,64}::[a-z_]+::[a-z_]+$/);
    }
  });
});

describe('policy/heron-ledger.json — the LedgerCap service', () => {
  it('refuses a price intent, by target', async () => {
    const address = throwaway();
    const policy = await shipped('heron-ledger.json', address);
    const h = await purseOver(policy, setPriceResponse(address), address);

    const response = await h.purse.handle({ intent: priceIntentFor() });

    expect(response.ok).toBe(false);
    if (response.ok) throw new Error('unreachable');
    expect(response.refused.ruleId).toBe('move-call-target');
    await h.close();
  });

  it('refuses a post intent, by target', async () => {
    const address = throwaway();
    const policy = await shipped('heron-ledger.json', address);
    const h = await purseOver(policy, setPriceResponse(address), address);

    const response = await h.purse.handle({ intent: postIntentFor() });

    expect(response.ok).toBe(false);
    if (response.ok) throw new Error('unreachable');
    expect(response.refused.ruleId).toBe('move-call-target');
    await h.close();
  });

  it('names settle_epoch and nothing else', async () => {
    const policy = await shipped('heron-ledger.json', throwaway());
    expect(policy.allowedTargets).toEqual([SETTLE_EPOCH]);
  });
});

describe('one signer per money path', () => {
  /*
    Decision 6 keeps the caps on separate keys and separate services. Two documents that each keep
    to one arm are only half of that: the half that fails is an operator pasting both target sets
    into one file to "simplify the deploy", at which point one key signs both money paths and a
    settlement can consume the content ceiling.

    The purse refuses to start on such a document. At start, not per transaction: a purse that
    caught it per transaction would already be holding the key.
  */
  async function startWith(
    targets: readonly string[],
  ): Promise<Awaited<ReturnType<typeof startPurse>> & { socketPath: string }> {
    const dir = await temporaryDirectory();
    const keypair = Ed25519Keypair.generate();
    const address = keypair.toSuiAddress();

    const keyPath = join(dir, 'heron-hot');
    await writeFile(keyPath, `${keypair.getSecretKey()}\n`, { mode: 0o600 });

    const policyPath = join(dir, 'heron-policy.json');
    const text = `${JSON.stringify(policyFor(address, { allowedTargets: [...targets] }), null, 2)}\n`;
    await writeFile(policyPath, text, 'utf8');

    const chainPath = join(dir, 'chain.json');
    await writeFile(chainPath, JSON.stringify(CHAIN), 'utf8');

    const socketPath = join(dir, 'purse.sock');
    const outcome = await startPurse({
      server: {
        socket: socketPath,
        policy: policyPath,
        policySha256: createHash('sha256').update(text, 'utf8').digest('hex'),
        chain: chainPath,
        audit: join(dir, 'audit.jsonl'),
        spend: join(dir, 'spend.jsonl'),
        keyFile: keyPath,
      },
      argv: ['node', 'server.js'],
      env: {},
      log: () => undefined,
    });
    return Object.assign(outcome, { socketPath });
  }

  it('refuses to start on a document that allows a content entry and settle_epoch', async () => {
    const started = await startWith([
      `0x${'0'.repeat(62)}c5::creator::set_content_price`,
      SETTLE_EPOCH,
    ]);

    expect(started.ok).toBe(false);
    if (started.ok) throw new Error('unreachable');
    expect(started.refused.reason).toContain('One signer per money path');
    expect(started.refused.reason).toContain('settle_epoch');
  });

  it('starts on a document that keeps to the content arm', async () => {
    const started = await startWith([`0x${'0'.repeat(62)}c5::creator::set_content_price`]);
    expect(started.ok).toBe(true);
    if (!started.ok) throw new Error(started.refused.reason);
    await started.value.stop();
  });

  it('starts on a document that keeps to settle_epoch', async () => {
    const started = await startWith([SETTLE_EPOCH]);
    expect(started.ok).toBe(true);
    if (!started.ok) throw new Error(started.refused.reason);
    await started.value.stop();
  });
});
