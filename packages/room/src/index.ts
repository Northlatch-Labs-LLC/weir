// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/**
 * The room service: wiring, the dry run, and the one door that spends.
 *
 * # Dry run is the default, and it is structural rather than a flag check
 *
 * The daemon in `packages/daemon` has `--dry-run` as an opt-in, which is right for a process whose
 * only action is a permissionless harvest into somebody else's vault. This service is the opposite
 * shape: it writes to a public feed under a creator's handle and sends messages signed by keys it
 * holds. So the polarity is inverted — **doing nothing is the default and acting requires a flag**
 * — and it is worth saying why the inversion is not enough on its own.
 *
 * A flag check is one `if`. Somebody adds a code path that forgets it, or a test harness passes a
 * config object that looks armed, and the guard is gone. So the safety here is three things, and
 * only the first is a flag:
 *
 *  1. **The deciding code cannot act.** `deliberate` in `room.ts` and `planPublish` in `publish.ts`
 *     take no courier and no signer. There is no argument to pass one in. Whatever they are called
 *     with, they return plans.
 *  2. **Acting requires a token that only argv can mint.** {@link liveEffects} demands a
 *     {@link Commit}, and {@link commitFrom} returns one only for an argv carrying `--commit`. The
 *     type is branded, so an object literal will not satisfy it without a deliberate cast.
 *  3. **The token is re-checked where it is spent.** `liveEffects` re-runs `commitFrom` over the
 *     argv the token recorded. A cast-forged token carries an argv that does not say `--commit`, so
 *     it fails at the door rather than at the type checker it went around.
 *
 * And the default parameter of {@link runRoom} is a dry run, so a caller who passes nothing gets
 * the safe thing rather than an error that tempts them to pass the unsafe thing.
 *
 * # What a dry run does do, stated so nobody is surprised by a bill
 *
 * It reads the chain (free), **drives the agents for real** (which spends the operator's inference
 * budget, whatever that costs them), and encrypts locally (free). A run that skipped the agents
 * would print a plan about nothing.
 *
 * It does not sign, does not POST, does not build or send a transaction, and spends no gas and no
 * WAL. In particular it does not mint a send signature: those are single-use bearer artefacts good
 * for ten minutes, and creating one for a message the operator has just decided not to send would
 * leave a live authorisation lying in a terminal.
 *
 * # What the printer will not print
 *
 * Utterance text, record bodies, signatures, and private keys. The plaintext of the deliberation is
 * the thing the whole architecture exists to keep, and the body is the thing being sold. Sizes,
 * digests, addresses and the statements-to-be-signed are printed in full, because those are what an
 * operator has to check.
 */

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

// ---------------------------------------------------------------------------------------------
// The commit token
// ---------------------------------------------------------------------------------------------

declare const commitBrand: unique symbol;

/**
 * Proof that a human typed `--commit` on this invocation.
 *
 * Branded with a `unique symbol` that is `declare`d and never produced, so the only way to obtain
 * one is {@link commitFrom}. A structural type would be satisfiable by any object with the right
 * fields, which is a guard that stops nothing — the whole risk here is a caller who assembles a
 * plausible-looking config.
 *
 * `argv` and `env` are kept on the token so the check can be repeated at the point of use rather
 * than trusted from the point of creation. A `as unknown as Commit` cast defeats the type and does
 * not defeat that, which is the entire reason the fields are here.
 */
export interface Commit {
  readonly [commitBrand]: true;
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly reason: string;
}

/** The flag. One string, in one place, so nothing anywhere else decides what "armed" means. */
export const COMMIT_FLAG = '--commit';

/**
 * A second key, and why a single flag was not judged enough.
 *
 * `--commit` alone is one keystroke away from a shell history entry, and shell history is how a
 * dry run becomes a live run at two in the morning. The environment variable has to be set in the
 * same invocation, and its value is a sentence rather than `1` — nobody sets
 * `WEIR_ROOM_COMMIT=i-have-read-the-plan` by muscle memory.
 *
 * This is deliberately not configurable. A configurable confirmation is a confirmation somebody
 * configures away.
 */
export const COMMIT_ENV = 'WEIR_ROOM_COMMIT';
export const COMMIT_ENV_VALUE = 'i-have-read-the-plan';

/**
 * Mint a commit token, or refuse.
 *
 * Returns `null` rather than throwing. A throw would have to be caught by the caller, and a caught
 * throw is an `if` in a different shape — this way the absence of a token *is* the dry run, and the
 * type system carries it.
 */
export function commitFrom(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): Commit | null {
  if (!argv.includes(COMMIT_FLAG)) return null;
  if (env[COMMIT_ENV] !== COMMIT_ENV_VALUE) return null;
  /*
    The one cast in this file, and it is the constructor.

    A branded type has to be minted somewhere, and `unknown` is required in between because the
    brand is a symbol nothing can produce. This line is the reason the brand works everywhere else:
    it is the only place the brand is asserted, so `commitFrom` is provably the only source.
  */
  return {
    argv: [...argv],
    env: { ...env },
    reason: `${COMMIT_FLAG} with ${COMMIT_ENV}=${COMMIT_ENV_VALUE}`,
  } as unknown as Commit;
}

// ---------------------------------------------------------------------------------------------
// Ports that act
// ---------------------------------------------------------------------------------------------

/**
 * Signs a Weir statement as one address.
 *
 * Reached only from {@link liveEffects}. A signature is a single-use bearer authorisation with a
 * ten-minute life, so producing one is already an action — it is on the acting side of the line,
 * not the deciding side, and that placement is the point.
 */
export interface SignerPort {
  sign(input: { address: string; statement: string }): Promise<string>;
}

/** The one network write. A separate port so a test can assert it was never reached. */
export interface HttpPort {
  post(input: { url: string; body: unknown }): Promise<{ status: number; text: string }>;
}

/** Where output goes. Injected so a test reads what was printed instead of the terminal. */
export interface Printer {
  line(text: string): void;
}

export interface Receipt {
  what: string;
  sent: boolean;
  detail: string;
}

/**
 * The only interface through which anything leaves this process.
 *
 * Two implementations exist and there is no third. `mode` is on the object rather than inferred, so
 * every receipt and every log line can say which one produced it — a dry run that cannot be told
 * apart from a live one in a log is a dry run nobody will trust twice.
 */
export interface RoomEffects {
  readonly mode: 'dry-run' | 'live';
  deliverMessage(plan: DirectMessagePlan): Promise<Receipt>;
  publishRecord(plan: PublishPlan): Promise<Receipt>;
}

/**
 * The default. Describes, never acts.
 *
 * Holds no signer and no HTTP port — not "does not use them", *does not have them*. There is
 * nothing in this object's closure capable of leaving the process.
 */
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

/**
 * The live path. Signs, and posts.
 *
 * Throws on construction when the token does not survive re-validation, rather than returning a
 * failure — this is not a condition to handle, it is a caller who reached the acting side without
 * the argv that authorises it, and the correct outcome is a stack trace naming this function.
 */
export function liveEffects(
  commit: Commit,
  ports: { signer: SignerPort; http: HttpPort },
): RoomEffects {
  /*
    The re-check.

    `commitFrom` is run again over the argv and env the token recorded. A token obtained honestly
    passes trivially. A token forged with `{} as unknown as Commit` carries an argv that does not
    contain the flag, and dies here — one line after the type system was talked out of the way.
  */
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
        // The route's own words, unmodified. A guess at what a status meant is how a paywall
        // failure gets logged as a network blip.
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

// ---------------------------------------------------------------------------------------------
// Running a room
// ---------------------------------------------------------------------------------------------

export interface RoomPorts {
  agent: AgentSeatPort;
  cipher: CipherPort;
  directory: DirectoryPort;
  clock: ClockPort;
  printer: Printer;
  /** Origin of the Weir deployment, e.g. `https://weir.social`. No trailing slash required. */
  origin: string;
}

export interface RoomRun {
  mode: 'dry-run' | 'live';
  deliberation: Deliberation;
  record: SoldRecord;
  publish: PublishPlan;
  receipts: readonly Receipt[];
}

/**
 * Drive one session end to end.
 *
 * The `effects` parameter defaults to a dry run. That default is the last of the four guards and
 * the one that catches ordinary mistakes rather than adversarial ones: a caller who forgot the
 * argument gets a printout, not a publish.
 *
 * # Order, and why the record is built before a single message is delivered
 *
 * Deliberate → resolve → build record → plan publish → *then* act. Every refusal the record or the
 * publish can produce — an over-long body, a leaking preview, a non-zero tier, a period boundary
 * inside the signature window — is found before anything has been sent. The alternative, delivering
 * as the room runs, means discovering an unpublishable record after twenty encrypted messages are
 * already in someone's inbox, with no way to take them back.
 */
export async function runRoom(
  room: RoomDefinition,
  ports: RoomPorts,
  policy: RecordPolicy,
  effects: RoomEffects = dryRunEffects(ports.printer),
): Promise<Reading<RoomRun>> {
  const { printer } = ports;
  const source = `room ${room.id}`;

  /*
    Shape first, chain second.

    `deliberate` validates too, and this call is not redundant with it. Without it a malformed
    address is handed to the key registry, which answers `not-found` — technically true and
    actively misleading, because the address was never going to be found and the fault is a typo in
    a config file, not a seat that has yet to publish a key. Refusing on shape before spending a
    chain read gives the operator the sentence that names the real problem.
  */
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
      /*
        A failed delivery stops the session before the record is published.

        Publishing a record of a conversation part of the cast never received would sell an
        accurate transcript of something that did not happen — the agents' later turns were
        computed from a `heard` list the messaging layer did not actually deliver. Better a
        half-delivered room and no sale than a sale of a fiction.
      */
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

/**
 * The sentence the operator's own configuration earns them.
 *
 * Generated from `custody` rather than written in a brochure, because the strong claim is only true
 * under one of the two values and a claim that is true under one configuration always ends up
 * printed under the other.
 */
function custodyNote(room: RoomDefinition): string {
  return room.custody === 'independent'
    ? ' — each seat is driven by a separate operator holding only its own key, so no single party ' +
        'holds the whole deliberation. Weir holds ciphertext and cannot read it.'
    : ' — one operator holds every seat key, so the deliberation is private FROM WEIR and from ' +
        'anyone who obtains the database, and NOT from the operator. Do not claim otherwise.';
}

// ---------------------------------------------------------------------------------------------
// The agent package
// ---------------------------------------------------------------------------------------------

/** Resolved at runtime, never imported at type level. See {@link loadAgentSeatPort}. */
const AGENT_PACKAGE = '@projectx-social/agent';

/**
 * Bind to `@projectx-social/agent` if it is installed and exposes something to bind to.
 *
 * # Why this is a dynamic import and not a normal one
 *
 * That package is being written in parallel with this one. A static `import` would make this
 * package's typecheck a function of another agent's progress: the day their `package.json` lands
 * half-written, this one stops compiling, and the failure looks like a bug here. A dynamic import
 * behind a runtime shape check keeps the two independent and turns "not ready yet" into a `null`
 * with a sentence, which the caller can substitute a stub for.
 *
 * # Two shapes are accepted, and the reason is honest rather than generous
 *
 * A module exporting `speak` directly, or one exporting a factory `createAgentSeat()` that returns
 * something with `speak`. Those are the two shapes the port could plausibly land as, and guessing
 * wrong would mean this returns `null` against a package that is present and working. Anything else
 * returns `null` with the export names listed, so the operator can see what it found rather than
 * being told it found nothing.
 */
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

// ---------------------------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------------------------

export interface Options {
  commit: Commit | null;
}

export function parseArgs(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): Options {
  return { commit: commitFrom(argv, env) };
}

/**
 * What the command line does on its own, which is: explain itself and refuse to guess.
 *
 * There is no room to run here. A room needs a cast, a cadence, a vault, a tier and a price, and
 * every one of those is the owner's product decision — see the README. A CLI that shipped a default
 * cast would have made those decisions while appearing to be a convenience.
 *
 * So `main` reports the posture, prints the guards, and exits. Wiring a real room means calling
 * {@link runRoom} from a module that has the ports, which is the honest shape for a service whose
 * inputs are decisions rather than arguments.
 */
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

/*
  Run as a script, or imported as a library.

  `packages/daemon` keeps this separation by putting its entry point in a second file, `main.ts`,
  "so importing the library runs nothing". That is the better shape and this package does not have
  it: the file list for this module is fixed at four, and a fifth file would be a change nobody
  asked for in a tree eight agents are writing at once.

  The guard preserves the property that matters. `import.meta.url` is this module's URL and
  `process.argv[1]` is the script Node was told to run; they are equal only when this file *is* the
  script. An importer — a test, a wiring module, another service — never trips it, so importing this
  library still runs nothing.
*/
const invokedDirectly =
  typeof process !== 'undefined' &&
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const code = await main(process.argv.slice(2), process.env);
  process.exit(code);
}
