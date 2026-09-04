// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
//
// One failing fixture per rule (1-10) and one passing fixture, against bin/check-rules.mjs.
// Rules 1-4, 7-8 are the council's eight (minus 5-6, rewritten below); rule 5 is now an
// allow-list (finding B4), rule 6 also asserts the skill-install switches (finding B6), rule 2
// also asserts exec/web/spawn/subagent/heartbeat/read-write-paths (finding A8), rule 9 is the
// model api_base allow-list (finding B5), and rule 10 is the .security.yml key-path allow-list
// (finding A4).
// Run: node --test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkRules, RuleViolation } from '../bin/check-rules.mjs';

function baseConfig(overrides = {}) {
  const config = {
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
      { model_name: 'route-critical', provider: 'ollama', model: 'ollama/x', api_base: 'http://host.docker.internal:11434/v1' },
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
  return { ...config, ...overrides };
}

function makeWorkspace({ skillDirs = ['weir-agent'], skillFiles = [], cronFiles = [] } = {}) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'agent-runtime-test-'));
  const workspace = path.join(root, 'workspace');
  const skillsDir = path.join(workspace, 'skills');
  mkdirSync(skillsDir, { recursive: true });
  for (const dir of skillDirs) {
    mkdirSync(path.join(skillsDir, dir), { recursive: true });
    writeFileSync(path.join(skillsDir, dir, 'SKILL.md'), '---\nname: ' + dir + '\ndescription: test\n---\n');
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

test('passing fixture: a config satisfying every rule does not throw', () => {
  const { root, workspace } = makeWorkspace();
  const config = baseConfig({
    agents: { defaults: { workspace, restrict_to_workspace: true, model_name: 'route-critical' } },
  });
  assert.doesNotThrow(() => checkRules(config, { env: {}, argv: [], packageRoot: root }));
  rmSync(root, { recursive: true, force: true });
});

test('rule 1: evolution.enabled must be exactly false', () => {
  const config = baseConfig({ evolution: { enabled: true, mode: 'observe' } });
  assert.throws(() => checkRules(config, { env: {}, argv: [] }), (err) => {
    assert.ok(err instanceof RuleViolation);
    assert.equal(err.ruleNumber, 1);
    return true;
  });
});

test('rule 1: evolution.mode "apply" with enabled true also refused', () => {
  const config = baseConfig({ evolution: { enabled: true, mode: 'apply' } });
  assert.throws(() => checkRules(config, { env: {}, argv: [] }), (err) => err.ruleNumber === 1);
});

test('rule 2: restrict_to_workspace must be exactly true', () => {
  const config = baseConfig({
    agents: { defaults: { workspace: './workspace', restrict_to_workspace: false, model_name: 'x' } },
  });
  assert.throws(() => checkRules(config, { env: {}, argv: [] }), (err) => err.ruleNumber === 2);
});

test('rule 2 (finding A8): tools.exec.enabled true is refused', () => {
  const config = baseConfig({ tools: { ...baseConfig().tools, exec: { enabled: true } } });
  assert.throws(() => checkRules(config, { env: {}, argv: [] }), (err) => err.ruleNumber === 2);
});

test('rule 2 (finding A8): heartbeat.enabled true is refused', () => {
  const config = baseConfig({ heartbeat: { enabled: true } });
  assert.throws(() => checkRules(config, { env: {}, argv: [] }), (err) => err.ruleNumber === 2);
});

test('rule 2 (finding A8): an allow_read_paths entry outside the workspace is refused', () => {
  const { root, workspace } = makeWorkspace();
  const config = baseConfig({
    agents: { defaults: { workspace, restrict_to_workspace: true, model_name: 'x' } },
    tools: { ...baseConfig().tools, allow_read_paths: ['/etc/passwd'] },
  });
  assert.throws(() => checkRules(config, { env: {}, argv: [], packageRoot: root }), (err) => err.ruleNumber === 2);
  rmSync(root, { recursive: true, force: true });
});

test('rule 3: gateway.host must be loopback', () => {
  const config = baseConfig({ gateway: { host: '0.0.0.0', port: 18790 } });
  assert.throws(() => checkRules(config, { env: {}, argv: [] }), (err) => err.ruleNumber === 3);
});

test('rule 4: PICOCLAW_GATEWAY_HOST set to a non-loopback value is refused', () => {
  const config = baseConfig();
  assert.throws(
    () => checkRules(config, { env: { PICOCLAW_GATEWAY_HOST: '0.0.0.0' }, argv: [] }),
    (err) => err.ruleNumber === 4
  );
});

test('rule 4: -public on PicoClaw\'s own argv is refused', () => {
  const config = baseConfig();
  assert.throws(
    () => checkRules(config, { env: {}, argv: ['agent', '-m', 'x', '-public'] }),
    (err) => err.ruleNumber === 4
  );
});

test('rule 5 (finding B4): a bash -c MCP server with no recognised type is refused', () => {
  const config = baseConfig({
    tools: {
      ...baseConfig().tools,
      mcp: {
        enabled: true,
        servers: { shell: { enabled: true, command: 'bash', args: ['-c', 'echo hi'] } },
      },
    },
  });
  assert.throws(() => checkRules(config, { env: {}, argv: [] }), (err) => err.ruleNumber === 5);
});

test('rule 5 (finding B4): an http MCP server on http: (not https:) to an allow-listed host is refused', () => {
  const config = baseConfig({
    tools: {
      ...baseConfig().tools,
      mcp: {
        enabled: true,
        servers: { weir: { enabled: true, type: 'http', url: 'http://mcp.weir.social/mcp' } },
      },
    },
  });
  assert.throws(() => checkRules(config, { env: {}, argv: [] }), (err) => err.ruleNumber === 5);
});

test('rule 5: an MCP server whose URL host is not allow-listed is refused', () => {
  const config = baseConfig({
    tools: {
      ...baseConfig().tools,
      mcp: {
        enabled: true,
        servers: { evil: { enabled: true, type: 'http', url: 'https://evil.example/mcp' } },
      },
    },
  });
  assert.throws(() => checkRules(config, { env: {}, argv: [] }), (err) => err.ruleNumber === 5);
});

test('rule 5: a stdio MCP server not on the shipped allow-list is refused', () => {
  const config = baseConfig({
    tools: {
      ...baseConfig().tools,
      mcp: {
        enabled: true,
        servers: { local: { enabled: true, type: 'stdio', command: '/usr/local/bin/some-tool' } },
      },
    },
  });
  assert.throws(() => checkRules(config, { env: {}, argv: [] }), (err) => err.ruleNumber === 5);
});

test('rule 6: an unshipped skill directory in the workspace is refused', () => {
  const { root, workspace } = makeWorkspace({ skillDirs: ['weir-agent', 'mystery-skill'] });
  const config = baseConfig({ agents: { defaults: { workspace, restrict_to_workspace: true, model_name: 'x' } } });
  assert.throws(() => checkRules(config, { env: {}, argv: [], packageRoot: root }), (err) => err.ruleNumber === 6);
  rmSync(root, { recursive: true, force: true });
});

test('rule 6 (finding B6): a bare file in skills/ (not a directory) is refused', () => {
  const { root, workspace } = makeWorkspace({ skillFiles: ['evil.md'] });
  const config = baseConfig({ agents: { defaults: { workspace, restrict_to_workspace: true, model_name: 'x' } } });
  assert.throws(() => checkRules(config, { env: {}, argv: [], packageRoot: root }), (err) => err.ruleNumber === 6);
  rmSync(root, { recursive: true, force: true });
});

test('rule 6 (finding B6): tools.install_skill.enabled true is refused', () => {
  const config = baseConfig({ tools: { ...baseConfig().tools, install_skill: { enabled: true } } });
  assert.throws(() => checkRules(config, { env: {}, argv: [] }), (err) => err.ruleNumber === 6);
});

test('rule 6 (finding B6): tools.find_skills.enabled true is refused', () => {
  const config = baseConfig({ tools: { ...baseConfig().tools, find_skills: { enabled: true } } });
  assert.throws(() => checkRules(config, { env: {}, argv: [] }), (err) => err.ruleNumber === 6);
});

test('rule 6 (finding B6): an enabled skills registry is refused', () => {
  const config = baseConfig({
    tools: {
      ...baseConfig().tools,
      skills: { enabled: true, registries: { clawhub: { enabled: true }, github: { enabled: false } } },
    },
  });
  assert.throws(() => checkRules(config, { env: {}, argv: [] }), (err) => err.ruleNumber === 6);
});

test('rule 7: a non-empty channel_list is refused', () => {
  const config = baseConfig({ channel_list: { telegram: { enabled: false, type: 'telegram' } } });
  assert.throws(() => checkRules(config, { env: {}, argv: [] }), (err) => err.ruleNumber === 7);
});

test('rule 8: hooks.enabled true is refused', () => {
  const config = baseConfig({ hooks: { enabled: true } });
  assert.throws(() => checkRules(config, { env: {}, argv: [] }), (err) => err.ruleNumber === 8);
});

test('rule 8: tools.cron.enabled true is refused', () => {
  const config = baseConfig({ tools: { ...baseConfig().tools, cron: { enabled: true } } });
  assert.throws(() => checkRules(config, { env: {}, argv: [] }), (err) => err.ruleNumber === 8);
});

test('rule 8: a job file in the workspace cron store is refused', () => {
  const { root, workspace } = makeWorkspace({ cronFiles: ['job-1.json'] });
  const config = baseConfig({ agents: { defaults: { workspace, restrict_to_workspace: true, model_name: 'x' } } });
  assert.throws(() => checkRules(config, { env: {}, argv: [], packageRoot: root }), (err) => err.ruleNumber === 8);
  rmSync(root, { recursive: true, force: true });
});

test('rule 9 (finding B5): a model api_base host not on the allow-list is refused', () => {
  const config = baseConfig({
    model_list: [{ model_name: 'route-critical', provider: 'custom', model: 'x', api_base: 'https://evil.example/v1' }],
  });
  assert.throws(() => checkRules(config, { env: {}, argv: [] }), (err) => err.ruleNumber === 9);
});

test('rule 9 (finding B5): a model with no api_base and a non-openrouter provider is refused', () => {
  const config = baseConfig({
    model_list: [{ model_name: 'route-critical', provider: 'ollama', model: 'x' }],
  });
  assert.throws(() => checkRules(config, { env: {}, argv: [] }), (err) => err.ruleNumber === 9);
});

test('rule 9 (finding B5): an allow-listed model host over http: (not https:) is refused', () => {
  const config = baseConfig({
    model_list: [{ model_name: 'route-normal', provider: 'openrouter', model: 'x', api_base: 'http://openrouter.ai/v1' }],
  });
  assert.throws(() => checkRules(config, { env: {}, argv: [] }), (err) => err.ruleNumber === 9);
});

test('rule 10 (finding A4): a .security.yml key path off the shipped allow-list is refused', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'agent-runtime-test-'));
  writeFileSync(
    path.join(root, '.security.yml'),
    'channels:\n  telegram:\n    token: "abc"\n'
  );
  const config = baseConfig();
  assert.throws(() => checkRules(config, { env: {}, argv: [], packageRoot: root }), (err) => err.ruleNumber === 10);
  rmSync(root, { recursive: true, force: true });
});

test('rule 10 (finding A4): the one shipped key path is allowed', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'agent-runtime-test-'));
  writeFileSync(
    path.join(root, '.security.yml'),
    'model_list:\n  route-normal:\n    api_keys:\n      - "sk-or-example"\n'
  );
  const config = baseConfig();
  assert.doesNotThrow(() => checkRules(config, { env: {}, argv: [], packageRoot: root }));
  rmSync(root, { recursive: true, force: true });
});

test('rule 10 (finding A4): no .security.yml at all is allowed', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'agent-runtime-test-'));
  const config = baseConfig();
  assert.doesNotThrow(() => checkRules(config, { env: {}, argv: [], packageRoot: root }));
  rmSync(root, { recursive: true, force: true });
});
