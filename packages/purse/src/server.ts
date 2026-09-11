// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { createServer, type Socket } from 'node:net';
import type { SuiGrpcClient } from '@mysten/sui/grpc';
import { spawn } from 'node:child_process';
import { chmod, mkdir, stat, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createClient } from '@projectx-social/sdk';
import type { SimulationPort } from '@projectx-social/signer';
import type { GasPort } from './build.js';
import { AuditFile } from './audit-file.js';
import { loadChainConfig } from './chain.js';
import { loadHotKey, refuseKeyInProcessSurface } from './key.js';
import { loadMultisigDoc, wrapAsMultisig } from './multisig-file.js';
import { SpendLedger } from './ledger-file.js';
import { loadPinnedPolicy } from './policy-file.js';
import { createPurse, type Purse } from './purse.js';
import { MAX_REQUEST_BYTES } from './protocol.js';
import { allow, refuse, type Outcome } from './outcome.js';

export interface ServerArgs {
  readonly socket: string;
  readonly policy: string;
  readonly policySha256: string;
  readonly chain: string;
  readonly audit: string;
  readonly spend: string;
  readonly keyFile?: string | undefined;
  readonly multisig?: string | undefined;
  readonly apiOrigin?: string | undefined;
  readonly statementsPerDay?: number | undefined;
  readonly vault?: string | undefined;
  readonly agent?: string | undefined;
}

export const DEFAULT_AGENT = 'heron';
const AGENT_NAME = /^[a-z][a-z0-9-]{0,31}$/;

const FLAGS = ['--socket', '--policy', '--policy-sha256', '--chain', '--audit', '--spend', '--key-file', '--multisig', '--api-origin', '--statements-per-day', '--vault', '--agent'] as const;

export function parseServerArgs(argv: readonly string[]): Outcome<ServerArgs> {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]!;
    if (!FLAGS.includes(flag as (typeof FLAGS)[number])) {
      return refuse(
        'request-malformed',
        `${flag} is not a flag the purse takes. It takes exactly: ${FLAGS.join(' ')}. An ` +
          `unrecognised flag is refused rather than ignored — a typo in --policy-sha256 would ` +
          `otherwise start a purse with no pin.`,
      );
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      return refuse('request-malformed', `${flag} needs a value.`);
    }
    if (values.has(flag)) return refuse('request-malformed', `${flag} was given twice.`);
    values.set(flag, value);
    i += 1;
  }

  const required = ['--socket', '--policy', '--policy-sha256', '--chain', '--audit', '--spend'];
  for (const flag of required) {
    if (!values.has(flag)) return refuse('request-malformed', `${flag} is required.`);
  }

  const keyFile = values.get('--key-file');
  const multisig = values.get('--multisig');
  const apiOrigin = values.get('--api-origin');
  const perDayText = values.get('--statements-per-day');
  const vault = values.get('--vault');
  const agent = values.get('--agent');
  if (agent !== undefined && !AGENT_NAME.test(agent)) {
    return refuse('request-malformed', '--agent is a name matching ^[a-z][a-z0-9-]{0,31}$; it is interpolated into a credential name and a log prefix.');
  }
  const given = [apiOrigin, perDayText, vault].filter((v) => v !== undefined).length;
  if (given !== 0 && given !== 3) {
    return refuse('request-malformed', '--api-origin, --statements-per-day and --vault are given together or not at all; a subset is a purse that half-signs statements.');
  }
  if (vault !== undefined && !/^0x[0-9a-f]{64}$/.test(vault)) {
    return refuse('request-malformed', '--vault is the full lower-case id of the agent\'s own creator vault.');
  }
  let statementsPerDay: number | undefined;
  if (perDayText !== undefined) {
    if (!/^[1-9][0-9]{0,3}$/.test(perDayText)) return refuse('request-malformed', '--statements-per-day is a positive integer under 10000.');
    statementsPerDay = Number(perDayText);
    if (apiOrigin === undefined || !/^https:\/\/[a-z0-9.-]+$/.test(apiOrigin)) {
      return refuse('request-malformed', '--api-origin is an https origin with no path, such as https://weir.social.');
    }
  }
  return allow({
    socket: values.get('--socket')!,
    policy: values.get('--policy')!,
    policySha256: values.get('--policy-sha256')!,
    chain: values.get('--chain')!,
    audit: values.get('--audit')!,
    spend: values.get('--spend')!,
    ...(keyFile === undefined ? {} : { keyFile }),
    ...(multisig === undefined ? {} : { multisig }),
    ...(apiOrigin === undefined ? {} : { apiOrigin }),
    ...(statementsPerDay === undefined ? {} : { statementsPerDay }),
    ...(vault === undefined ? {} : { vault }),
    ...(agent === undefined ? {} : { agent }),
  });
}

export function credentialNameFor(agent: string | undefined): string {
  return `${agent ?? DEFAULT_AGENT}-hot`;
}

export interface RunningPurse {
  readonly purse: Purse;
  readonly socketPath: string;
  readonly stop: () => Promise<void>;
}

export async function startPurse(args: {
  readonly server: ServerArgs;
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly log?: ((line: string) => void) | undefined;
  readonly recorded?:
    | { readonly simulation: SimulationPort; readonly gas: GasPort; readonly client: SuiGrpcClient }
    | undefined;
}): Promise<Outcome<RunningPurse>> {
  const log = args.log ?? ((line: string) => process.stderr.write(`${line}\n`));

  const credentialName = credentialNameFor(args.server.agent);
  const prefix = `${args.server.agent ?? DEFAULT_AGENT}-purse`;
  const surface = refuseKeyInProcessSurface({ argv: args.argv, env: args.env, credentialName });
  if (!surface.ok) return surface;

  const policy = await loadPinnedPolicy({ path: args.server.policy, expectedSha256: args.server.policySha256 });
  if (!policy.ok) return policy;

  const chain = await loadChainConfig(args.server.chain);
  if (!chain.ok) return chain;

  const key = await loadHotKey({
    credentialName,
    ...(args.server.keyFile === undefined ? {} : { keyFile: args.server.keyFile }),
    ...(args.env['CREDENTIALS_DIRECTORY'] === undefined
      ? {}
      : { credentialsDirectory: args.env['CREDENTIALS_DIRECTORY'] }),
    argv: args.argv,
    env: args.env,
  });
  if (!key.ok) return key;

  let signer = key.value.signer;
  let signerLine = `key from ${key.value.path}`;
  if (args.server.multisig !== undefined) {
    const doc = await loadMultisigDoc(args.server.multisig);
    if (!doc.ok) return doc;
    const wrapped = wrapAsMultisig(doc.value.doc, key.value.signer);
    if (!wrapped.ok) return wrapped;
    signer = wrapped.value.signer;
    signerLine =
      `multisig ${String(wrapped.value.threshold)}-of-${String(wrapped.value.memberCount)} from ` +
      `${doc.value.path} · hot member "${wrapped.value.memberName}" ${key.value.signer.address} · ` +
      `key from ${key.value.path}`;
  }

  if (signer.address !== normaliseAddress(policy.value.doc.agentAddress)) {
    return refuse(
      'request-malformed',
      `the key at ${key.value.path} signs as ${signer.address}` +
        (args.server.multisig === undefined ? '' : ` (the multisig of ${args.server.multisig})`) +
        `, and the policy document ` +
        `is written for ${policy.value.doc.agentAddress}. The purse will not start: a policy ` +
        `evaluated against one address while another signs is a policy that bounds nothing. The ` +
        `\`sender-mismatch\` rule would catch it per transaction; catching it at start means it is ` +
        `caught before a key is held open.`,
    );
  }

  const audit = await AuditFile.open(args.server.audit);
  if (!audit.ok) return refuse('request-malformed', audit.reason);

  const ledger = await SpendLedger.open({ path: args.server.spend, policy: policy.value.doc });
  if (!ledger.ok) {
    await audit.file.close();
    return refuse('request-malformed', ledger.reason);
  }

  const purse = createPurse({
    signer,
    policy: policy.value.doc,
    policyHash: policy.value.policyHash,
    policyFileSha256: policy.value.fileSha256,
    chain: chain.value,
    client: args.recorded?.client ?? createClient(chain.value),
    audit: audit.file,
    ledger: ledger.ledger,
    log,
    ...(args.recorded === undefined
      ? {}
      : { simulation: args.recorded.simulation, gas: args.recorded.gas }),
    ...(args.server.apiOrigin === undefined || args.server.statementsPerDay === undefined || args.server.vault === undefined
      ? {}
      : { statements: { origin: args.server.apiOrigin, perDay: args.server.statementsPerDay, auditPath: args.server.audit, vaultId: args.server.vault } }),
  });

  await mkdir(dirname(args.server.socket), { recursive: true });
  await removeStaleSocket(args.server.socket);

  const server = createServer({ allowHalfOpen: true }, (connection) => {
    void serve(connection, purse);
  });

  const listening = await new Promise<Outcome<null>>((resolve) => {
    server.once('error', (error: Error) =>
      resolve(refuse('request-malformed', `the socket ${args.server.socket} could not be bound: ${error.message}`)),
    );
    server.listen(args.server.socket, () => resolve(allow(null)));
  });
  if (!listening.ok) {
    await audit.file.close();
    await ledger.ledger.close();
    return listening;
  }

  await chmod(args.server.socket, 0o660);

  log(
    `${prefix}: listening on ${args.server.socket} for ${purse.address} · policy ${policy.value.policyHash} ` +
      `· file ${policy.value.fileSha256} · audit head ${purse.auditHead()} · ${signerLine}` +
      (args.server.apiOrigin === undefined ? ' · statements off' : ` · statements for ${args.server.apiOrigin}, ${String(args.server.statementsPerDay)} a day, vault ${args.server.vault ?? ''}`),
  );
  notifyReady(args.env['NOTIFY_SOCKET']);

  return allow({
    purse,
    socketPath: args.server.socket,
    stop: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await audit.file.close();
      await ledger.ledger.close();
      await removeStaleSocket(args.server.socket);
    },
  });
}

async function serve(connection: Socket, purse: Purse): Promise<void> {
  connection.setTimeout(30_000);
  const chunks: Buffer[] = [];
  let received = 0;
  let answered = false;

  const answer = async (request: unknown): Promise<void> => {
    if (answered) return;
    answered = true;
    const response = await purse.handle(request);
    connection.end(`${JSON.stringify(response)}\n`);
  };

  connection.on('error', () => connection.destroy());
  connection.on('timeout', () => connection.destroy());

  connection.on('data', (chunk: Buffer) => {
    if (answered) return;
    received += chunk.byteLength;
    if (received > MAX_REQUEST_BYTES) {
      answered = true;
      chunks.length = 0;
      void purse
        .refuseUnread({
          ruleId: 'request-too-large',
          reason:
            `a request may be at most ${String(MAX_REQUEST_BYTES)} bytes and this connection sent ` +
            `more. Nothing was read, parsed or built. The cap is here because the socket's peer is ` +
            `the beat and the beat's input came from a model: a peer that streams without ever ` +
            `sending a newline is a memory exhaustion on a 512 MB droplet that also has to hold ` +
            `the Docker daemon.`,
        })
        .then((response) => connection.end(`${JSON.stringify(response)}\n`))
        .catch(() => connection.destroy());
      return;
    }
    chunks.push(chunk);
    if (chunk.includes(0x0a)) void handle();
  });

  connection.on('end', () => void handle());

  async function handle(): Promise<void> {
    if (answered) return;
    const text = Buffer.concat(chunks).toString('utf8').trim();
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      value = undefined;
    }
    await answer(value);
  }
}

async function removeStaleSocket(path: string): Promise<void> {
  try {
    const info = await stat(path);
    if (info.isSocket()) await unlink(path);
  } catch {
    // Nothing there. `listen` will say so if it is something else.
  }
}

function normaliseAddress(address: string): string {
  const trimmed = address.trim();
  if (!/^0x[0-9a-fA-F]{1,64}$/.test(trimmed)) return trimmed;
  return `0x${trimmed.slice(2).toLowerCase().padStart(64, '0')}`;
}

function notifyReady(notifySocket: string | undefined): void {
  if (notifySocket === undefined || notifySocket === '') return;
  try {
    const child = spawn('systemd-notify', ['--ready'], { stdio: 'ignore', detached: false });
    child.on('error', () => {
      // Not being able to tell systemd is not a reason to refuse to serve. The unit's
      // TimeoutStartSec reports it, loudly, and the socket is already bound and answering.
    });
  } catch {
    // Same.
  }
}

/* c8 ignore start — the process entry point; the tests drive `startPurse` directly. */
if (import.meta.url === `file://${process.argv[1] ?? ''}`) {
  const parsed = parseServerArgs(process.argv.slice(2));
  if (!parsed.ok) {
    process.stderr.write(`${DEFAULT_AGENT}-purse: ${parsed.refused.ruleId} — ${parsed.refused.reason}\n`);
    process.exit(2);
  }
  const started = await startPurse({
    server: parsed.value,
    argv: process.argv,
    env: process.env,
  });
  if (!started.ok) {
    process.stderr.write(`${parsed.value.agent ?? DEFAULT_AGENT}-purse: ${started.refused.ruleId} — ${started.refused.reason}\n`);
    process.exit(2);
  }
  const running = started.value;
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      void running.stop().then(() => process.exit(0));
    });
  }
}
/* c8 ignore stop */
