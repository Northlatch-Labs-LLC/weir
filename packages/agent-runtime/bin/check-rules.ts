#!/usr/bin/env node
// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(__dirname, '..');

export interface JsonObject {
  readonly [key: string]: unknown;
}

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

export interface CheckOptions {
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly argv?: readonly string[];
  readonly packageRoot?: string;
  readonly allowedStdio?: ReadonlyMap<string, string>;
}

const MCP_HOST_ALLOWLIST: ReadonlySet<string> = new Set(['mcp.weir.social']);
const MCP_LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1']);

export const ALLOWED_STDIO: ReadonlyMap<string, string> = new Map<string, string>([]);

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

export const STDIO_ENV_ALLOWLIST: readonly string[] = Object.freeze([
  'PATH',
  'HOME',
  'LANG',
  'PICOCLAW_CONFIG',
]);

const SHIPPED_SKILLS: ReadonlySet<string> = new Set(['weir-agent']);

const ALLOWED_MODEL_HOSTS: ReadonlySet<string> = new Set(['openrouter.ai']);
const MODEL_LOCAL_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost', 'host.docker.internal']);

const SHIPPED_SECURITY_YML_ALLOWLIST: ReadonlySet<string> = new Set(['model_list.route-normal.api_keys']);

export class RuleViolation extends Error {
  readonly ruleNumber: number;

  constructor(ruleNumber: number, message: string) {
    super(`rule ${ruleNumber}: ${message}`);
    this.name = 'RuleViolation';
    this.ruleNumber = ruleNumber;
  }
}

function asObject(value: unknown): JsonObject | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return value as JsonObject;
}

function field(value: unknown, ...keys: readonly string[]): unknown {
  let cursor: unknown = value;
  for (const key of keys) {
    const here = asObject(cursor);
    if (here === undefined) return undefined;
    cursor = here[key];
  }
  return cursor;
}

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

function configPathForRelativeResolution(packageRoot: string): string {
  return path.join(packageRoot, 'config.json');
}

function resolveWorkspace(workspace: unknown, packageRoot: string): string | null {
  if (typeof workspace !== 'string' || workspace === '') return null;
  return path.isAbsolute(workspace)
    ? workspace
    : path.resolve(path.dirname(configPathForRelativeResolution(packageRoot)), workspace);
}

function isInsideWorkspace(entryPath: string, workspaceAbs: string | null): boolean {
  if (!path.isAbsolute(entryPath)) return true;
  if (workspaceAbs === null) return false;
  const resolvedEntry = path.resolve(entryPath);
  const rel = path.relative(workspaceAbs, resolvedEntry);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

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

function isInterpreterCommand(command: string): boolean {
  const base = path.basename(command).toLowerCase();
  return INTERPRETER_COMMANDS.some((pattern) => pattern.test(base));
}

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

      if (isInterpreterCommand(command)) {
        throw new RuleViolation(
          5,
          `MCP server "${name}"'s command "${command}" is an interpreter. Hashing an interpreter ` +
            'pins the interpreter and leaves the program it runs unpinned; a stdio server must be ' +
            'a single self-contained executable. Refused even if the path is in the allow-list ' +
            'and the hash matches.'
        );
      }

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
  if (resolvedWorkspace === null) return;
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

  if (args[0] === '--print-stdio-env-allowlist') {
    process.stdout.write(`${STDIO_ENV_ALLOWLIST.join('\n')}\n`);
    process.exit(0);
  }

  const configPath = args[0];
  if (configPath === undefined || configPath === '') {
    console.error(USAGE);
    process.exit(1);
  }
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

const invokedPath = process.argv[1];
if (invokedPath !== undefined && import.meta.url === pathToFileURL(invokedPath).href) {
  main();
}
