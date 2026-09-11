// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { access, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { directive, parseUnit } from '../src/units.js';
import { CHAIN, PACKAGE, temporaryDirectory } from './helpers.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const UNIT = join(HERE, '..', 'systemd', 'heron-purse.service');

const SDK_ENTRY = pathToFileURL(
  join(HERE, '..', 'node_modules', '@projectx-social', 'sdk', 'dist', 'index.js'),
).href;

interface ExecStart {
  readonly interpreter: string;
  readonly flags: readonly string[];
  readonly script: string;
}

function execStart(text: string): ExecStart {
  const line = directive(parseUnit(text), 'Service', 'ExecStart').join(' ');
  const tokens = line.split(' ').filter((token) => token !== '');
  const script = tokens.findIndex((token) => token.endsWith('.js'));
  expect(script, `ExecStart names no script: ${line}`).toBeGreaterThan(0);
  return {
    interpreter: tokens[0]!,
    flags: tokens.slice(1, script),
    script: tokens[script]!,
  };
}

const CHILD = `
const causes = (error) => {
  const out = [];
  let current = error;
  while (current !== undefined && current !== null && out.length < 8) {
    out.push(\`\${current?.constructor?.name ?? typeof current}: \${String(current?.message ?? current)}\`);
    current = current.cause;
  }
  return out;
};

const report = {
  execArgv: process.execArgv,
  version: process.version,
  webAssembly: typeof WebAssembly,
  constructed: false,
  reachedTransport: false,
  failure: [],
};

try {
  const { createClient } = await import(process.argv[2]);
  const client = createClient(JSON.parse(process.argv[3]));
  report.constructed = typeof client.simulateTransaction === 'function';
  try {
    await client.getObject({ objectId: process.argv[4], include: { content: true } });
    report.reachedTransport = true;
  } catch (error) {
    // Reaching the transport and being refused by it IS the pass. The refusal is described, not
    // swallowed, so the assertion below can tell a name lookup apart from a missing runtime.
    report.reachedTransport = true;
    report.failure = causes(error);
  }
} catch (error) {
  report.failure = causes(error);
}

process.stdout.write(JSON.stringify(report));
`;

interface Report {
  readonly execArgv: readonly string[];
  readonly version: string;
  readonly webAssembly: string;
  readonly constructed: boolean;
  readonly reachedTransport: boolean;
  readonly failure: readonly string[];
}

interface Run {
  readonly report: Report | null;
  readonly runtime: string;
  readonly named: string;
  readonly measuredTheUnitsRuntime: boolean;
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function runUnderUnitFlags(): Promise<Run> {
  const { interpreter, flags } = execStart(await readFile(UNIT, 'utf8'));
  const present = await exists(interpreter);
  const runtime = present ? interpreter : process.execPath;

  const dir = await temporaryDirectory('heron-purse-smoke-');
  const childPath = join(dir, 'construct-client.mjs');
  await writeFile(childPath, CHILD, 'utf8');

  const config = JSON.stringify({
    network: CHAIN.network,
    grpcUrl: CHAIN.grpcUrl,
    packageId: CHAIN.packageId,
    latestPackageId: CHAIN.latestPackageId,
    platformId: CHAIN.platformId,
    registryId: CHAIN.registryId,
  });

  return new Promise<Run>((resolve) => {
    execFile(
      runtime,
      [...flags, childPath, SDK_ENTRY, config, PACKAGE],
      { timeout: 60_000, maxBuffer: 4 * 1024 * 1024 },
      (error, stdout, stderr) => {
        let report: Report | null = null;
        try {
          report = JSON.parse(stdout) as Report;
        } catch {
          // Left null. The assertions report the raw streams, which is what a child that died
          // before it could answer leaves behind.
        }
        const code = error === null ? 0 : ((error as { code?: number }).code ?? null);
        resolve({
          report,
          runtime,
          named: interpreter,
          measuredTheUnitsRuntime: present && runtime === interpreter,
          code,
          stdout,
          stderr,
        });
      },
    );
  });
}

let once: Promise<Run> | undefined;
function theRun(): Promise<Run> {
  once ??= runUnderUnitFlags();
  return once;
}

function transcript(run: Run): string {
  return [
    `runtime: ${run.runtime}`,
    `unit names: ${run.named}`,
    `node: ${run.report?.version ?? 'unknown'}`,
    `exit: ${String(run.code)}`,
    `WebAssembly: ${run.report?.webAssembly ?? 'unknown'}`,
    `failure: ${(run.report?.failure ?? []).join(' <- ') || '(none)'}`,
    `stderr: ${run.stderr.trim() || '(empty)'}`,
  ].join('\n');
}

const NAMES_WEBASSEMBLY = /WebAssembly|WASM/i;

describe('the real chain client, under the unit\'s own node flags', () => {
  it('is constructed and reaches the transport, and never dies on a missing WebAssembly', async () => {
    const run = await theRun();
    const detail = transcript(run);

    expect(run.report, `the child wrote no report.\n${detail}\nstdout: ${run.stdout}`).not.toBeNull();
    const report = run.report!;
    expect(run.code, `the child exited non-zero.\n${detail}`).toBe(0);

    const { flags } = execStart(await readFile(UNIT, 'utf8'));
    expect(report.execArgv, `the unit's flags did not reach the child.\n${detail}`).toEqual([
      ...flags,
    ]);

    expect(report.constructed, `createClient did not produce a usable client.\n${detail}`).toBe(true);
    expect(report.reachedTransport, `the client never attempted a request.\n${detail}`).toBe(true);

    for (const cause of report.failure) {
      expect(
        NAMES_WEBASSEMBLY.test(cause),
        `the client failed on WebAssembly, not on the network — this is the crash the purse ` +
          `died of on 2026-09-05, and the unit's flags reproduce it.\n${detail}`,
      ).toBe(false);
    }
    expect(
      NAMES_WEBASSEMBLY.test(run.stderr),
      `the child printed a WebAssembly failure.\n${detail}`,
    ).toBe(false);
  }, 90_000);

  it('ran on the interpreter the unit names, so this suite measured the droplet\'s runtime', async () => {
    const run = await theRun();

    expect(
      run.measuredTheUnitsRuntime,
      [
        'NOT MEASURED: the crash this file exists for was not exercised on this host.',
        '',
        `The unit's ExecStart names ${run.named}; this host does not have it, so the child ran on`,
        `${run.runtime} (${run.report?.version ?? 'unknown'}) instead.`,
        '',
        'What that leaves unmeasured: --jitless removes WebAssembly from every node, but only a node',
        "whose HTTP parser is a WebAssembly module dies of it. That is node 22 — the version the unit",
        'names. From node 24 the parser is native, so fetch survives the flag and the droplet crash of',
        "2026-09-05 cannot reproduce here. The preceding test's green describes this laptop's runtime",
        'and vouches for no other.',
        '',
        'How to measure it — either is sufficient:',
        `  1. Install the runtime the unit names, at that exact path, and re-run:`,
        `       curl -fsSLO https://nodejs.org/dist/v22.x.y/node-v22.x.y-<platform>.tar.xz`,
        `       # verify against SHASUMS256.txt, then unpack so that ${run.named} exists`,
        '       pnpm --filter @projectx-social/purse test',
        '  2. Or run this suite on the droplet, where /opt/node22/bin/node is what systemd starts.',
        '',
        'Do not delete this assertion to get a green suite. A check that cannot fail is not a check.',
      ].join('\n'),
    ).toBe(true);

    const version = run.report?.version ?? '';
    expect(
      /^v22\./.test(version),
      `${run.named} exists but reports ${version || 'no version'}. The unit installs node 22 there ` +
        `because @mysten/sui requires it and because 22's HTTP parser is the WebAssembly one this ` +
        `test is about. A different major at that path measures a different runtime under the ` +
        `unit's own name.`,
    ).toBe(true);
  }, 90_000);
});
