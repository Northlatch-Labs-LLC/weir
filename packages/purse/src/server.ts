// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/**
 * `heron-purse` — the process. One socket, one call, one key.
 *
 * Run it with `tsx src/server.ts --socket … --policy … --policy-sha256 … --chain … --audit …`.
 *
 * # The order of the checks at start is the design
 *
 *  1. Refuse if a key is in the environment or in argv. **Before anything else**, because a process
 *     started wrongly must die at its first instruction rather than after it has created a socket
 *     other things can connect to.
 *  2. Load the policy and check its pin. A purse whose policy does not match what the unit pinned
 *     never holds a key.
 *  3. Load the key.
 *  4. Open the audit chain and the spend ledger. A broken chain refuses to start; see
 *     `audit-file.ts` for why appending past a break is worse than stopping.
 *  5. Only then bind the socket, and only then tell systemd it is ready.
 *
 * # `Type=notify`
 *
 * The unit is `Type=notify` so `heron-beat.service`'s `After=` actually means the socket exists.
 * `Type=simple` would have systemd consider the purse started the instant it forked, and the first
 * beat after a reboot would race the bind and fail with `ENOENT` on a socket that appears a second
 * later. The notification is one datagram on `$NOTIFY_SOCKET`, which is the whole of the protocol
 * this needs; there is no library dependency for it.
 *
 * # What is never logged
 *
 * The key, obviously. Also: the intent's contents, and the value of anything that failed to parse.
 * The log lines are `purse: <kind> <outcome> <rule|digest> seq=<n>` and the startup line, which
 * carries the address, the two policy hashes and the socket path. An audit line has the reason in
 * full; the journal does not, because the journal goes places the audit file does not.
 */

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
}

const FLAGS = ['--socket', '--policy', '--policy-sha256', '--chain', '--audit', '--spend', '--key-file'] as const;

/**
 * Parse argv.
 *
 * Written out rather than taken from a parser library for one reason: an unknown flag is a
 * refusal. A parser that ignores what it does not recognise turns `--policy-sha-256` (a typo) into
 * a purse running with no pin, and the typo is invisible in the unit file.
 */
export function parseServerArgs(argv: readonly string[]): Outcome<ServerArgs> {
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]!;
    if (!FLAGS.includes(flag as (typeof FLAGS)[number])) {
      return refuse(
        'request-malformed',
        `${flag} is not a flag heron-purse takes. It takes exactly: ${FLAGS.join(' ')}. An ` +
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
  return allow({
    socket: values.get('--socket')!,
    policy: values.get('--policy')!,
    policySha256: values.get('--policy-sha256')!,
    chain: values.get('--chain')!,
    audit: values.get('--audit')!,
    spend: values.get('--spend')!,
    ...(keyFile === undefined ? {} : { keyFile }),
  });
}

export interface RunningPurse {
  readonly purse: Purse;
  readonly socketPath: string;
  readonly stop: () => Promise<void>;
}

/**
 * Start the purse and listen.
 *
 * Exported so the socket tests drive the real server rather than a stand-in. A test that exercised
 * a different code path from the unit would prove nothing about the unit.
 */
export async function startPurse(args: {
  readonly server: ServerArgs;
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly log?: ((line: string) => void) | undefined;
  /**
   * Supplied by the socket test with a recorded response and a pinned gas coin, so the whole
   * server — argv, pin, key, socket, framing, purse, audit chain — runs with no network.
   *
   * The same seam `PolicySigner` offers for the same reason, and used the same way: a test that
   * drove a different code path from the unit would prove nothing about the unit. Nothing in the
   * product path passes it; the entry point below does not.
   */
  readonly recorded?:
    | { readonly simulation: SimulationPort; readonly gas: GasPort; readonly client: SuiGrpcClient }
    | undefined;
}): Promise<Outcome<RunningPurse>> {
  const log = args.log ?? ((line: string) => process.stderr.write(`${line}\n`));

  const surface = refuseKeyInProcessSurface({ argv: args.argv, env: args.env });
  if (!surface.ok) return surface;

  const policy = await loadPinnedPolicy({ path: args.server.policy, expectedSha256: args.server.policySha256 });
  if (!policy.ok) return policy;

  const chain = await loadChainConfig(args.server.chain);
  if (!chain.ok) return chain;

  const key = await loadHotKey({
    ...(args.server.keyFile === undefined ? {} : { keyFile: args.server.keyFile }),
    ...(args.env['CREDENTIALS_DIRECTORY'] === undefined
      ? {}
      : { credentialsDirectory: args.env['CREDENTIALS_DIRECTORY'] }),
    argv: args.argv,
    env: args.env,
  });
  if (!key.ok) return key;

  if (key.value.signer.address !== normaliseAddress(policy.value.doc.agentAddress)) {
    return refuse(
      'request-malformed',
      `the key at ${key.value.path} controls ${key.value.signer.address}, and the policy document ` +
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
    signer: key.value.signer,
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
  });

  await mkdir(dirname(args.server.socket), { recursive: true });
  await removeStaleSocket(args.server.socket);

  /*
    `allowHalfOpen: true` is load-bearing and was found by a failing test rather than by reading.

    The client sends its request and calls `end()`, which is a FIN. With node's default
    (`allowHalfOpen: false`) the server's socket answers that FIN by ending its OWN writable side
    immediately — so by the time `purse.handle` has finished simulating and signing, there is
    nothing left to write to, `connection.end(response)` throws ERR_STREAM_WRITE_AFTER_END, and the
    client sees the connection close with no answer. The decision was made and recorded correctly
    and the caller never learned it, which is the worst of the possible failures here: an
    unattended beat would read "no answer" and could not tell it from a purse that was down.

    With half-open allowed, the read side closes and the write side stays open until the answer is
    written. `serve` then closes it itself.
  */
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

  // 0660: the purse's user owns it, the beat's group can speak to it, nobody else can. The socket
  // is the only thing the container is given, and it is given the socket rather than a key.
  await chmod(args.server.socket, 0o660);

  log(
    `heron-purse: listening on ${args.server.socket} for ${purse.address} · policy ${policy.value.policyHash} ` +
      `· file ${policy.value.fileSha256} · audit head ${purse.auditHead()} · key from ${key.value.path}`,
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

/** One connection: read to end-of-input or a newline, answer once, close. */
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
      /*
        Answered without the bytes ever being assembled — and **recorded**, which it was not before
        (Security's A2, 2026-09-05). A peer that streams at the socket without ever sending a
        newline is the probe `audit-file.ts` says the purse keeps its own chain for, and it used to
        be the one refusal that left no line at all.

        `refuseUnread` records on the purse's own queue and answers with a value. The chunks
        collected so far are dropped rather than parsed: reading them is exactly what the cap
        exists to refuse.
      */
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
      // Handed to the purse as `undefined` so that the refusal is produced, logged and **chained**
      // by the one place that records — rather than short-circuited here, which would leave a
      // probe of the socket with no line in the audit file.
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

/**
 * `READY=1` to systemd, if systemd is listening.
 *
 * # Why this shells out instead of sending the datagram itself
 *
 * systemd's notify socket is a **unix datagram** socket. Node's `dgram` module opens UDP sockets
 * only and its `net` module opens stream sockets only; neither can address `AF_UNIX`/`SOCK_DGRAM`,
 * so there is no way to send this datagram from Node without a native addon. `systemd-notify` is
 * part of systemd itself and is on the host by definition — the unit that reads `$NOTIFY_SOCKET`
 * is the same package that ships the binary.
 *
 * The cost is named in the unit: `systemd-notify` is a **child** of this process, not the main
 * process, so the unit must carry `NotifyAccess=all`. That widens who may notify from "the main
 * process" to "anything in this unit's cgroup", and this unit's cgroup holds the purse and its
 * children and nothing else.
 *
 * **Not executed.** This laptop has no systemd. The shape is written from systemd's own
 * documentation for `sd_notify` and `NotifyAccess`; that it works is unverified until step 9 runs a
 * smoke beat on the droplet, and the deploy's assertion there is `systemctl show heron-purse
 * --property=ActiveState` reading `active` rather than `activating`.
 */
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
    process.stderr.write(`heron-purse: ${parsed.refused.ruleId} — ${parsed.refused.reason}\n`);
    process.exit(2);
  }
  const started = await startPurse({
    server: parsed.value,
    argv: process.argv,
    env: process.env,
  });
  if (!started.ok) {
    process.stderr.write(`heron-purse: ${started.refused.ruleId} — ${started.refused.reason}\n`);
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
