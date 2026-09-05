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
// No dependencies. Node's own fs/path/crypto only.

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(__dirname, '..');

// Rule 5 — MCP server allow-list (finding B4).
const MCP_HOST_ALLOWLIST = new Set(['mcp.weir.social']);
const MCP_LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1']);
// Shipped stdio MCP servers: absolute path -> expected sha256 of the binary on disk. Empty by
// default — extend only by shipping the binary and this entry together, in the same change.
const ALLOWED_STDIO = {};

// Rule 6 — the one skill this package ships. Extend this list only by shipping the directory.
const SHIPPED_SKILLS = new Set(['weir-agent']);

// Rule 9 — model api_base allow-list (finding B5).
const ALLOWED_MODEL_HOSTS = new Set(['openrouter.ai']);
const MODEL_LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', 'host.docker.internal']);

// Rule 10 — the only .security.yml key paths this package's shipped config ever needs
// (finding A4). See README, "The config template, explained": route-normal's key is the sole
// secret this dry run's shape ever calls for; no channel, no web-search key, no skills-registry
// token is ever legitimate here because rules 2, 6 and 7 keep those surfaces off regardless.
const SHIPPED_SECURITY_YML_ALLOWLIST = new Set(['model_list.route-normal.api_keys']);

class RuleViolation extends Error {
  constructor(ruleNumber, message) {
    super(`rule ${ruleNumber}: ${message}`);
    this.ruleNumber = ruleNumber;
  }
}

function loadConfig(configPath) {
  if (!existsSync(configPath)) {
    throw new Error(`config not found at ${configPath}`);
  }
  const raw = readFileSync(configPath, 'utf8');
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`config at ${configPath} is not valid JSON: ${err.message}`);
  }
}

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

// Kept separate so a rule can be unit tested against an explicit workspace root without relying
// on where the config file itself lives on disk.
function configPathForRelativeResolution(packageRoot) {
  return path.join(packageRoot, 'config.json');
}

function resolveWorkspace(workspace, packageRoot) {
  if (!workspace) return null;
  return path.isAbsolute(workspace)
    ? workspace
    : path.resolve(path.dirname(configPathForRelativeResolution(packageRoot)), workspace);
}

/** True if entryPath (absolute) resolves inside workspaceAbs, or entryPath is relative. */
function isInsideWorkspace(entryPath, workspaceAbs) {
  if (!path.isAbsolute(entryPath)) return true;
  if (!workspaceAbs) return false;
  const resolvedEntry = path.resolve(entryPath);
  const rel = path.relative(workspaceAbs, resolvedEntry);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** Rule 1: evolution.enabled !== false */
function checkRule1(config) {
  const enabled = config?.evolution?.enabled;
  if (enabled !== false) {
    throw new RuleViolation(
      1,
      `evolution.enabled must be exactly false; found ${JSON.stringify(enabled)}. ` +
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
function checkRule2(config, packageRoot) {
  const restrict = config?.agents?.defaults?.restrict_to_workspace;
  if (restrict !== true) {
    throw new RuleViolation(
      2,
      `agents.defaults.restrict_to_workspace must be exactly true; found ${JSON.stringify(restrict)}.`
    );
  }

  for (const toolName of ['exec', 'web', 'spawn', 'subagent']) {
    const enabled = config?.tools?.[toolName]?.enabled;
    if (enabled === true) {
      throw new RuleViolation(
        2,
        `tools.${toolName}.enabled is true. This beat has no signer and no policy; a tool this ` +
          'broad has no business being reachable from a read-only turn.'
      );
    }
  }

  if (config?.heartbeat?.enabled === true) {
    throw new RuleViolation(
      2,
      'heartbeat.enabled is true. This runtime is invoked one-shot by bin/beat.sh; there is no ' +
        "gateway process for PicoClaw's own heartbeat loop to run inside."
    );
  }

  const workspace = config?.agents?.defaults?.workspace;
  const resolvedWorkspace = resolveWorkspace(workspace, packageRoot);
  for (const key of ['allow_read_paths', 'allow_write_paths']) {
    const val = config?.tools?.[key];
    if (val === null || val === undefined) continue;
    if (!Array.isArray(val)) {
      throw new RuleViolation(2, `tools.${key} must be null or an array of paths; found ${JSON.stringify(val)}.`);
    }
    for (const entry of val) {
      if (typeof entry !== 'string' || !isInsideWorkspace(entry, resolvedWorkspace)) {
        throw new RuleViolation(
          2,
          `tools.${key} contains "${entry}", which does not resolve inside the workspace ` +
            `(${resolvedWorkspace ?? '(no workspace configured)'}).`
        );
      }
    }
  }
}

/** Rule 3: gateway.host not 127.0.0.1/localhost */
function checkRule3(config) {
  const host = config?.gateway?.host;
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new RuleViolation(
      3,
      `gateway.host must be "127.0.0.1" or "localhost"; found ${JSON.stringify(host)}. ` +
        'A gateway that binds anywhere else is reachable from the network.'
    );
  }
}

/**
 * Rule 4: env PICOCLAW_GATEWAY_HOST set to anything but unset/127.0.0.1, or -public in argv.
 * Closing finding A6: argv here is PicoClaw's own full command line (everything bin/beat.sh
 * passes to the picoclaw binary), not this checker's own argv — see main() below.
 * @param {NodeJS.ProcessEnv} env
 * @param {string[]} argv
 */
function checkRule4(env, argv) {
  const gatewayHostEnv = env.PICOCLAW_GATEWAY_HOST;
  if (
    gatewayHostEnv !== undefined &&
    gatewayHostEnv !== '' &&
    gatewayHostEnv !== '127.0.0.1' &&
    gatewayHostEnv !== 'localhost'
  ) {
    throw new RuleViolation(
      4,
      `PICOCLAW_GATEWAY_HOST is set to ${JSON.stringify(gatewayHostEnv)}. ` +
        'It must be unset or loopback. This is the exact flag Security\'s rule 4 forbids by name.'
    );
  }
  if (argv.includes('-public')) {
    throw new RuleViolation(4, '-public was passed on the command line. That flag is forbidden by name.');
  }
}

/**
 * Rule 5, rewritten from a five-name denylist to an allow-list (finding B4: the old denylist let
 * `{"command":"bash","args":["-c",...]}` through, and never looked at URL scheme, so
 * `http://mcp.weir.social` passed).
 *
 * http/sse servers: scheme must be https:, host must be on MCP_HOST_ALLOWLIST — except loopback,
 * which is allowed with http: only. stdio servers: command must be an absolute path present in
 * the shipped ALLOWED_STDIO map, and the file's sha256 must match. Any other shape refuses.
 */
function checkRule5(config) {
  const servers = config?.tools?.mcp?.servers ?? {};
  for (const [name, server] of Object.entries(servers)) {
    if (server?.enabled === false) continue;
    const type = server?.type;

    if (type === 'http' || type === 'sse') {
      if (typeof server?.url !== 'string') {
        throw new RuleViolation(5, `MCP server "${name}" is type "${type}" but has no "url".`);
      }
      let parsed;
      try {
        parsed = new URL(server.url);
      } catch {
        throw new RuleViolation(5, `MCP server "${name}" has an unparsable url "${server.url}".`);
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
      const command = server?.command;
      if (typeof command !== 'string' || !path.isAbsolute(command)) {
        throw new RuleViolation(
          5,
          `MCP server "${name}" is type "stdio" but "command" (${JSON.stringify(command)}) is ` +
            'not an absolute path.'
        );
      }
      const expectedSha = ALLOWED_STDIO[command];
      if (!expectedSha) {
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
      `MCP server "${name}" has type ${JSON.stringify(type)}, which is not "http", "sse" or ` +
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
function checkRule6(config, packageRoot) {
  if (config?.tools?.install_skill?.enabled === true) {
    throw new RuleViolation(
      6,
      "tools.install_skill.enabled is true. No skill enters the workspace except through the " +
        "ceremony, with Security's read — installing one at runtime is exactly that path."
    );
  }
  if (config?.tools?.find_skills?.enabled === true) {
    throw new RuleViolation(
      6,
      'tools.find_skills.enabled is true. Discovery against a registry is the same untrusted-skill path as install.'
    );
  }
  const registries = config?.tools?.skills?.registries ?? {};
  for (const [registryName, registry] of Object.entries(registries)) {
    if (registry?.enabled === true) {
      throw new RuleViolation(
        6,
        `tools.skills.registries.${registryName}.enabled is true. No registry (ClawHub, GitHub, ` +
          'or any other) may be reachable from a beat.'
      );
    }
  }

  const workspace = config?.agents?.defaults?.workspace;
  const resolvedWorkspace = resolveWorkspace(workspace, packageRoot);
  if (!resolvedWorkspace) return; // nothing to check if no workspace is configured
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
function checkRule7(config) {
  const channels = config?.channel_list ?? {};
  const names = Object.keys(channels);
  if (names.length > 0) {
    throw new RuleViolation(
      7,
      `channel_list is not empty (found: ${names.join(', ')}). Every channel is an inbound ` +
        'instruction path from the open internet into the model that holds the spending tools.'
    );
  }
}

/** Rule 8 (the eighth, council-added): no cron or hooks entry the company did not write. */
function checkRule8(config, packageRoot) {
  if (config?.hooks?.enabled === true) {
    throw new RuleViolation(8, 'hooks.enabled is true. No hook the company did not write may run between beats.');
  }
  if (Array.isArray(config?.hooks?.entries) && config.hooks.entries.length > 0) {
    throw new RuleViolation(8, 'hooks.entries is non-empty. No hook the company did not write may run between beats.');
  }
  if (config?.tools?.cron?.enabled === true) {
    throw new RuleViolation(8, 'tools.cron.enabled is true. This runtime is invoked one-shot; PicoClaw\'s own cron scheduler must stay off.');
  }
  const workspace = config?.agents?.defaults?.workspace;
  const resolvedWorkspace = resolveWorkspace(workspace, packageRoot);
  if (resolvedWorkspace) {
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
function checkRule9(config) {
  const models = config?.model_list ?? [];
  for (const model of models) {
    const name = model?.model_name ?? '(unnamed)';
    const apiBase = model?.api_base;
    if (apiBase === undefined || apiBase === null) {
      if (model?.provider !== 'openrouter') {
        throw new RuleViolation(
          9,
          `model "${name}" has no api_base and provider is ${JSON.stringify(model?.provider)}, ` +
            'not "openrouter". A model with no api_base is allowed only for PicoClaw\'s own ' +
            'default openrouter endpoint.'
        );
      }
      continue;
    }
    let parsed;
    try {
      parsed = new URL(apiBase);
    } catch {
      throw new RuleViolation(9, `model "${name}" has an unparsable api_base "${apiBase}".`);
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

/**
 * Minimal line-based reader for the shapes shown in PicoClaw's own
 * docs/security/security_configuration.md: nested maps of scalars, and a list of scalars under a
 * leaf key (e.g. model_list.<name>.api_keys). Returns the set of dotted leaf key-paths the file
 * sets. Throws on anything it cannot confidently parse — refusing an unparseable file rather than
 * guessing its shape.
 */
function parseSecurityYmlKeyPaths(text) {
  const lines = text
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
    .filter((l) => l.trim() !== '' && !l.trim().startsWith('#'));

  const stack = []; // [{ indent, key }]
  const leafPaths = new Set();

  for (const line of lines) {
    const indentMatch = line.match(/^ */);
    const indent = indentMatch ? indentMatch[0].length : 0;
    const trimmed = line.trim();

    if (trimmed.startsWith('- ') || trimmed === '-') {
      if (stack.length === 0) {
        throw new Error(`list item with no enclosing key: ${JSON.stringify(line)}`);
      }
      leafPaths.add(stack.map((s) => s.key).join('.'));
      continue;
    }

    const m = trimmed.match(/^([^:]+):\s*(.*)$/);
    if (!m) {
      throw new Error(`unparsable line: ${JSON.stringify(line)}`);
    }
    const key = m[1].trim().replace(/^["']|["']$/g, '');
    const rest = m[2].trim();

    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
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
function checkRule10(config, packageRoot) {
  const securityYmlPath = path.join(packageRoot, '.security.yml');
  if (!existsSync(securityYmlPath)) return;
  const raw = readFileSync(securityYmlPath, 'utf8');
  let leafPaths;
  try {
    leafPaths = parseSecurityYmlKeyPaths(raw);
  } catch (err) {
    throw new RuleViolation(
      10,
      `.security.yml at ${securityYmlPath} could not be parsed: ${err.message}. Refusing an ` +
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
export function checkRules(config, { env = process.env, argv = process.argv.slice(2), packageRoot = PACKAGE_ROOT } = {}) {
  checkRule1(config);
  checkRule2(config, packageRoot);
  checkRule3(config);
  checkRule4(env, argv);
  checkRule5(config);
  checkRule6(config, packageRoot);
  checkRule7(config);
  checkRule8(config, packageRoot);
  checkRule9(config);
  checkRule10(config, packageRoot);
}

export { loadConfig, RuleViolation };

async function main() {
  const args = process.argv.slice(2);
  const configPath = args[0];
  if (!configPath) {
    console.error('usage: check-rules.mjs <path-to-config.json> [-- <picoclaw argv...>]');
    process.exit(1);
  }
  // Closing finding A6: everything after "--" is PicoClaw's own argv (the exact command line
  // bin/beat.sh is about to run), not this checker's. Rule 4's -public check inspects that, not
  // this script's own arguments.
  const dashIndex = args.indexOf('--');
  const picoclawArgv = dashIndex === -1 ? [] : args.slice(dashIndex + 1);

  let config;
  try {
    config = loadConfig(path.resolve(configPath));
  } catch (err) {
    console.error(`check-rules: cannot load config: ${err.message}`);
    process.exit(1);
  }
  try {
    checkRules(config, { packageRoot: path.dirname(path.resolve(configPath)), argv: picoclawArgv });
  } catch (err) {
    if (err instanceof RuleViolation) {
      console.error(`check-rules: refused — ${err.message}`);
    } else {
      console.error(`check-rules: refused — ${err.message}`);
    }
    process.exit(1);
  }
  console.error('check-rules: all rules satisfied');
  process.exit(0);
}

// Only run as a CLI when invoked directly, not when imported by the test suite.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
