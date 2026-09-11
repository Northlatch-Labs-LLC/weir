// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { verifyTransactionSignature } from '@mysten/sui/verify';
import type { PolicyDoc } from '@projectx-social/policy';
import { AuditFile } from '../src/audit-file.js';
import { fixedGas } from '../src/build.js';
import { intentHash } from '../src/intent.js';
import { SpendLedger } from '../src/ledger-file.js';
import { createPurse, type Purse } from '../src/purse.js';
import {
  CHAIN,
  DIGEST,
  GAS_COIN_ID,
  STRANGER,
  VAULT_ID,
  policyFor,
  postIntentFor,
  priceIntentFor,
  setPriceResponse,
  signerFor,
  stubClient,
  stubPort,
  temporaryDirectory,
  throwawayKeypair,
  type ResponseOverrides,
} from './helpers.js';

const GAS = fixedGas({
  price: 1000n,
  payment: [{ objectId: GAS_COIN_ID, version: '1', digest: '11111111111111111111111111111111' }],
});

interface Harness {
  readonly purse: Purse;
  readonly address: string;
  readonly auditPath: string;
  readonly logged: readonly string[];
  readonly close: () => Promise<void>;
}

async function harness(
  options: {
    readonly policy?: Partial<PolicyDoc>;
    readonly response?: ResponseOverrides;
  } = {},
): Promise<Harness> {
  const keypair = throwawayKeypair();
  const address = keypair.toSuiAddress();
  const policy = policyFor(address, options.policy ?? {});
  const response = setPriceResponse(address, options.response ?? {});

  const dir = await temporaryDirectory();
  const auditPath = join(dir, 'audit.jsonl');
  const opened = await AuditFile.open(auditPath);
  if (!opened.ok) throw new Error(opened.reason);
  const ledger = await SpendLedger.open({ path: join(dir, 'spend.jsonl'), policy });
  if (!ledger.ok) throw new Error(ledger.reason);

  const logged: string[] = [];
  const purse = createPurse({
    signer: signerFor(keypair),
    policy,
    policyHash: 'f'.repeat(64),
    policyFileSha256: 'e'.repeat(64),
    chain: CHAIN,
    client: stubClient(response),
    audit: opened.file,
    ledger: ledger.ledger,
    gas: GAS,
    simulation: stubPort(response, address),
    log: (line) => logged.push(line),
  });

  return {
    purse,
    address,
    auditPath,
    logged,
    close: async () => {
      await opened.file.close();
      await ledger.ledger.close();
    },
  };
}

async function auditLines(path: string): Promise<Record<string, unknown>[]> {
  const text = await readFile(path, 'utf8');
  return text
    .trim()
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('a permitted intent', () => {
  it('is signed, and the signature verifies over the exact bytes that were simulated', async () => {
    const h = await harness();
    const response = await h.purse.handle({ intent: priceIntentFor() });

    expect(response.ok).toBe(true);
    if (!response.ok) throw new Error('unreachable');
    if (!('digest' in response)) throw new Error('a transaction was expected');
    expect(response.digest).toBe(DIGEST);

    const bytes = Uint8Array.from(Buffer.from(response.txBytesB64, 'base64'));
    const publicKey = await verifyTransactionSignature(bytes, response.signature, { address: h.address });
    expect(publicKey.toSuiAddress()).toBe(h.address);
    await h.close();
  });

  it('records one signed line, and the chain verifies', async () => {
    const h = await harness();
    await h.purse.handle({ intent: priceIntentFor() });

    const lines = await auditLines(h.auditPath);
    expect(lines).toHaveLength(1);
    expect(lines[0]!['outcome']).toBe('signed');
    expect(lines[0]!['intentKind']).toBe('price');
    expect(lines[0]!['intentHash']).toBe(intentHash(priceIntentFor()));
    expect(lines[0]!['txDigest']).toBe(DIGEST);
    expect(lines[0]!['ruleId']).toBe('');
    await h.close();
  });

  it('accepts a post intent, whose sealed body digest is recorded and never sent to the chain', async () => {
    const h = await harness();
    expect((await h.purse.handle({ intent: postIntentFor() })).ok).toBe(true);

    const lines = await auditLines(h.auditPath);
    expect(lines[0]!['intentKind']).toBe('post');
    expect(lines[0]!['intentHash']).toBe(intentHash(postIntentFor()));
    await h.close();
  });

  it('counts the spend, so the ceiling is a rolling window and not a per-transaction check', async () => {
    const h = await harness();
    await h.purse.handle({ intent: priceIntentFor() });
    const spendPath = join(h.auditPath, '..', 'spend.jsonl');
    const recorded = (await readFile(spendPath, 'utf8')).trim().split('\n').map((l) => JSON.parse(l));
    expect(recorded).toHaveLength(1);
    expect(recorded[0].amountOut).toBe('1188000');
    await h.close();
  });
});

describe('the policy gate', () => {
  it('refuses a transfer to a recipient outside the set, with the rule id', async () => {
    const h = await harness({
      policy: { allowedCommandKinds: ['MoveCall', 'TransferObjects'] },
      response: { transferToStranger: true },
    });
    const response = await h.purse.handle({ intent: priceIntentFor() });

    expect(response.ok).toBe(false);
    if (response.ok) throw new Error('unreachable');
    expect(response.refused.ruleId).toBe('transfer-recipient');
    expect(response.refused.reason).toContain(STRANGER);
    await h.close();
  });

  it('refuses an intent naming a vault outside the allowed objects, with the rule id', async () => {
    const h = await harness({ policy: { allowedObjects: [] } });
    const response = await h.purse.handle({ intent: priceIntentFor() });

    expect(response.ok).toBe(false);
    if (response.ok) throw new Error('unreachable');
    expect(response.refused.ruleId).toBe('object-input');
    expect(response.refused.reason).toContain(VAULT_ID);
    await h.close();
  });

  it('refuses a transaction over the outflow ceiling, with the rule id', async () => {
    const h = await harness({ response: { agentAmount: '-20000000' } });
    const response = await h.purse.handle({ intent: priceIntentFor() });

    expect(response.ok).toBe(false);
    if (response.ok) throw new Error('unreachable');
    expect(response.refused.ruleId).toBe('outflow-ceiling');
    expect(response.refused.reason).toContain('10000000');
    await h.close();
  });

  it('refuses a gas budget over the policy maximum, with the rule id', async () => {
    const h = await harness({ response: { gasBudget: '900000000' } });
    const response = await h.purse.handle({ intent: priceIntentFor() });

    expect(response.ok).toBe(false);
    if (response.ok) throw new Error('unreachable');
    expect(response.refused.ruleId).toBe('gas-budget');
    await h.close();
  });

  it('refuses a target the policy does not name, with the rule id', async () => {
    const h = await harness({ policy: { allowedTargets: [] } });
    const response = await h.purse.handle({ intent: priceIntentFor() });

    expect(response.ok).toBe(false);
    if (response.ok) throw new Error('unreachable');
    expect(response.refused.ruleId).toBe('move-call-target');
    await h.close();
  });

  it('records every refusal in the chain, so a run of denials is visible', async () => {
    const h = await harness({ policy: { allowedObjects: [] } });
    await h.purse.handle({ intent: priceIntentFor() });
    await h.purse.handle({ intent: priceIntentFor() });

    const lines = await auditLines(h.auditPath);
    expect(lines).toHaveLength(2);
    expect(lines.every((line) => line['outcome'] === 'refused')).toBe(true);
    expect(lines.every((line) => line['ruleId'] === 'object-input')).toBe(true);
    expect(lines[1]!['prevHash']).toBe(lines[0]!['hash']);
    await h.close();
  });

  it('spends nothing on a refusal', async () => {
    const h = await harness({ policy: { allowedObjects: [] } });
    await h.purse.handle({ intent: priceIntentFor() });
    const spendPath = join(h.auditPath, '..', 'spend.jsonl');
    expect((await readFile(spendPath, 'utf8')).trim()).toBe('');
    await h.close();
  });
});

describe('a request the purse does not answer', () => {
  it('refuses a malformed request, as a value, and chains a line for it', async () => {
    const h = await harness();
    const bad: unknown[] = [undefined, null, 42, 'sign this', { bytes: 'AAAA' }, { intent: {}, extra: 1 }];
    for (const request of bad) {
      const response = await h.purse.handle(request);
      expect(response.ok).toBe(false);
      if (response.ok) throw new Error('unreachable');
      expect(['request-malformed', 'intent-invalid']).toContain(response.refused.ruleId);
    }
    expect(await auditLines(h.auditPath)).toHaveLength(bad.length);
    await h.close();
  });

  it('has no buy, no subscribe and no transfer — those are refused by the schema, not by policy', async () => {
    const h = await harness();
    for (const kind of ['buy', 'subscribe', 'transfer', 'unlock', 'claim_earnings']) {
      const response = await h.purse.handle({ intent: { kind, to: STRANGER, amount: '1' } });
      expect(response.ok).toBe(false);
      if (response.ok) throw new Error('unreachable');
      expect(response.refused.ruleId).toBe('intent-invalid');
    }
    await h.close();
  });
});

describe('the key never leaves', () => {
  it('appears in no response, no log line and no audit line', async () => {
    const h = await harness();
    const captured: string[] = [];

    captured.push(JSON.stringify(await h.purse.handle({ intent: priceIntentFor() })));
    captured.push(JSON.stringify(await h.purse.handle({ intent: { kind: 'buy' } })));
    captured.push(JSON.stringify(await h.purse.handle('not json at all')));
    captured.push(...h.logged);
    captured.push(await readFile(h.auditPath, 'utf8'));

    const prefix = 'suipriv' + 'key1';
    for (const text of captured) expect(text).not.toContain(prefix);
    await h.close();
  });
});

describe('two requests that overlap', () => {
  it('judges the second against the ledger the first has already written', async () => {
    const h = await harness({ response: { agentAmount: '-6000000' } });

    const [first, second] = await Promise.all([
      h.purse.handle({ intent: priceIntentFor() }),
      h.purse.handle({ intent: priceIntentFor() }),
    ]);

    const signed = [first, second].filter((response) => response.ok);
    const refused = [first, second].filter((response) => !response.ok);
    expect(signed).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(refused[0]!.ok).toBe(false);
    if (refused[0]!.ok) throw new Error('unreachable');
    expect(refused[0]!.refused.ruleId).toBe('outflow-ceiling');
    await h.close();
  });

  it('records one spend line and two audit lines, in one unbroken chain', async () => {
    const h = await harness({ response: { agentAmount: '-6000000' } });
    await Promise.all([
      h.purse.handle({ intent: priceIntentFor() }),
      h.purse.handle({ intent: priceIntentFor() }),
    ]);

    const lines = await auditLines(h.auditPath);
    expect(lines).toHaveLength(2);
    expect(lines.map((line) => line['outcome']).sort()).toEqual(['refused', 'signed']);
    expect(lines[1]!['prevHash']).toBe(lines[0]!['hash']);

    const spendPath = join(h.auditPath, '..', 'spend.jsonl');
    const recorded = (await readFile(spendPath, 'utf8')).trim().split('\n').filter((l) => l !== '');
    expect(recorded).toHaveLength(1);
    await h.close();
  });
});
