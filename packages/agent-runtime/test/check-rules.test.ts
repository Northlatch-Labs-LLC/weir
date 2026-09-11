// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {
  ALLOWED_STDIO,
  STDIO_ENV_ALLOWLIST,
  checkRules,
  loadConfig,
  parseSecurityYmlKeyPaths,
  RuleViolation,
} from '../bin/check-rules.ts';

function baseParts() {
  return {
    version: 3,
    agents: {
      defaults: {
        workspace: './workspace',
        restrict_to_workspace: true,
        model_name: 'route-critical',
      },
    },
    evolution: { enabled: false, mode: 'observe' },
    channel_list: {},
    model_list: [
      {
        model_name: 'route-critical',
        provider: 'ollama',
        model: 'ollama/x',
        api_base: 'http://host.docker.internal:11434/v1',
      },
      { model_name: 'route-normal', provider: 'openrouter', model: 'openrouter/anthropic/claude-sonnet-5' },
    ],
    tools: {
      allow_read_paths: null,
      allow_write_paths: null,
      exec: { enabled: false },
      web: { enabled: false },
      spawn: { enabled: false },
      subagent: { enabled: false },
      install_skill: { enabled: false },
      find_skills: { enabled: false },
      skills: { enabled: true, registries: { clawhub: { enabled: false }, github: { enabled: false } } },
      mcp: {
        enabled: true,
        servers: {
          weir: { enabled: true, type: 'http', url: 'https://mcp.weir.social/mcp' },
        },
      },
      cron: { enabled: false },
    },
    heartbeat: { enabled: false },
    hooks: { enabled: false },
    gateway: { host: '127.0.0.1', port: 18790 },
  };
}

function baseConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...baseParts(), ...overrides };
}

function baseTools(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...baseParts().tools, ...overrides };
}

function withStdioServer(server: Record<string, unknown>): Record<string, unknown> {
  return baseConfig({
    tools: baseTools({ mcp: { enabled: true, servers: { keyed: server } } }),
  });
}

interface Workspace {
  readonly root: string;
  readonly workspace: string;
}

function makeWorkspace(
  options: {
    readonly skillDirs?: readonly string[];
    readonly skillFiles?: readonly string[];
    readonly cronFiles?: readonly string[];
  } = {}
): Workspace {
  const skillDirs = options.skillDirs ?? ['weir-agent'];
  const skillFiles = options.skillFiles ?? [];
  const cronFiles = options.cronFiles ?? [];
  const root = mkdtempSync(path.join(os.tmpdir(), 'agent-runtime-test-'));
  const workspace = path.join(root, 'workspace');
  const skillsDir = path.join(workspace, 'skills');
  mkdirSync(skillsDir, { recursive: true });
  for (const dir of skillDirs) {
    mkdirSync(path.join(skillsDir, dir), { recursive: true });
    writeFileSync(path.join(skillsDir, dir, 'SKILL.md'), `---\nname: ${dir}\ndescription: test\n---\n`);
  }
  for (const file of skillFiles) {
    writeFileSync(path.join(skillsDir, file), 'not a directory');
  }
  if (cronFiles.length > 0) {
    const cronDir = path.join(workspace, 'cron');
    mkdirSync(cronDir, { recursive: true });
    for (const f of cronFiles) {
      writeFileSync(path.join(cronDir, f), '{}');
    }
  }
  return { root, workspace };
}

function shippedExecutable(dir: string, name: string, body = 'ELF-not-really\n'): { path: string; sha256: string } {
  const file = path.join(dir, name);
  writeFileSync(file, body);
  return { path: file, sha256: createHash('sha256').update(readFileSync(file)).digest('hex') };
}

function refusal(ruleNumber: number, matching?: RegExp) {
  return (err: unknown): boolean => {
    assert.ok(err instanceof RuleViolation, `expected a RuleViolation, got ${String(err)}`);
    assert.equal(err.ruleNumber, ruleNumber);
    if (matching !== undefined) assert.match(err.message, matching);
    return true;
  };
}

test('shipped: ALLOWED_STDIO is empty until a binary and its hash land in the same commit', () => {
  assert.equal(ALLOWED_STDIO.size, 0);
});

test('shipped: every ALLOWED_STDIO key is an absolute path that is not an interpreter', () => {
  for (const command of ALLOWED_STDIO.keys()) {
    assert.ok(path.isAbsolute(command), `${command} is not absolute`);
    assert.doesNotMatch(path.basename(command), /^(node(js)?[0-9.]*|sh|bash|dash|zsh|ksh|python[0-9.]*|perl[0-9.]*|ruby[0-9.]*|php[0-9.]*|tsx|deno|bun|env)$/);
  }
});

test('shipped (hole B): the stdio env allow-list is exactly the four names bin/beat.sh passes', () => {
  assert.deepEqual([...STDIO_ENV_ALLOWLIST], ['PATH', 'HOME', 'LANG', 'PICOCLAW_CONFIG']);
});

test('shipped (hole B): nothing credential-shaped is on the env allow-list', () => {
  for (const name of STDIO_ENV_ALLOWLIST) {
    assert.doesNotMatch(name, /KEY|TOKEN|SECRET|PASS|CRED/i);
  }
});

test('passing fixture: a config satisfying every rule does not throw', () => {
  const { root, workspace } = makeWorkspace();
  const config = baseConfig({
    agents: { defaults: { workspace, restrict_to_workspace: true, model_name: 'route-critical' } },
  });
  assert.doesNotThrow(() => checkRules(config, { env: {}, argv: [], packageRoot: root }));
  rmSync(root, { recursive: true, force: true });
});

test('passing fixture: a disabled MCP server is skipped whatever its shape', () => {
  const config = withStdioServer({ enabled: false, command: 'bash', args: ['-c', 'echo hi'] });
  assert.doesNotThrow(() => checkRules(config, { env: {}, argv: [] }));
});

test('passing fixture: a loopback MCP server over http: is allowed', () => {
  const config = baseConfig({
    tools: baseTools({ mcp: { enabled: true, servers: { local: { type: 'http', url: 'http://127.0.0.1:8080/mcp' } } } }),
  });
  assert.doesNotThrow(() => checkRules(config, { env: {}, argv: [] }));
});

test('passing fixture (hole A): a pinned, self-contained stdio executable with empty args and env passes', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'agent-runtime-stdio-'));
  const shipped = shippedExecutable(dir, 'weir-mcp');
  const config = withStdioServer({ type: 'stdio', command: shipped.path, args: [], env: {} });
  assert.doesNotThrow(() =>
    checkRules(config, { env: {}, argv: [], allowedStdio: new Map([[shipped.path, shipped.sha256]]) })
  );
  rmSync(dir, { recursive: true, force: true });
});

test('rule 1: evolution.enabled must be exactly false', () => {
  const config = baseConfig({ evolution: { enabled: true, mode: 'observe' } });
  assert.throws(() => checkRules(config, { env: {}, argv: [] }), refusal(1));
});

test('rule 1: evolution.mode "apply" with enabled true also refused', () => {
  const config = baseConfig({ evolution: { enabled: true, mode: 'apply' } });
  assert.throws(() => checkRules(config, { env: {}, argv: [] }), refusal(1));
});

test('rule 2: restrict_to_workspace must be exactly true', () => {
  const config = baseConfig({
    agents: { defaults: { workspace: './workspace', restrict_to_workspace: false, model_name: 'x' } },
  });
  assert.throws(() => checkRules(config, { env: {}, argv: [] }), refusal(2, /restrict_to_workspace/));
});

test('rule 2 (finding A8): tools.exec.enabled true is refused', () => {
  const config = baseConfig({ tools: baseTools({ exec: { enabled: true } }) });
  assert.throws(() => checkRules(config, { env: {}, argv: [] }), refusal(2, /tools\.exec\.enabled/));
});

test('rule 2 (finding A8): tools.web/spawn/subagent enabled are each refused', () => {
  for (const toolName of ['web', 'spawn', 'subagent']) {
    const config = baseConfig({ tools: baseTools({ [toolName]: { enabled: true } }) });
    assert.throws(() => checkRules(config, { env: {}, argv: [] }), refusal(2, new RegExp(`tools\\.${toolName}\\.enabled`)));
  }
});

test('rule 2 (finding A8): heartbeat.enabled true is refused', () => {
  const config = baseConfig({ heartbeat: { enabled: true } });
  assert.throws(() => checkRules(config, { env: {}, argv: [] }), refusal(2, /heartbeat\.enabled/));
});

test('rule 2 (finding A8): a non-array allow_read_paths is refused', () => {
  const config = baseConfig({ tools: baseTools({ allow_read_paths: '/etc' }) });
  assert.throws(() => checkRules(config, { env: {}, argv: [] }), refusal(2, /must be null or an array/));
});

test('rule 2 (finding A8): an allow_read_paths entry outside the workspace is refused', () => {
  const { root, workspace } = makeWorkspace();
  const config = baseConfig({
    agents: { defaults: { workspace, restrict_to_workspace: true, model_name: 'x' } },
    tools: baseTools({ allow_read_paths: ['/etc/passwd'] }),
  });
  assert.throws(
    () => checkRules(config, { env: {}, argv: [], packageRoot: root }),
    refusal(2, /does not resolve inside the workspace/)
  );
  rmSync(root, { recursive: true, force: true });
});

test('rule 3: gateway.host must be loopback', () => {
  const config = baseConfig({ gateway: { host: '0.0.0.0', port: 18790 } });
  assert.throws(() => checkRules(config, { env: {}, argv: [] }), refusal(3));
});

test('rule 4: PICOCLAW_GATEWAY_HOST set to a non-loopback value is refused', () => {
  const config = baseConfig();
  assert.throws(
    () => checkRules(config, { env: { PICOCLAW_GATEWAY_HOST: '0.0.0.0' }, argv: [] }),
    refusal(4, /PICOCLAW_GATEWAY_HOST/)
  );
});

test("rule 4: -public on PicoClaw's own argv is refused", () => {
  const config = baseConfig();
  assert.throws(
    () => checkRules(config, { env: {}, argv: ['agent', '-m', 'x', '-public'] }),
    refusal(4, /-public/)
  );
});

test('rule 5: an http server with no url is refused', () => {
  const config = baseConfig({
    tools: baseTools({ mcp: { enabled: true, servers: { weir: { type: 'http' } } } }),
  });
  assert.throws(() => checkRules(config, { env: {}, argv: [] }), refusal(5, /has no "url"/));
});

test('rule 5: an unparsable url is refused', () => {
  const config = baseConfig({
    tools: baseTools({ mcp: { enabled: true, servers: { weir: { type: 'http', url: 'not a url' } } } }),
  });
  assert.throws(() => checkRules(config, { env: {}, argv: [] }), refusal(5, /unparsable url/));
});

test('rule 5: a loopback server over https: (not http:) is refused', () => {
  const config = baseConfig({
    tools: baseTools({ mcp: { enabled: true, servers: { local: { type: 'http', url: 'https://127.0.0.1:8080/mcp' } } } }),
  });
  assert.throws(() => checkRules(config, { env: {}, argv: [] }), refusal(5, /loopback is allowed only over http:/));
});

test('rule 5 (finding B4): an http MCP server on http: (not https:) to an allow-listed host is refused', () => {
  const config = baseConfig({
    tools: baseTools({ mcp: { enabled: true, servers: { weir: { type: 'http', url: 'http://mcp.weir.social/mcp' } } } }),
  });
  assert.throws(() => checkRules(config, { env: {}, argv: [] }), refusal(5, /not https:/));
});

test('rule 5: an MCP server whose URL host is not allow-listed is refused', () => {
  const config = baseConfig({
    tools: baseTools({ mcp: { enabled: true, servers: { evil: { type: 'sse', url: 'https://evil.example/mcp' } } } }),
  });
  assert.throws(() => checkRules(config, { env: {}, argv: [] }), refusal(5, /on neither the allow-list/));
});

test('rule 5: a stdio command that is not an absolute path is refused', () => {
  const config = withStdioServer({ type: 'stdio', command: 'weir-mcp' });
  assert.throws(() => checkRules(config, { env: {}, argv: [] }), refusal(5, /not an absolute path/));
});

test('rule 5 (hole A, CTO §2.7a): an interpreter command is refused even when it is pinned and its hash matches', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'agent-runtime-stdio-'));
  const nodeLike = shippedExecutable(dir, 'node');
  const config = withStdioServer({ type: 'stdio', command: nodeLike.path, args: ['/tmp/x.js', '--mode', 'stdio'] });
  assert.throws(
    () => checkRules(config, { env: {}, argv: [], allowedStdio: new Map([[nodeLike.path, nodeLike.sha256]]) }),
    refusal(5, /is an interpreter/)
  );
  rmSync(dir, { recursive: true, force: true });
});

test('rule 5 (hole A): every interpreter basename the runtime knows is refused', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'agent-runtime-stdio-'));
  const names = ['node', 'nodejs', 'node22', 'sh', 'bash', 'dash', 'zsh', 'ksh', 'python3', 'python3.12', 'perl', 'ruby', 'php', 'tsx', 'deno', 'bun', 'env'];
  for (const name of names) {
    const shipped = shippedExecutable(dir, name);
    const config = withStdioServer({ type: 'stdio', command: shipped.path });
    assert.throws(
      () => checkRules(config, { env: {}, argv: [], allowedStdio: new Map([[shipped.path, shipped.sha256]]) }),
      refusal(5, /is an interpreter/),
      `${name} was not refused as an interpreter`
    );
  }
  rmSync(dir, { recursive: true, force: true });
});

test('rule 5 (hole A): non-empty args on a correctly pinned stdio server are refused', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'agent-runtime-stdio-'));
  const shipped = shippedExecutable(dir, 'weir-mcp');
  const config = withStdioServer({ type: 'stdio', command: shipped.path, args: ['--mode', 'stdio'] });
  assert.throws(
    () => checkRules(config, { env: {}, argv: [], allowedStdio: new Map([[shipped.path, shipped.sha256]]) }),
    refusal(5, /args must be absent or empty/)
  );
  rmSync(dir, { recursive: true, force: true });
});

test('rule 5 (hole A): a non-empty env on a correctly pinned stdio server is refused', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'agent-runtime-stdio-'));
  const shipped = shippedExecutable(dir, 'weir-mcp');
  const config = withStdioServer({ type: 'stdio', command: shipped.path, env: { OPENROUTER_API_KEY: 'sk-or-x' } });
  assert.throws(
    () => checkRules(config, { env: {}, argv: [], allowedStdio: new Map([[shipped.path, shipped.sha256]]) }),
    refusal(5, /env must be absent or empty/)
  );
  rmSync(dir, { recursive: true, force: true });
});

test('rule 5: a stdio MCP server not on the shipped allow-list is refused', () => {
  const config = withStdioServer({ type: 'stdio', command: '/usr/local/bin/some-tool' });
  assert.throws(() => checkRules(config, { env: {}, argv: [] }), refusal(5, /not in the shipped stdio allow-list/));
});

test('rule 5: an allow-listed stdio command that is not on disk is refused', () => {
  const missing = path.join(os.tmpdir(), 'agent-runtime-no-such-binary');
  const config = withStdioServer({ type: 'stdio', command: missing });
  assert.throws(
    () => checkRules(config, { env: {}, argv: [], allowedStdio: new Map([[missing, 'f'.repeat(64)]]) }),
    refusal(5, /does not exist on disk/)
  );
});

test('rule 5: an allow-listed stdio command whose bytes were changed is refused', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'agent-runtime-stdio-'));
  const shipped = shippedExecutable(dir, 'weir-mcp');
  writeFileSync(shipped.path, 'ELF-not-really-but-edited\n');
  const config = withStdioServer({ type: 'stdio', command: shipped.path });
  assert.throws(
    () => checkRules(config, { env: {}, argv: [], allowedStdio: new Map([[shipped.path, shipped.sha256]]) }),
    refusal(5, /does not \n?match the shipped|does not match the shipped/)
  );
  rmSync(dir, { recursive: true, force: true });
});

test('rule 5 (finding B4): a bash -c MCP server with no recognised type is refused', () => {
  const config = withStdioServer({ enabled: true, command: 'bash', args: ['-c', 'echo hi'] });
  assert.throws(() => checkRules(config, { env: {}, argv: [] }), refusal(5, /which is not "http", "sse" or/));
});

test('rule 6 (finding B6): tools.install_skill.enabled true is refused', () => {
  const config = baseConfig({ tools: baseTools({ install_skill: { enabled: true } }) });
  assert.throws(() => checkRules(config, { env: {}, argv: [] }), refusal(6, /install_skill/));
});

test('rule 6 (finding B6): tools.find_skills.enabled true is refused', () => {
  const config = baseConfig({ tools: baseTools({ find_skills: { enabled: true } }) });
  assert.throws(() => checkRules(config, { env: {}, argv: [] }), refusal(6, /find_skills/));
});

test('rule 6 (finding B6): an enabled skills registry is refused', () => {
  const config = baseConfig({
    tools: baseTools({ skills: { enabled: true, registries: { clawhub: { enabled: true }, github: { enabled: false } } } }),
  });
  assert.throws(() => checkRules(config, { env: {}, argv: [] }), refusal(6, /registries\.clawhub/));
});

test('rule 6 (finding B6): a bare file in skills/ (not a directory) is refused', () => {
  const { root, workspace } = makeWorkspace({ skillFiles: ['evil.md'] });
  const config = baseConfig({ agents: { defaults: { workspace, restrict_to_workspace: true, model_name: 'x' } } });
  assert.throws(() => checkRules(config, { env: {}, argv: [], packageRoot: root }), refusal(6, /is not a directory/));
  rmSync(root, { recursive: true, force: true });
});

test('rule 6: an unshipped skill directory in the workspace is refused', () => {
  const { root, workspace } = makeWorkspace({ skillDirs: ['weir-agent', 'mystery-skill'] });
  const config = baseConfig({ agents: { defaults: { workspace, restrict_to_workspace: true, model_name: 'x' } } });
  assert.throws(
    () => checkRules(config, { env: {}, argv: [], packageRoot: root }),
    refusal(6, /is not in the shipped list/)
  );
  rmSync(root, { recursive: true, force: true });
});

test('rule 7: a non-empty channel_list is refused', () => {
  const config = baseConfig({ channel_list: { telegram: { enabled: false, type: 'telegram' } } });
  assert.throws(() => checkRules(config, { env: {}, argv: [] }), refusal(7));
});

test('rule 8: hooks.enabled true is refused', () => {
  const config = baseConfig({ hooks: { enabled: true } });
  assert.throws(() => checkRules(config, { env: {}, argv: [] }), refusal(8, /hooks\.enabled/));
});

test('rule 8: a non-empty hooks.entries is refused', () => {
  const config = baseConfig({ hooks: { enabled: false, entries: [{ on: 'turn', run: 'x' }] } });
  assert.throws(() => checkRules(config, { env: {}, argv: [] }), refusal(8, /hooks\.entries/));
});

test('rule 8: tools.cron.enabled true is refused', () => {
  const config = baseConfig({ tools: baseTools({ cron: { enabled: true } }) });
  assert.throws(() => checkRules(config, { env: {}, argv: [] }), refusal(8, /tools\.cron\.enabled/));
});

test('rule 8: a job file in the workspace cron store is refused', () => {
  const { root, workspace } = makeWorkspace({ cronFiles: ['job-1.json'] });
  const config = baseConfig({ agents: { defaults: { workspace, restrict_to_workspace: true, model_name: 'x' } } });
  assert.throws(() => checkRules(config, { env: {}, argv: [], packageRoot: root }), refusal(8, /cron store/));
  rmSync(root, { recursive: true, force: true });
});

test('rule 9 (finding B5): a model_list that is not an array is refused rather than skipped', () => {
  const config = baseConfig({ model_list: { 'route-normal': { api_base: 'https://evil.example/v1' } } });
  assert.throws(() => checkRules(config, { env: {}, argv: [] }), refusal(9, /must be an array/));
});

test('rule 9 (finding B5): a model with no api_base and a non-openrouter provider is refused', () => {
  const config = baseConfig({ model_list: [{ model_name: 'route-critical', provider: 'ollama', model: 'x' }] });
  assert.throws(() => checkRules(config, { env: {}, argv: [] }), refusal(9, /has no api_base/));
});

test('rule 9 (finding B5): an unparsable api_base is refused', () => {
  const config = baseConfig({
    model_list: [{ model_name: 'route-critical', provider: 'ollama', model: 'x', api_base: 'not a url' }],
  });
  assert.throws(() => checkRules(config, { env: {}, argv: [] }), refusal(9, /unparsable api_base/));
});

test('rule 9 (finding B5): a local model host over https: (not http:) is refused', () => {
  const config = baseConfig({
    model_list: [{ model_name: 'route-critical', provider: 'ollama', model: 'x', api_base: 'https://127.0.0.1:11434/v1' }],
  });
  assert.throws(() => checkRules(config, { env: {}, argv: [] }), refusal(9, /is local but scheme is/));
});

test('rule 9 (finding B5): an allow-listed model host over http: (not https:) is refused', () => {
  const config = baseConfig({
    model_list: [{ model_name: 'route-normal', provider: 'openrouter', model: 'x', api_base: 'http://openrouter.ai/v1' }],
  });
  assert.throws(() => checkRules(config, { env: {}, argv: [] }), refusal(9, /not https:/));
});

test('rule 9 (finding B5): a model api_base host not on the allow-list is refused', () => {
  const config = baseConfig({
    model_list: [{ model_name: 'route-critical', provider: 'custom', model: 'x', api_base: 'https://evil.example/v1' }],
  });
  assert.throws(() => checkRules(config, { env: {}, argv: [] }), refusal(9, /on neither the allow-list/));
});

test('rule 10 (finding A4): a .security.yml key path off the shipped allow-list is refused', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'agent-runtime-test-'));
  writeFileSync(path.join(root, '.security.yml'), 'channels:\n  telegram:\n    token: "abc"\n');
  assert.throws(
    () => checkRules(baseConfig(), { env: {}, argv: [], packageRoot: root }),
    refusal(10, /is not on this package's shipped/)
  );
  rmSync(root, { recursive: true, force: true });
});

test('rule 10 (finding A4): an unparseable .security.yml is refused, not ignored — a line with no key', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'agent-runtime-test-'));
  writeFileSync(path.join(root, '.security.yml'), 'this line has no colon\n');
  assert.throws(
    () => checkRules(baseConfig(), { env: {}, argv: [], packageRoot: root }),
    refusal(10, /could not be parsed/)
  );
  rmSync(root, { recursive: true, force: true });
});

test('rule 10 (finding A4): an unparseable .security.yml is refused — a list item with no enclosing key', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'agent-runtime-test-'));
  writeFileSync(path.join(root, '.security.yml'), '- "sk-or-loose"\n');
  assert.throws(
    () => checkRules(baseConfig(), { env: {}, argv: [], packageRoot: root }),
    refusal(10, /list item with no enclosing key/)
  );
  rmSync(root, { recursive: true, force: true });
});

test('rule 10 (finding A4): the one shipped key path is allowed', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'agent-runtime-test-'));
  writeFileSync(path.join(root, '.security.yml'), 'model_list:\n  route-normal:\n    api_keys:\n      - "sk-or-example"\n');
  assert.doesNotThrow(() => checkRules(baseConfig(), { env: {}, argv: [], packageRoot: root }));
  rmSync(root, { recursive: true, force: true });
});

test('rule 10 (finding A4): no .security.yml at all is allowed', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'agent-runtime-test-'));
  assert.doesNotThrow(() => checkRules(baseConfig(), { env: {}, argv: [], packageRoot: root }));
  rmSync(root, { recursive: true, force: true });
});

test('rule 10: the .security.yml reader names the leaf key paths a file sets', () => {
  const paths = parseSecurityYmlKeyPaths('model_list:\n  route-normal:\n    api_keys:\n      - "sk"\n');
  assert.deepEqual([...paths], ['model_list.route-normal.api_keys']);
});

test('loader: a missing config file is refused', () => {
  assert.throws(
    () => loadConfig(path.join(os.tmpdir(), 'agent-runtime-no-such-config.json')),
    /config not found at/
  );
});

test('loader: a config that is not valid JSON is refused', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'agent-runtime-test-'));
  const file = path.join(root, 'config.json');
  writeFileSync(file, '{ not json');
  assert.throws(() => loadConfig(file), /is not valid JSON/);
  rmSync(root, { recursive: true, force: true });
});

test('loader: a config that is valid JSON but not an object is refused', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'agent-runtime-test-'));
  const file = path.join(root, 'config.json');
  writeFileSync(file, '["evolution"]');
  assert.throws(() => loadConfig(file), /is not a JSON object/);
  rmSync(root, { recursive: true, force: true });
});

function refusalsPerRuleFromSource(): Map<number, number> {
  const source = readFileSync(path.join(import.meta.dirname, '..', 'bin', 'check-rules.ts'), 'utf8');
  const counts = new Map<number, number>();
  for (const match of source.matchAll(/throw new RuleViolation\(\s*(\d+)/g)) {
    const rule = Number(match[1]);
    counts.set(rule, (counts.get(rule) ?? 0) + 1);
  }
  return counts;
}

function refusalsPerRuleFromReadme(): Map<number, number> {
  const readme = readFileSync(path.join(import.meta.dirname, '..', 'README.md'), 'utf8');
  const start = readme.indexOf('## What it refuses');
  assert.ok(start !== -1, 'the README has no "What it refuses" section');
  const end = readme.indexOf('\n## ', start + 1);
  const section = readme.slice(start, end === -1 ? undefined : end);

  const claims = new Map<number, number>();
  const itemStarts = [...section.matchAll(/^(\d{1,2})\. /gm)];
  for (const [index, item] of itemStarts.entries()) {
    const from = item.index;
    const next = itemStarts[index + 1];
    const text = section.slice(from, next === undefined ? undefined : next.index);
    const claim = /—\s+(\d+)\s+refusals?\./.exec(text);
    assert.ok(claim !== null, `README rule ${item[1] as string} states no refusal count`);
    claims.set(Number(item[1]), Number(claim[1]));
  }
  return claims;
}

test('the README states, for every rule, the number of refusals the checker actually has', () => {
  const source = refusalsPerRuleFromSource();
  const readme = refusalsPerRuleFromReadme();
  assert.deepEqual([...readme.keys()].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  for (const rule of readme.keys()) {
    assert.equal(readme.get(rule), source.get(rule), `README rule ${rule} claims the wrong count`);
  }
});

test('the README states the right total, and it is the forty this package ships', () => {
  const total = [...refusalsPerRuleFromSource().values()].reduce((a, b) => a + b, 0);
  assert.equal(total, 40);
  const readme = readFileSync(path.join(import.meta.dirname, '..', 'README.md'), 'utf8');
  assert.ok(readme.includes(`**${total} separate refusals**`), `the README does not state ${total} refusals`);
});

test('every rule number that appears in the checker also appears in the README list', () => {
  const source = refusalsPerRuleFromSource();
  const readme = refusalsPerRuleFromReadme();
  for (const rule of source.keys()) {
    assert.ok(readme.has(rule), `rule ${rule} has refusals in the checker but no line in the README`);
  }
});

test('the shipped config template passes every rule against the shipped workspace', () => {
  const packageRoot = path.resolve(import.meta.dirname, '..');
  const templatePath = path.join(packageRoot, 'picoclaw', 'config.template.json');
  const template = loadConfig(templatePath);
  const config = {
    ...template,
    agents: { defaults: { workspace: path.join(packageRoot, 'picoclaw', 'workspace'), restrict_to_workspace: true } },
  };
  assert.doesNotThrow(() => checkRules(config, { env: {}, argv: ['agent', '-m', 'x'], packageRoot }));
});
