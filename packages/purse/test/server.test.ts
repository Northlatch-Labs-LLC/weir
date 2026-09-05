// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/**
 * The real server, over a real unix socket, with a throwaway key and no network.
 *
 * `purse.test.ts` proves the decision. This file proves the process around it: the order of the
 * checks at start, the socket's mode, the framing, and that a request over the wire produces the
 * same value a direct call does.
 */

import { describe, expect, it } from 'vitest';
import { chmod, readFile, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { connect } from 'node:net';
import { join } from 'node:path';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { fixedGas } from '../src/build.js';
import { askPurse } from '../src/client.js';
import { MAX_REQUEST_BYTES } from '../src/protocol.js';
import { parseServerArgs, startPurse, type RunningPurse } from '../src/server.js';
import {
  CHAIN,
  DIGEST,
  GAS_COIN_ID,
  policyFor,
  priceIntentFor,
  setPriceResponse,
  stubClient,
  stubPort,
  temporaryDirectory,
} from './helpers.js';

const GAS = fixedGas({
  price: 1000n,
  payment: [{ objectId: GAS_COIN_ID, version: '1', digest: '11111111111111111111111111111111' }],
});

interface Started {
  readonly running: RunningPurse;
  readonly socketPath: string;
  readonly auditPath: string;
  readonly logged: readonly string[];
}

async function laid(
  overrides: { readonly pin?: string; readonly env?: Record<string, string | undefined> } = {},
): Promise<{ start: () => ReturnType<typeof startPurse>; socketPath: string; auditPath: string; logged: string[] }> {
  const dir = await temporaryDirectory();
  const keypair = Ed25519Keypair.generate();
  const address = keypair.toSuiAddress();

  const keyPath = join(dir, 'heron-hot');
  await writeFile(keyPath, `${keypair.getSecretKey()}\n`, { mode: 0o600 });
  await chmod(keyPath, 0o600);

  const policyPath = join(dir, 'heron-policy.json');
  const policyText = `${JSON.stringify(policyFor(address), null, 2)}\n`;
  await writeFile(policyPath, policyText, 'utf8');
  const policySha = createHash('sha256').update(policyText, 'utf8').digest('hex');

  const chainPath = join(dir, 'chain.json');
  await writeFile(chainPath, JSON.stringify(CHAIN), 'utf8');

  const socketPath = join(dir, 'purse.sock');
  const auditPath = join(dir, 'audit.jsonl');
  const logged: string[] = [];
  const response = setPriceResponse(address);

  return {
    socketPath,
    auditPath,
    logged,
    start: () =>
      startPurse({
        server: {
          socket: socketPath,
          policy: policyPath,
          policySha256: overrides.pin ?? policySha,
          chain: chainPath,
          audit: auditPath,
          spend: join(dir, 'spend.jsonl'),
          keyFile: keyPath,
        },
        argv: ['node', 'server.js'],
        env: overrides.env ?? {},
        log: (line) => logged.push(line),
        recorded: { simulation: stubPort(response, address), gas: GAS, client: stubClient(response) },
      }),
  };
}

async function started(): Promise<Started> {
  const laidOut = await laid();
  const outcome = await laidOut.start();
  if (!outcome.ok) throw new Error(outcome.refused.reason);
  return {
    running: outcome.value,
    socketPath: laidOut.socketPath,
    auditPath: laidOut.auditPath,
    logged: laidOut.logged,
  };
}

describe('starting', () => {
  it('binds the socket at 0660 and reports the address and both policy hashes', async () => {
    const s = await started();
    const info = await stat(s.socketPath);
    expect(info.isSocket()).toBe(true);
    expect((info.mode & 0o777).toString(8)).toBe('660');
    expect(s.logged[0]).toContain('listening on');
    expect(s.logged[0]).toContain(s.running.purse.address);
    await s.running.stop();
  });

  it('refuses to start when the policy file does not match the pin — and binds nothing', async () => {
    const laidOut = await laid({ pin: '0'.repeat(64) });
    const outcome = await laidOut.start();

    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    expect(outcome.refused.reason).toContain('redeploy, not a reload');
    await expect(stat(laidOut.socketPath)).rejects.toThrow();
  });

  it('refuses to start when a key is in the environment — before the policy is even read', async () => {
    const prefix = 'suipriv' + 'key1';
    const laidOut = await laid({ pin: '0'.repeat(64), env: { ANYTHING: `${prefix}qq…` } });
    const outcome = await laidOut.start();

    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    // The environment complaint, not the pin complaint: the surface check runs first, so a process
    // started wrongly dies at its first instruction rather than after creating a socket.
    expect(outcome.refused.reason).toContain('ANYTHING');
    await expect(stat(laidOut.socketPath)).rejects.toThrow();
  });
});

describe('over the socket', () => {
  it('signs a permitted intent and answers one JSON line', async () => {
    const s = await started();
    const answered = await askPurse({ socketPath: s.socketPath, intent: priceIntentFor() });

    if (!answered.ok) throw new Error(`${answered.refused.ruleId}: ${answered.refused.reason}`);
    expect(answered.value.ok).toBe(true);
    if (!answered.value.ok) throw new Error('unreachable');
    expect(answered.value.digest).toBe(DIGEST);
    expect(answered.value.txBytesB64.length).toBeGreaterThan(0);
    await s.running.stop();
  });

  it('refuses an intent kind it does not have, as a value on the wire', async () => {
    const s = await started();
    const answered = await askPurse({ socketPath: s.socketPath, intent: { kind: 'buy', amount: '1' } });

    if (!answered.ok) throw new Error(`${answered.refused.ruleId}: ${answered.refused.reason}`);
    expect(answered.value.ok).toBe(false);
    if (answered.value.ok) throw new Error('unreachable');
    expect(answered.value.refused.ruleId).toBe('intent-invalid');
    await s.running.stop();
  });

  it('chains a line for a probe that was not even JSON', async () => {
    const s = await started();
    await new Promise<void>((resolve) => {
      const socket = connect(s.socketPath, () => socket.end('give me the key\n'));
      // The `data` listener is not decoration: a socket with no consumer stays paused, never reads
      // the answer, and therefore never sees the FIN behind it — so `close` never fires and this
      // test hangs rather than failing. Attaching it is what puts the socket into flowing mode.
      socket.on('data', () => undefined);
      socket.on('close', () => resolve());
      socket.on('error', () => resolve());
    });

    const lines = (await readFile(s.auditPath, 'utf8')).trim().split('\n').filter((l) => l !== '');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!).ruleId).toBe('request-malformed');
    await s.running.stop();
  });

  /*
    A2 from Security's review of 2026-09-05.

    `serve` answered an oversize request itself and never called the purse, so the one probe most
    likely to be somebody feeling out the socket left no line at all — in the file `audit-file.ts`
    says the purse keeps its own chain for.
  */
  it('chains a refused line for a request over the size limit', async () => {
    const s = await started();
    const oversize = `{"intent":"${'x'.repeat(MAX_REQUEST_BYTES + 1024)}"}\n`;

    const answer = await new Promise<string>((resolve) => {
      const socket = connect(s.socketPath, () => socket.write(oversize));
      let received = '';
      socket.on('data', (chunk: Buffer) => {
        received += chunk.toString('utf8');
      });
      socket.on('close', () => resolve(received));
      socket.on('error', () => resolve(received));
    });

    expect(answer).toContain('request-too-large');

    const lines = (await readFile(s.auditPath, 'utf8')).trim().split('\n').filter((l) => l !== '');
    expect(lines).toHaveLength(1);
    const line = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(line['outcome']).toBe('refused');
    expect(line['ruleId']).toBe('request-too-large');
    expect(line['intentKind']).toBe('unread');
    await s.running.stop();
  });

  it('reports a socket that is not there as a no-answer, never as a refusal', async () => {
    const answered = await askPurse({ socketPath: '/tmp/heron-purse-not-here.sock', intent: priceIntentFor() });
    expect(answered.ok).toBe(false);
    if (answered.ok) throw new Error('unreachable');
    expect(answered.refused.ruleId).toBe('purse-unreachable');
  });
});

describe('the arguments', () => {
  it('refuses an unrecognised flag rather than ignoring it', () => {
    const parsed = parseServerArgs(['--socket', '/x', '--policy-sha-256', 'abc']);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error('unreachable');
    expect(parsed.refused.reason).toContain('--policy-sha-256');
  });

  it('requires the pin', () => {
    const parsed = parseServerArgs([
      '--socket', '/x', '--policy', '/p', '--chain', '/c', '--audit', '/a', '--spend', '/s',
    ]);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) throw new Error('unreachable');
    expect(parsed.refused.reason).toContain('--policy-sha256');
  });

  it('takes the full set', () => {
    const parsed = parseServerArgs([
      '--socket', '/run/heron/purse.sock',
      '--policy', '/srv/heron/policy/heron-policy.json',
      '--policy-sha256', 'a'.repeat(64),
      '--chain', '/srv/heron/chain.json',
      '--audit', '/var/lib/heron/audit/audit.jsonl',
      '--spend', '/var/lib/heron/audit/spend.jsonl',
    ]);
    expect(parsed.ok).toBe(true);
  });
});
