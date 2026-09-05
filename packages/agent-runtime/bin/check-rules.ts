#!/usr/bin/env node
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
//
// Refuses (exit 1, naming the rule) to let a PicoClaw config for this package run if any of the
// eight rules from the executive council's record is violated:
// work/rnd/agent/2026-09-04-executive-council-on-draft-6-and-the-lighter-agent.md §3.5-3.6.
//
// Two checks beyond the council's eight close Security's B4/B5/A4 findings (2026-09-04):
//   rule 9  — model_list[].api_base host/scheme allow-list (finding B5)
//   rule 10 — .security.yml, if present, may only set keys on a shipped allow-list (finding A4)
// Rule 5 itself was rewritten from a five-name denylist to an allow-list (finding B4), and rule 6
// now also asserts the switches that would let a beat install or find skills at runtime
// (finding B6). Rule 2 now also asserts exec/web/spawn/subagent/heartbeat stay off and that any
// extra read/write path stays inside the workspace (finding A8).
//
// Two more holes were closed on 2026-09-05, from the CTO's Heron v2 specification
// (work/rnd/agent/2026-09-05-engineering-heron-v2-runtime-and-host.md §2.7a and §2.8a):
//
//   Hole A — rule 5 pinned the INTERPRETER, not the program. It hashed `server.command` and looked
//   at neither `args` nor `env`, so `{"command":"/usr/local/bin/node","args":["/tmp/x.js"]}` passed
//   the moment `node` was in the map: the hash proved the node binary, and the thing that actually
//   ran was an unhashed script. A stdio entry is now a single self-contained executable at an
//   absolute path with empty `args` and empty `env`, and an interpreter-shaped command is refused
//   even when its hash matches.
//
//   Hole B — the stdio child's environment. A stdio MCP server is a child process and inherits the
//   parent's environment, which is where a decrypted model credential lives. STDIO_ENV_ALLOWLIST
//   below is the exact set of variables such a child may receive; `bin/beat.sh` reads it from this
//   file (`--print-stdio-env-allowlist`) and spawns PicoClaw under `env -i` with that set and
//   nothing else, so there is one source of truth for the allow-list and no second copy to drift.
//
// TypeScript, strict, no `any`. It runs with no build step: Node strips the types itself
// (`node bin/check-rules.ts`), so this package keeps its zero runtime dependencies.
//
// No dependencies. Node's own fs/path/crypto only.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------------------------
// The typed shape of what is being checked.
//
// The config is untrusted JSON off disk, so every leaf below is `unknown`, never `any`: the rule
// that reads a field is the thing that asserts its type, and a field of the wrong type is a
// refusal rather than a silently skipped check. The named fields document the shape these ten
// rules read; the index signature carries everything else PicoClaw's own schema accepts.
// ---------------------------------------------------------------------------------------------

/** A JSON object as it comes off disk. */
export interface JsonObject {
  readonly [key: string]: unknown;
}

/** The shape of a PicoClaw config as far as these ten rules read it. */
export interface PicoClawConfig extends JsonObject {
  readonly agents?: unknown;
  readonly evolution?: unknown;
  readonly channel_list?: unknown;
  readonly model_list?: unknown;
  readonly tools?: unknown;
  readonly heartbeat?: unknown;
  readonly hooks?: unknown;
  readonly gateway?: unknown;
}

/** The knobs the test suite and `main()` vary; every one has a shipped default. */
export interface CheckOptions {
  /** The environment rule 4 inspects. Defaults to `process.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** PicoClaw's own argv, not this checker's — see rule 4 and `main()`. */
  readonly argv?: readonly string[];
  /** The directory `.security.yml` and a relative workspace resolve against. */
  readonly packageRoot?: string;
  /** The stdio allow-list rule 5 pins against. Defaults to the shipped `ALLOWED_STDIO`. */
  readonly allowedStdio?: ReadonlyMap<string, string>;
}

// Rule 5 — MCP server allow-list (finding B4).
const MCP_HOST_ALLOWLIST: ReadonlySet<string> = new Set(['mcp.weir.social']);
const MCP_LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1']);

/**
 * Shipped stdio MCP servers: absolute path -> expected sha256 of the file on disk. Empty by
 * default — extend only by shipping the executable and this entry together, in the same change
 * (CTO §2.7). Every entry must be a single self-contained executable: an interpreter is never an
 * allow-listed command, and `args`/`env` must be empty, so what is hashed is what runs.
 */
export const ALLOWED_STDIO: ReadonlyMap<string, string> = new Map<string, string>([]);

/**
 * Hole A (CTO §2.7a). Command basenames that name an interpreter rather than a program. Pinning
 * the hash of one of these pins the interpreter and leaves the script it runs unpinned, which is
 * the hole. Refused even when the hash matches.
 *
 * The specification names node, sh, bash, python*, perl, tsx, deno and bun. `nodejs`, `dash`,
 * `zsh`, `ksh`, `ruby`, `php` and `env` are the same shape and are refused with them — `env` in
 * particular because `/usr/bin/env node script.js` is the classic way to launch an interpreter
 * while presenting a different basename.
 */
const INTERPRETER_COMMANDS: readonly RegExp[] = [
  /^node(js)?[0-9.]*$/,
  /^sh$/,
  /^bash$/,
  /^dash$/,
  /^zsh$/,
  /^ksh$/,
  /^python[0-9.]*$/,
  /^perl[0-9.]*$/,
  /^ruby[0-9.]*$/,
  /^php[0-9.]*$/,
  /^tsx$/,
  /^deno$/,
  /^bun$/,
  /^env$/,
];

/**
 * Hole B (CTO §2.8a). The exact environment a stdio child of this runtime may receive.
 *
 * A stdio MCP server is a child process; without `env -i` it inherits the whole parent
 * environment, and on the host that environment is where the decrypted model credential lives for
 * the length of a beat. `bin/beat.sh` reads this list from this file rather than repeating it, so
 * the allow-list has one home. Nothing credential-shaped belongs on it; adding a name here is a
 * decision that ships with its own fixture.
 */
export const STDIO_ENV_ALLOWLIST: readonly string[] = Object.freeze([
  'PATH',
  'HOME',
  'LANG',
  'PICOCLAW_CONFIG',
]);

// Rule 6 — the one skill this package ships. Extend this list only by shipping the directory.
const SHIPPED_SKILLS: ReadonlySet<string> = new Set(['weir-agent']);

// Rule 9 — model api_base allow-list (finding B5).
const ALLOWED_MODEL_HOSTS: ReadonlySet<string> = new Set(['openrouter.ai']);
const MODEL_LOCAL_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost', 'host.docker.internal']);

// Rule 10 — the only .security.yml key paths this package's shipped config ever needs
// (finding A4). See README, "The config template, explained": route-normal's key is the sole
// secret this dry run's shape ever calls for; no channel, no web-search key, no skills-registry
// token is ever legitimate here because rules 2, 6 and 7 keep those surfaces off regardless.
const SHIPPED_SECURITY_YML_ALLOWLIST: ReadonlySet<string> = new Set(['model_list.route-normal.api_keys']);

export class RuleViolation extends Error {
  readonly ruleNumber: number;

  constructor(ruleNumber: number, message: string) {
    super(`rule ${ruleNumber}: ${message}`);
    this.name = 'RuleViolation';
    this.ruleNumber = ruleNumber;
  }
}

// ---------------------------------------------------------------------------------------------
// Reading untrusted JSON without `any`.
// ---------------------------------------------------------------------------------------------

/** The object at `value`, or undefined if it is not a plain object. Arrays are not objects here. */
function asObject(value: unknown): JsonObject | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return value as JsonObject;
}

/** Walks a dotted path through plain objects, returning undefined the moment the path leaves one. */
function field(value: unknown, ...keys: readonly string[]): unknown {
  let cursor: unknown = value;
  for (const key of keys) {
    const here = asObject(cursor);
    if (here === undefined) return undefined;
    cursor = here[key];
  }
  return cursor;
}

/** The entries of a plain object, or an empty list if `value` is not one. */
function entriesOf(value: unknown): readonly (readonly [string, unknown])[] {
  const here = asObject(value);
  if (here === undefined) return [];
  return Object.entries(here);
}

function show(value: unknown): string {
  const text = JSON.stringify(value);
  return text === undefined ? String(value) : text;
}

export function loadConfig(configPath: string): PicoClawConfig {
  if (!existsSync(configPath)) {
    throw new Error(`config not found at ${configPath}`);
  }
  const raw = readFileSync(configPath, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`config at ${configPath} is not valid JSON: ${(err as Error).message}`);
  }
  const asConfig = asObject(parsed);
  if (asConfig === undefined) {
    throw new Error(`config at ${configPath} is not a JSON object (found ${show(parsed)}).`);
  }
  return asConfig;
}

// Kept separate so a rule can be unit tested against an explicit workspace root without relying
// on where the config file itself lives on disk.
function configPathForRelativeResolution(packageRoot: string): string {
  return path.join(packageRoot, 'config.json');
}

function resolveWorkspace(workspace: unknown, packageRoot: string): string | null {
  if (typeof workspace !== 'string' || workspace === '') return null;
  return path.isAbsolute(workspace)
    ? workspace
    : path.resolve(path.dirname(configPathForRelativeResolution(packageRoot)), workspace);
}

/** True if entryPath (absolute) resolves inside workspaceAbs, or entryPath is relative. */
function isInsideWorkspace(entryPath: string, workspaceAbs: string | null): boolean {
  if (!path.isAbsolute(entryPath)) return true;
  if (workspaceAbs === null) return false;
  const resolvedEntry = path.resolve(entryPath);
  const rel = path.relative(workspaceAbs, resolvedEntry);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Rule 1: evolution.enabled !== false */
function checkRule1(config: PicoClawConfig): void {
  const enabled = field(config, 'evolution', 'enabled');
  if (enabled !== false) {
    throw new RuleViolation(
      1,
      `evolution.enabled must be exactly false; found ${show(enabled)}. ` +
        'PicoClaw can cluster its own turns and rewrite its own SKILL.md files under any other value.'
    );
  }
}

/**
 * Rule 2: restrict_to_workspace !== true, and — closing finding A8 — the tools that were already
 * safe in the shipped template but asserted by nothing: exec/web/spawn/subagent must stay
 * disabled, heartbeat must stay disabled (this runtime is invoked one-shot, never by a gateway
 * heartbeat loop), and any extra read/write path must stay inside the workspace.
 */
function checkRule2(config: PicoClawConfig, packageRoot: string): void {
  const restrict = field(config, 'agents', 'defaults', 'restrict_to_workspace');
  if (restrict !== true) {
    throw new RuleViolation(
      2,
      `agents.defaults.restrict_to_workspace must be exactly true; found ${show(restrict)}.`
    );
  }

  for (const toolName of ['exec', 'web', 'spawn', 'subagent'] as const) {
    if (field(config, 'tools', toolName, 'enabled') === true) {
      throw new RuleViolation(
        2,
        `tools.${toolName}.enabled is true. This beat has no signer and no policy; a tool this ` +
          'broad has no business being reachable from a read-only turn.'
      );
    }
  }

  if (field(config, 'heartbeat', 'enabled') === true) {
    throw new RuleViolation(
      2,
      'heartbeat.enabled is true. This runtime is invoked one-shot by bin/beat.sh; there is no ' +
        "gateway process for PicoClaw's own heartbeat loop to run inside."
    );
  }

  const resolvedWorkspace = resolveWorkspace(field(config, 'agents', 'defaults', 'workspace'), packageRoot);
  for (const key of ['allow_read_paths', 'allow_write_paths'] as const) {
    const val = field(config, 'tools', key);
    if (val === null || val === undefined) continue;
    if (!Array.isArray(val)) {
      throw new RuleViolation(2, `tools.${key} must be null or an array of paths; found ${show(val)}.`);
    }
    for (const entry of val) {
      if (typeof entry !== 'string' || !isInsideWorkspace(entry, resolvedWorkspace)) {
        throw new RuleViolation(
          2,
          `tools.${key} contains ${show(entry)}, which does not resolve inside the workspace ` +
            `(${resolvedWorkspace ?? '(no workspace configured)'}).`
        );
      }
    }
  }
}

/** Rule 3: gateway.host not 127.0.0.1/localhost */
function checkRule3(config: PicoClawConfig): void {
  const host = field(config, 'gateway', 'host');
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new RuleViolation(
      3,
      `gateway.host must be "127.0.0.1" or "localhost"; found ${show(host)}. ` +
        'A gateway that binds anywhere else is reachable from the network.'
    );
  }
}

/**
 * Rule 4: env PICOCLAW_GATEWAY_HOST set to anything but unset/127.0.0.1, or -public in argv.
 * Closing finding A6: argv here is PicoClaw's own full command line (everything bin/beat.sh
 * passes to the picoclaw binary), not this checker's own argv — see main() below.
 */
function checkRule4(env: Readonly<Record<string, string | undefined>>, argv: readonly string[]): void {
  const gatewayHostEnv = env.PICOCLAW_GATEWAY_HOST;
  if (
    gatewayHostEnv !== undefined &&
    gatewayHostEnv !== '' &&
    gatewayHostEnv !== '127.0.0.1' &&
    gatewayHostEnv !== 'localhost'
  ) {
    throw new RuleViolation(
      4,
      `PICOCLAW_GATEWAY_HOST is set to ${show(gatewayHostEnv)}. ` +
        "It must be unset or loopback. This is the exact flag Security's rule 4 forbids by name."
    );
  }
  if (argv.includes('-public')) {
    throw new RuleViolation(4, '-public was passed on the command line. That flag is forbidden by name.');
  }
}

/** Hole A: true if the basename of an absolute command names an interpreter rather than a program. */
function isInterpreterCommand(command: string): boolean {
  const base = path.basename(command).toLowerCase();
  return INTERPRETER_COMMANDS.some((pattern) => pattern.test(base));
}

/**
 * Rule 5, rewritten from a five-name denylist to an allow-list (finding B4: the old denylist let
 * `{"command":"bash","args":["-c",...]}` through, and never looked at URL scheme, so
 * `http://mcp.weir.social` passed), and closed again on 2026-09-05 for hole A (CTO §2.7a).
 *
 * http/sse servers: scheme must be https:, host must be on MCP_HOST_ALLOWLIST — except loopback,
 * which is allowed with http: only.
 *
 * stdio servers: `command` must be an absolute path; it must not name an interpreter (a hashed
 * `node` pins node, not the script node runs); `args` and `env` must be absent or empty, so the
 * hashed file is the whole of what executes; and the path must be present in the shipped
 * allow-list with the file on disk hashing to the pinned value. Any other shape refuses.
 */
function checkRule5(config: PicoClawConfig, allowedStdio: ReadonlyMap<string, string>): void {
  for (const [name, server] of entriesOf(field(config, 'tools', 'mcp', 'servers'))) {
    if (field(server, 'enabled') === false) continue;
    const type = field(server, 'type');

    if (type === 'http' || type === 'sse') {
      const url = field(server, 'url');
      if (typeof url !== 'string') {
        throw new RuleViolation(5, `MCP server "${name}" is type "${type}" but has no "url".`);
      }
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        throw new RuleViolation(5, `MCP server "${name}" has an unparsable url "${url}".`);
      }
      const host = parsed.hostname.toLowerCase();
      if (MCP_LOOPBACK_HOSTS.has(host)) {
        if (parsed.protocol !== 'http:') {
          throw new RuleViolation(
            5,
            `MCP server "${name}" is loopback host "${host}" but scheme is "${parsed.protocol}"; ` +
              'loopback is allowed only over http:.'
          );
        }
      } else if (MCP_HOST_ALLOWLIST.has(host)) {
        if (parsed.protocol !== 'https:') {
          throw new RuleViolation(
            5,
            `MCP server "${name}" host "${host}" is on the allow-list but scheme is ` +
              `"${parsed.protocol}", not https:.`
          );
        }
      } else {
        throw new RuleViolation(
          5,
          `MCP server "${name}" points at host "${host}", which is on neither the allow-list ` +
            `(${[...MCP_HOST_ALLOWLIST].join(', ')}) nor loopback.`
        );
      }
      continue;
    }

    if (type === 'stdio') {
      const command = field(server, 'command');
      if (typeof command !== 'string' || !path.isAbsolute(command)) {
        throw new RuleViolation(
          5,
          `MCP server "${name}" is type "stdio" but "command" (${show(command)}) is ` +
            'not an absolute path.'
        );
      }

      // Hole A, first half: pin the program, never the interpreter. Checked before the allow-list
      // so that adding an interpreter to the map cannot buy it a pass.
      if (isInterpreterCommand(command)) {
        throw new RuleViolation(
          5,
          `MCP server "${name}"'s command "${command}" is an interpreter. Hashing an interpreter ` +
            'pins the interpreter and leaves the program it runs unpinned; a stdio server must be ' +
            'a single self-contained executable. Refused even if the path is in the allow-list ' +
            'and the hash matches.'
        );
      }

      // Hole A, second half: what is hashed must be the whole of what runs. Anything in argv or
      // in the child's environment is unhashed input to the pinned file.
      const args = field(server, 'args');
      if (args !== undefined && args !== null && !(Array.isArray(args) && args.length === 0)) {
        throw new RuleViolation(
          5,
          `MCP server "${name}" sets "args" to ${show(args)}. A stdio server's args must be absent ` +
            'or empty: an argument is unhashed input, and it is exactly how an interpreter is ' +
            'handed an unpinned script.'
        );
      }
      const serverEnv = field(server, 'env');
      if (
        serverEnv !== undefined &&
        serverEnv !== null &&
        !(asObject(serverEnv) !== undefined && Object.keys(asObject(serverEnv) ?? {}).length === 0)
      ) {
        throw new RuleViolation(
          5,
          `MCP server "${name}" sets "env" to ${show(serverEnv)}. A stdio server's env must be ` +
            'absent or empty: the child receives exactly ' +
            `${STDIO_ENV_ALLOWLIST.join(', ')} from bin/beat.sh and nothing else, and a config ` +
            'that adds to that is a second, unreviewed door into the child.'
        );
      }

      const expectedSha = allowedStdio.get(command);
      if (expectedSha === undefined) {
        throw new RuleViolation(
          5,
          `MCP server "${name}"'s command "${command}" is not in the shipped stdio allow-list. ` +
            'Only a pinned, shipped binary may be used.'
        );
      }
      if (!existsSync(command)) {
        throw new RuleViolation(5, `MCP server "${name}"'s command "${command}" does not exist on disk.`);
      }
      const actual = createHash('sha256').update(readFileSync(command)).digest('hex');
      if (actual !== expectedSha) {
        throw new RuleViolation(
          5,
          `MCP server "${name}"'s command "${command}" has sha256 "${actual}", which does not ` +
            `match the shipped "${expectedSha}".`
        );
      }
      continue;
    }

    throw new RuleViolation(
      5,
      `MCP server "${name}" has type ${show(type)}, which is not "http", "sse" or ` +
        '"stdio". Any other shape refuses, including a bare command with no recognised type ' +
        '(e.g. {"command":"bash","args":["-c",...]}).'
    );
  }
}

/**
 * Rule 6: any skill directory in the workspace not in the shipped list — and, closing finding
 * B6, the switches that would let a beat install or discover a skill at runtime instead of
 * through the ceremony.
 */
function checkRule6(config: PicoClawConfig, packageRoot: string): void {
  if (field(config, 'tools', 'install_skill', 'enabled') === true) {
    throw new RuleViolation(
      6,
      'tools.install_skill.enabled is true. No skill enters the workspace except through the ' +
        'ceremony, with Security\'s read — installing one at runtime is exactly that path.'
    );
  }
  if (field(config, 'tools', 'find_skills', 'enabled') === true) {
    throw new RuleViolation(
      6,
      'tools.find_skills.enabled is true. Discovery against a registry is the same untrusted-skill path as install.'
    );
  }
  for (const [registryName, registry] of entriesOf(field(config, 'tools', 'skills', 'registries'))) {
    if (field(registry, 'enabled') === true) {
      throw new RuleViolation(
        6,
        `tools.skills.registries.${registryName}.enabled is true. No registry (ClawHub, GitHub, ` +
          'or any other) may be reachable from a beat.'
      );
    }
  }

  const resolvedWorkspace = resolveWorkspace(field(config, 'agents', 'defaults', 'workspace'), packageRoot);
  if (resolvedWorkspace === null) return; // nothing to check if no workspace is configured
  const skillsDir = path.join(resolvedWorkspace, 'skills');
  if (!existsSync(skillsDir)) return;
  for (const entry of readdirSync(skillsDir)) {
    const full = path.join(skillsDir, entry);
    if (!statSync(full).isDirectory()) {
      throw new RuleViolation(
        6,
        `"${entry}" under ${skillsDir} is not a directory. A bare file in skills/ (e.g. ` +
          'skills/evil.md) is not a shipped skill and is refused the same as an unknown directory.'
      );
    }
    if (!SHIPPED_SKILLS.has(entry)) {
      throw new RuleViolation(
        6,
        `skill directory "${entry}" under ${skillsDir} is not in the shipped list ` +
          `(${[...SHIPPED_SKILLS].join(', ')}). No skill enters the workspace except through the ` +
          "ceremony, with Security's read."
      );
    }
  }
}

/** Rule 7: any channel enabled or present. */
function checkRule7(config: PicoClawConfig): void {
  const names = entriesOf(field(config, 'channel_list')).map(([name]) => name);
  if (names.length > 0) {
    throw new RuleViolation(
      7,
      `channel_list is not empty (found: ${names.join(', ')}). Every channel is an inbound ` +
        'instruction path from the open internet into the model that holds the spending tools.'
    );
  }
}

/** Rule 8 (the eighth, council-added): no cron or hooks entry the company did not write. */
function checkRule8(config: PicoClawConfig, packageRoot: string): void {
  if (field(config, 'hooks', 'enabled') === true) {
    throw new RuleViolation(8, 'hooks.enabled is true. No hook the company did not write may run between beats.');
  }
  const hookEntries = field(config, 'hooks', 'entries');
  if (Array.isArray(hookEntries) && hookEntries.length > 0) {
    throw new RuleViolation(8, 'hooks.entries is non-empty. No hook the company did not write may run between beats.');
  }
  if (field(config, 'tools', 'cron', 'enabled') === true) {
    throw new RuleViolation(
      8,
      "tools.cron.enabled is true. This runtime is invoked one-shot; PicoClaw's own cron scheduler must stay off."
    );
  }
  const resolvedWorkspace = resolveWorkspace(field(config, 'agents', 'defaults', 'workspace'), packageRoot);
  if (resolvedWorkspace !== null) {
    const cronDir = path.join(resolvedWorkspace, 'cron');
    if (existsSync(cronDir)) {
      const jobs = readdirSync(cronDir).filter((f) => !f.startsWith('.'));
      if (jobs.length > 0) {
        throw new RuleViolation(
          8,
          `workspace cron store at ${cronDir} holds ${jobs.length} job file(s). ` +
            'Both cron and hooks act between beats, outside the heartbeat, and neither is covered by the seven rules.'
        );
      }
    }
  }
}

/**
 * Rule 9 (added by this package, closing finding B5): model_list[].api_base is checked by
 * nothing upstream, so a config could send the whole prompt in plaintext to any server. Every
 * api_base host must be allow-listed over https:, or local over http:. A model entry with no
 * api_base is allowed only for provider "openrouter" — PicoClaw's own default endpoint, README's
 * "The config template, explained".
 */
function checkRule9(config: PicoClawConfig): void {
  const models = config.model_list;
  if (models === undefined || models === null) return;
  if (!Array.isArray(models)) {
    throw new RuleViolation(
      9,
      `model_list must be an array; found ${show(models)}. Any other shape is not iterated, and a ` +
        'rule that silently checks nothing is the defect this package exists to refuse.'
    );
  }
  for (const model of models) {
    const nameField = field(model, 'model_name');
    const name = typeof nameField === 'string' ? nameField : '(unnamed)';
    const apiBase = field(model, 'api_base');
    const provider = field(model, 'provider');
    if (apiBase === undefined || apiBase === null) {
      if (provider !== 'openrouter') {
        throw new RuleViolation(
          9,
          `model "${name}" has no api_base and provider is ${show(provider)}, ` +
            'not "openrouter". A model with no api_base is allowed only for PicoClaw\'s own ' +
            'default openrouter endpoint.'
        );
      }
      continue;
    }
    let parsed: URL;
    try {
      if (typeof apiBase !== 'string') throw new Error('not a string');
      parsed = new URL(apiBase);
    } catch {
      throw new RuleViolation(9, `model "${name}" has an unparsable api_base ${show(apiBase)}.`);
    }
    const host = parsed.hostname.toLowerCase();
    if (MODEL_LOCAL_HOSTS.has(host)) {
      if (parsed.protocol !== 'http:') {
        throw new RuleViolation(
          9,
          `model "${name}" api_base host "${host}" is local but scheme is "${parsed.protocol}", not http:.`
        );
      }
    } else if (ALLOWED_MODEL_HOSTS.has(host)) {
      if (parsed.protocol !== 'https:') {
        throw new RuleViolation(
          9,
          `model "${name}" api_base host "${host}" is allow-listed but scheme is ` +
            `"${parsed.protocol}", not https:.`
        );
      }
    } else {
      throw new RuleViolation(
        9,
        `model "${name}" api_base points at host "${host}", which is on neither the allow-list ` +
          `(${[...ALLOWED_MODEL_HOSTS].join(', ')}) nor local. A config could otherwise send the ` +
          'whole prompt in plaintext to any server.'
      );
    }
  }
}

interface YamlFrame {
  readonly indent: number;
  readonly key: string;
}

/**
 * Minimal line-based reader for the shapes shown in PicoClaw's own
 * docs/security/security_configuration.md: nested maps of scalars, and a list of scalars under a
 * leaf key (e.g. model_list.<name>.api_keys). Returns the set of dotted leaf key-paths the file
 * sets. Throws on anything it cannot confidently parse — refusing an unparseable file rather than
 * guessing its shape.
 */
export function parseSecurityYmlKeyPaths(text: string): ReadonlySet<string> {
  const lines = text
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
    .filter((l) => l.trim() !== '' && !l.trim().startsWith('#'));

  const stack: YamlFrame[] = [];
  const leafPaths = new Set<string>();

  for (const line of lines) {
    const indentMatch = /^ */.exec(line);
    const indent = indentMatch === null ? 0 : indentMatch[0].length;
    const trimmed = line.trim();

    if (trimmed.startsWith('- ') || trimmed === '-') {
      if (stack.length === 0) {
        throw new Error(`list item with no enclosing key: ${JSON.stringify(line)}`);
      }
      leafPaths.add(stack.map((s) => s.key).join('.'));
      continue;
    }

    const m = /^([^:]+):\s*(.*)$/.exec(trimmed);
    if (m === null) {
      throw new Error(`unparsable line: ${JSON.stringify(line)}`);
    }
    const key = (m[1] ?? '').trim().replace(/^["']|["']$/g, '');
    const rest = (m[2] ?? '').trim();

    for (let top = stack[stack.length - 1]; top !== undefined && top.indent >= indent; top = stack[stack.length - 1]) {
      stack.pop();
    }

    if (rest === '' || rest === '|' || rest === '>') {
      stack.push({ indent, key });
    } else {
      leafPaths.add([...stack.map((s) => s.key), key].join('.'));
    }
  }
  return leafPaths;
}

/**
 * Rule 10 (added by this package, closing finding A4): `.security.yml`, PicoClaw's own secrets
 * side-file, is read by no rule. If one exists beside the config, it is parsed and every leaf key
 * path it sets must be on this package's shipped allow-list; anything else — a channel token, a
 * web-search key, a skills-registry token, an unrecognised model route — refuses, and an
 * unparseable file refuses too rather than being silently ignored.
 */
function checkRule10(packageRoot: string): void {
  const securityYmlPath = path.join(packageRoot, '.security.yml');
  if (!existsSync(securityYmlPath)) return;
  const raw = readFileSync(securityYmlPath, 'utf8');
  let leafPaths: ReadonlySet<string>;
  try {
    leafPaths = parseSecurityYmlKeyPaths(raw);
  } catch (err) {
    throw new RuleViolation(
      10,
      `.security.yml at ${securityYmlPath} could not be parsed: ${(err as Error).message}. Refusing an ` +
        'unparseable secrets file rather than guessing its shape.'
    );
  }
  for (const p of leafPaths) {
    if (!SHIPPED_SECURITY_YML_ALLOWLIST.has(p)) {
      throw new RuleViolation(
        10,
        `.security.yml at ${securityYmlPath} sets "${p}", which is not on this package's shipped ` +
          `allow-list (${[...SHIPPED_SECURITY_YML_ALLOWLIST].join(', ')}). This package never arms ` +
          'a channel, a web-search key, or a skills-registry token.'
      );
    }
  }
}

/**
 * Runs all ten checks against a loaded config. Throws the first RuleViolation found.
 * Exported for the test suite so it can be called against fixture objects directly.
 */
export function checkRules(config: PicoClawConfig, options: CheckOptions = {}): void {
  const env = options.env ?? process.env;
  const argv = options.argv ?? process.argv.slice(2);
  const packageRoot = options.packageRoot ?? PACKAGE_ROOT;
  const allowedStdio = options.allowedStdio ?? ALLOWED_STDIO;

  checkRule1(config);
  checkRule2(config, packageRoot);
  checkRule3(config);
  checkRule4(env, argv);
  checkRule5(config, allowedStdio);
  checkRule6(config, packageRoot);
  checkRule7(config);
  checkRule8(config, packageRoot);
  checkRule9(config);
  checkRule10(packageRoot);
}

const USAGE =
  'usage: check-rules.ts <path-to-config.json> [-- <picoclaw argv...>]\n' +
  '       check-rules.ts --print-stdio-env-allowlist';

function main(): void {
  const args = process.argv.slice(2);

  // Hole B: bin/beat.sh asks this file for the allow-list rather than carrying its own copy, so
  // the set the child receives and the set the checker documents cannot drift apart.
  if (args[0] === '--print-stdio-env-allowlist') {
    process.stdout.write(`${STDIO_ENV_ALLOWLIST.join('\n')}\n`);
    process.exit(0);
  }

  const configPath = args[0];
  if (configPath === undefined || configPath === '') {
    console.error(USAGE);
    process.exit(1);
  }
  // Closing finding A6: everything after "--" is PicoClaw's own argv (the exact command line
  // bin/beat.sh is about to run), not this checker's. Rule 4's -public check inspects that, not
  // this script's own arguments.
  const dashIndex = args.indexOf('--');
  const picoclawArgv = dashIndex === -1 ? [] : args.slice(dashIndex + 1);

  let config: PicoClawConfig;
  try {
    config = loadConfig(path.resolve(configPath));
  } catch (err) {
    console.error(`check-rules: cannot load config: ${(err as Error).message}`);
    process.exit(1);
  }
  try {
    checkRules(config, { packageRoot: path.dirname(path.resolve(configPath)), argv: picoclawArgv });
  } catch (err) {
    console.error(`check-rules: refused — ${(err as Error).message}`);
    process.exit(1);
  }
  console.error('check-rules: all rules satisfied');
  process.exit(0);
}

// Only run as a CLI when invoked directly, not when imported by the test suite.
const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  main();
}
