// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
/**
 * A real `SuiGrpcClient`, built by the real `createClient`, in a real node process started with the
 * flags the unit's own ExecStart carries. No fixture, no double, no recorded response.
 *
 * # The hole this fills
 *
 * `src/server.ts` reads its client as `args.recorded?.client ?? createClient(chain.value)`, and
 * every suite in this package supplies `recorded`. That seam is right — the other tests are about
 * the decision, and a decision test must not depend on a fullnode — but it means the expression on
 * the right of the `??` had never been evaluated by a test, on any node, under any flags. The whole
 * suite was green while the purse's first PAID post on the droplet died the moment it tried to
 * simulate, because `--jitless` in the unit removes `WebAssembly` from the runtime and node 22's
 * fetch parses HTTP with a WebAssembly build of llhttp. Every check the estate had asserted the
 * flag was PRESENT; `units.test.ts` defended the defect it was supposed to catch.
 *
 * A test that mocks the client cannot see this, and neither can a test that reads the unit file:
 * the failure is not in the argv and not in the code, it is in what the argv leaves of the runtime
 * the code needs. The only thing that sees it is a process started the way systemd starts it, with
 * the real client in it. That is all this file does.
 *
 * # Pass and fail, stated precisely, because the network is not a condition of this test
 *
 *   PASS  the client is constructed and gets far enough to attempt a request, and the request fails
 *         on DNS or on the connection. `CHAIN.grpcUrl` is `.invalid`, a TLD the DNS root guarantees
 *         will never resolve, so the reachable outcome is exactly the unreachable one and this test
 *         behaves the same on a laptop, in CI and on an air-gapped box.
 *   FAIL  anything in the failure names WebAssembly, or the child dies rather than answering. That
 *         is the production crash, and it is the only thing being asserted.
 *
 * A network error is not a weaker result here. Constructing the client and reaching the transport
 * is the entire distance between "the purse can sign" and what the droplet did; the fullnode's
 * answer adds nothing to it and would add a dependency on somebody else's uptime.
 *
 * # Which node runs the child
 *
 * The unit names `/opt/node22/bin/node`, and node 22 is the runtime this defect is fatal on: from
 * node 24 the built-in HTTP parser is native rather than a WebAssembly module, so `--jitless` no
 * longer takes fetch down with it and the crash hides on a modern laptop. So the child runs under
 * the unit's own interpreter when this host has one — the droplet does — and falls back to the node
 * running the tests when it does not. `runtime` in the failure message says which one it was, so a
 * green run on a machine that cannot reproduce the droplet is never mistaken for a green droplet.
 *
 * # Why the flags are read out of the unit rather than written here
 *
 * A literal `--jitless` in this file would pin what somebody typed once. Reading ExecStart pins
 * what the deploy will actually run: reintroduce the flag in the unit and this test starts the
 * child with it, on the runtime the unit names, and the WebAssembly failure comes back.
 */

import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { access, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { directive, parseUnit } from '../src/units.js';
import { CHAIN, PACKAGE, temporaryDirectory } from './helpers.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const UNIT = join(HERE, '..', 'systemd', 'heron-purse.service');

/** `createClient` as the compiled artefact, which is what `dist/server.js` imports on the droplet. */
const SDK_ENTRY = pathToFileURL(
  join(HERE, '..', 'node_modules', '@projectx-social', 'sdk', 'dist', 'index.js'),
).href;

interface ExecStart {
  /** The interpreter the unit names, absolute, as written. */
  readonly interpreter: string;
  /** Every argument between the interpreter and the script — the flags node itself is given. */
  readonly flags: readonly string[];
  /** The script the unit runs. */
  readonly script: string;
}

/**
 * Split ExecStart into interpreter, node's own flags, and the script.
 *
 * systemd tokenises Exec lines on whitespace and `parseUnit` has already rejoined the wrapped
 * lines, so the first token is the interpreter and everything up to the first `.js` belongs to
 * node. The purse's own arguments come after and are not this test's business.
 */
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

/**
 * The child, written out rather than passed with `-e`.
 *
 * `-e` puts the program into `process.execArgv`, and this test asserts against `execArgv` to prove
 * the flags actually reached the child; a file keeps that assertion about the unit's flags and
 * nothing else. Everything is caught and reported as JSON on stdout, so a WebAssembly failure
 * arrives here as a described cause chain instead of as a stack trace and an exit code.
 */
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
  const runtime = (await exists(interpreter)) ? interpreter : process.execPath;

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
        resolve({ report, runtime, code, stdout, stderr });
      },
    );
  });
}

/** Everything the child said, for a failure message that names the runtime it was said on. */
function transcript(run: Run): string {
  return [
    `runtime: ${run.runtime}`,
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
    const run = await runUnderUnitFlags();
    const detail = transcript(run);

    // The child answered at all. A process that dies under these flags has already failed the
    // thing this test exists for, and it must not be able to do so quietly.
    expect(run.report, `the child wrote no report.\n${detail}\nstdout: ${run.stdout}`).not.toBeNull();
    const report = run.report!;
    expect(run.code, `the child exited non-zero.\n${detail}`).toBe(0);

    // The flags really reached it. Without this a green run could mean the child was started
    // plainly and the unit's flags were never exercised at all — the same shape of blind spot
    // that let --jitless through in the first place.
    const { flags } = execStart(await readFile(UNIT, 'utf8'));
    expect(report.execArgv, `the unit's flags did not reach the child.\n${detail}`).toEqual([
      ...flags,
    ]);

    expect(report.constructed, `createClient did not produce a usable client.\n${detail}`).toBe(true);
    expect(report.reachedTransport, `the client never attempted a request.\n${detail}`).toBe(true);

    /*
      Say out loud when this host cannot reproduce the droplet.

      `--jitless` removes `WebAssembly` on every node there has ever been, but only a node whose
      HTTP parser is a WebAssembly module — 22, which is the one the unit names — dies of it. On a
      newer node the flag is still there, `WebAssembly` is still gone, and this test still passes.
      That is a true result about this runtime and a green one about no other, and it is exactly the
      shape of comfort that let the defect ship: a suite that was green somewhere else.

      It is a warning rather than a failure because failing here would only mean "you are not the
      droplet", which is not a defect in the code under test. What it must never do is stay quiet.
    */
    if (report.webAssembly === 'undefined') {
      process.stderr.write(
        `[client-smoke] the unit's flags left this runtime with no WebAssembly ` +
          `(${report.version} at ${run.runtime}), and it survived anyway because its HTTP parser is ` +
          `native. The unit names /opt/node22/bin/node, whose parser is not. This pass does not ` +
          `vouch for that runtime — run this test on it, or on the droplet, before believing it.\n`,
      );
    }

    // The one failure this test is about. A DNS or connection error is expected and is a pass;
    // a runtime that cannot compile WebAssembly is the droplet's crash and is not.
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
});
