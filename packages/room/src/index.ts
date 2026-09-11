// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

export * from './room.js';
export * from './transcript.js';
export * from './publish.js';

import { pathToFileURL } from 'node:url';
import { type Reading, fail, ok } from '@projectx-social/sdk';
import {
  type AgentSeatPort,
  type CipherPort,
  type ClockPort,
  type Deliberation,
  type DirectMessagePlan,
  type DirectoryPort,
  type RoomDefinition,
  deliberate,
  messageCount,
  resolveCast,
  validateRoom,
} from './room.js';
import { type Record as SoldRecord, type RecordPolicy, buildRecord } from './transcript.js';
import { type PublishPlan, describeCadence, planPublish, publishRequestBody } from './publish.js';

declare const commitBrand: unique symbol;

export interface Commit {
  readonly [commitBrand]: true;
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly reason: string;
}

export const COMMIT_FLAG = '--commit';

export const COMMIT_ENV = 'WEIR_ROOM_COMMIT';
export const COMMIT_ENV_VALUE = 'i-have-read-the-plan';

export function commitFrom(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): Commit | null {
  if (!argv.includes(COMMIT_FLAG)) return null;
  if (env[COMMIT_ENV] !== COMMIT_ENV_VALUE) return null;
  return {
    argv: [...argv],
    env: { ...env },
    reason: `${COMMIT_FLAG} with ${COMMIT_ENV}=${COMMIT_ENV_VALUE}`,
  } as unknown as Commit;
}

export interface SignerPort {
  sign(input: { address: string; statement: string }): Promise<string>;
}

export interface HttpPort {
  post(input: { url: string; body: unknown }): Promise<{ status: number; text: string }>;
}

export interface Printer {
  line(text: string): void;
}

export interface Receipt {
  what: string;
  sent: boolean;
  detail: string;
}

export interface RoomEffects {
  readonly mode: 'dry-run' | 'live';
  deliverMessage(plan: DirectMessagePlan): Promise<Receipt>;
  publishRecord(plan: PublishPlan): Promise<Receipt>;
}

export function dryRunEffects(printer: Printer): RoomEffects {
  return {
    mode: 'dry-run',
    async deliverMessage(plan) {
      printer.line(
        `  would send  ${plan.utteranceRef}  ${plan.from} → ${plan.to}  ` +
          `${plan.plaintextChars} chars plaintext / ${plan.ciphertextChars} chars ciphertext  ` +
          `sha256 ${plan.ciphertextSha256}`,
      );
      printer.line(`    POST ${plan.endpoint}`);
      printer.line(`    envelopes: ${plan.envelopeRecipients.join(', ')}`);
      printer.line(`    statement to sign (unsigned):`);
      for (const line of plan.statement.split('\n')) printer.line(`      | ${line}`);
      return { what: plan.utteranceRef, sent: false, detail: 'dry run: nothing was sent' };
    },
    async publishRecord(plan) {
      printer.line(`  would publish  "${plan.title}"  as ${plan.handle}  access ${plan.access}`);
      printer.line(`    POST ${plan.endpoint}`);
      printer.line(`    preview (public, plaintext, indexed for search):`);
      for (const line of plan.preview.split('\n')) printer.line(`      | ${line}`);
      printer.line(
        `    body (withheld from this printout): ${plan.bodyChars} chars / ${plan.bodyBytes} UTF-8 bytes`,
      );
      printer.line(`    content-sha256 ${plan.contentSha256}`);
      printer.line(`    seal identity  ${plan.seal.identityHex}`);
      printer.line(
        `    period ${plan.seal.period} · vault ${plan.seal.vaultId} · tier ${plan.seal.tier} · ` +
          `${plan.seal.periodStartMs}–${plan.seal.periodEndMs} · ${plan.seal.remainingMs} ms left`,
      );
      printer.line(`    request keys: ${Object.keys(publishRequestBody(plan)).join(', ')}`);
      printer.line(`    statement to sign (unsigned):`);
      for (const line of plan.statement.split('\n')) printer.line(`      | ${line}`);
      return { what: plan.title, sent: false, detail: 'dry run: nothing was published' };
    },
  };
}

export function liveEffects(
  commit: Commit,
  ports: { signer: SignerPort; http: HttpPort },
): RoomEffects {
  if (commitFrom(commit.argv ?? [], commit.env ?? {}) === null) {
    throw new Error(
      'liveEffects was given a commit token that does not re-validate. A live run requires ' +
        `${COMMIT_FLAG} on the command line and ${COMMIT_ENV}=${COMMIT_ENV_VALUE} in the ` +
        'environment of the same invocation.',
    );
  }

  return {
    mode: 'live',
    async deliverMessage(plan) {
      const signature = await ports.signer.sign({ address: plan.from, statement: plan.statement });
      const response = await ports.http.post({
        url: plan.endpoint,
        body: {
          from: plan.from,
          to: plan.to,
          signature,
          timestampMs: plan.issuedAtMs,
          encryption: plan.encryption,
        },
      });
      const sent = response.status >= 200 && response.status < 300;
      return {
        what: plan.utteranceRef,
        sent,
        detail: `${response.status} ${response.text}`,
      };
    },
    async publishRecord(plan) {
      const signature = await ports.signer.sign({ address: plan.author, statement: plan.statement });
      const response = await ports.http.post({
        url: plan.endpoint,
        body: { ...publishRequestBody(plan), signature, timestampMs: plan.issuedAtMs },
      });
      const sent = response.status >= 200 && response.status < 300;
      return { what: plan.title, sent, detail: `${response.status} ${response.text}` };
    },
  };
}

export interface RoomPorts {
  agent: AgentSeatPort;
  cipher: CipherPort;
  directory: DirectoryPort;
  clock: ClockPort;
  printer: Printer;
  origin: string;
}

export interface RoomRun {
  mode: 'dry-run' | 'live';
  deliberation: Deliberation;
  record: SoldRecord;
  publish: PublishPlan;
  receipts: readonly Receipt[];
}

export async function runRoom(
  room: RoomDefinition,
  ports: RoomPorts,
  policy: RecordPolicy,
  effects: RoomEffects = dryRunEffects(ports.printer),
): Promise<Reading<RoomRun>> {
  const { printer } = ports;
  const source = `room ${room.id}`;

  const shape = validateRoom(room);
  if (!shape.ok) return shape;

  const resolved = await resolveCast(room, ports.directory);
  if (!resolved.ok) return resolved;
  for (const address of resolved.value.rotated) {
    printer.line(
      `note: ${address} has rotated its X25519 key since this room was configured. The registry's ` +
        'key is being used; the configured one is stale and should be updated.',
    );
  }
  const live = resolved.value.room;

  const cadence = describeCadence(live);
  printer.line(`room ${live.id} · ${live.cast.length} seats · ${live.rounds} rounds`);
  printer.line(`custody: ${live.custody}${custodyNote(live)}`);
  printer.line(
    `messages this session: ${messageCount(live)} ` +
      `(${live.rounds} rounds × ${live.cast.length} × ${live.cast.length - 1}, pairwise — a Weir ` +
      'direct message has exactly two participants)',
  );
  printer.line(
    `cadence: one session every ${cadence.everyMs} ms · a 30-day seal period holds ` +
      `${cadence.recordsPerPeriod} of them (remainder ${cadence.remainderMs} ms)`,
  );

  const deliberation = await deliberate({
    room: live,
    agent: ports.agent,
    cipher: ports.cipher,
    clock: ports.clock,
    origin: ports.origin,
  });
  if (!deliberation.ok) return deliberation;

  const record = buildRecord(deliberation.value, policy);
  if (!record.ok) return record;

  const publish = planPublish({
    room: live,
    record: record.value,
    origin: ports.origin,
    issuedAtMs: ports.clock.nowMs(),
  });
  if (!publish.ok) return publish;

  printer.line('');
  printer.line(`--- ${effects.mode} ---`);

  const receipts: Receipt[] = [];
  for (const plan of deliberation.value.messages) {
    const receipt = await effects.deliverMessage(plan);
    receipts.push(receipt);
    if (effects.mode === 'live' && !receipt.sent) {
      return fail(
        'transport',
        source,
        `delivery of ${receipt.what} failed (${receipt.detail}). The record is NOT published: ` +
          `${receipts.filter((r) => r.sent).length} of ${deliberation.value.messages.length} ` +
          'messages were delivered, so part of the cast never heard what the transcript says they did.',
      );
    }
  }

  receipts.push(await effects.publishRecord(publish.value));

  return ok({
    mode: effects.mode,
    deliberation: deliberation.value,
    record: record.value,
    publish: publish.value,
    receipts,
  });
}

function custodyNote(room: RoomDefinition): string {
  return room.custody === 'independent'
    ? ' — each seat is driven by a separate operator holding only its own key, so no single party ' +
        'holds the whole deliberation. Weir holds ciphertext and cannot read it.'
    : ' — one operator holds every seat key, so the deliberation is private FROM WEIR and from ' +
        'anyone who obtains the database, and NOT from the operator. Do not claim otherwise.';
}

const AGENT_PACKAGE = '@projectx-social/agent';

export async function loadAgentSeatPort(): Promise<Reading<AgentSeatPort>> {
  const source = AGENT_PACKAGE;
  let mod: unknown;
  try {
    mod = await import(AGENT_PACKAGE);
  } catch (error) {
    return fail(
      'unconfigured',
      source,
      `${AGENT_PACKAGE} is not installed or failed to load: ${
        error instanceof Error ? error.message : String(error)
      }. Pass an AgentSeatPort explicitly to run without it.`,
    );
  }

  const candidate = mod as { speak?: unknown; createAgentSeat?: unknown; default?: unknown };
  if (typeof candidate.speak === 'function') return ok(candidate as AgentSeatPort);

  if (typeof candidate.createAgentSeat === 'function') {
    const made = (candidate.createAgentSeat as () => unknown)();
    if (made !== null && typeof made === 'object' && typeof (made as AgentSeatPort).speak === 'function') {
      return ok(made as AgentSeatPort);
    }
  }

  return fail(
    'malformed',
    source,
    `${AGENT_PACKAGE} loaded but exposes no seat: expected an exported \`speak\`, or a ` +
      `\`createAgentSeat()\` returning one. It exports: ${Object.keys(mod as object).join(', ')}`,
  );
}

export interface Options {
  commit: Commit | null;
}

export function parseArgs(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): Options {
  return { commit: commitFrom(argv, env) };
}

export async function main(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
  printer: Printer = { line: (text) => console.log(text) },
): Promise<number> {
  const options = parseArgs(argv, env);
  printer.line('weir room — the arena');
  printer.line('');
  printer.line(`mode: ${options.commit === null ? 'dry-run (default)' : 'LIVE — armed'}`);
  if (options.commit === null) {
    printer.line(
      `  nothing can be sent. A live run needs ${COMMIT_FLAG} and ` +
        `${COMMIT_ENV}=${COMMIT_ENV_VALUE} in the same invocation.`,
    );
  } else {
    printer.line(`  armed by ${options.commit.reason}`);
  }
  printer.line('');
  printer.line('No room is configured, and this package will not invent one. A room needs a cast,');
  printer.line('a cadence, a vault, a tier and a price; those are product decisions, and the');
  printer.line('README lists every one of them. Call runRoom() with your ports to run a session.');

  const agent = await loadAgentSeatPort();
  printer.line('');
  printer.line(
    agent.ok
      ? `agent package: ${AGENT_PACKAGE} is present and exposes a seat`
      : `agent package: ${agent.failure.detail}`,
  );

  return 0;
}

const invokedDirectly =
  typeof process !== 'undefined' &&
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const code = await main(process.argv.slice(2), process.env);
  process.exit(code);
}
