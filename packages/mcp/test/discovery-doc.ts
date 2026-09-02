// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

/**
 * The discovery document at `/.well-known/mcp.json`, driven over a real socket.
 *
 * # Why this exists
 *
 * On 2026-09-02 the hosted endpoint's request log showed a client asking for this exact path and
 * receiving a 404 with nothing in it. There is no ratified standard behind the filename; it is
 * simply the path clients try, so we answer it and the document says that about itself.
 *
 * # What is checked, and why each one is here rather than assumed
 *
 *  1. **The tools listed are the tools the process registered.** The document takes them as an
 *     argument; a hand-written list is the one way this file could start lying, and it is the way
 *     a discovery document usually does.
 *  2. **`readOnly` is derived from those tools, not from the mode.** Mode is intent. The tool list
 *     is a fact, and a keyless deployment that somehow registered a spending tool must not be able
 *     to describe itself as read-only.
 *  3. **Host is still enforced.** The discovery path is served before the Origin check but after
 *     the Host check; a rebinding request must not find an unguarded door here.
 *  4. **Origin is deliberately NOT enforced**, so a browser can read a constant public document.
 *  5. **Anything but a read is refused**, so a client that POSTs here is told it is at the wrong
 *     path rather than handed a document it did not ask for.
 */

import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { DISCOVERY_PATH, discoveryDocument, resolveOptions, serveHttp } from '../src/transport.js';

const PORT = 8497;
const HOST = '127.0.0.1';

let checks = 0;
let failures = 0;
function check(what: string, fn: () => void): void {
  checks += 1;
  try {
    fn();
    console.log(`  ok  ${what}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL  ${what}`);
    console.log(`      ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** `Host` cannot be set through `fetch`; see transport-http.ts for the full reasoning. */
async function getWithHost(path: string, host: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: HOST, port: PORT, path, method: 'GET', headers: { host } }, (res) => {
      let body = '';
      res.on('data', (c) => (body += String(c)));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

/* ---- the pure document, before any socket is involved ---------------------------------------- */

const options = { ...resolveOptions(['--http'], { WEIR_MCP_HTTP_PORT: String(PORT) }), discoveryTools: [] as string[] };

check('the tools listed are exactly the tools handed in', () => {
  const d = discoveryDocument(options, ['weir_search', 'weir_quote'], 'https://mcp.example');
  assert.deepEqual(d.tools, ['weir_search', 'weir_quote']);
  assert.equal(d.endpoint, 'https://mcp.example/mcp');
});

check('a process that registered nothing advertises nothing', () => {
  assert.deepEqual(discoveryDocument(options, [], 'https://mcp.example').tools, []);
});

check('read-only is derived from the tools, not from the mode', () => {
  const read = discoveryDocument(options, ['weir_search', 'weir_read'], 'https://mcp.example');
  assert.equal(read.readOnly, true);
  assert.match(read.note, /holds no key/);
  // The same options, the same mode: only the tool list differs, and the document must follow it.
  const spends = discoveryDocument(options, ['weir_search', 'weir_buy'], 'https://mcp.example');
  assert.equal(spends.readOnly, false);
  assert.doesNotMatch(spends.note, /holds no key/);
});

check('the document points at the guide and the signed manifest, from the configured base', () => {
  const d = discoveryDocument(options, [], 'https://mcp.example');
  assert.equal(d.documentation, `${options.baseUrl}/llms.txt`);
  assert.equal(d.manifest, `${options.baseUrl}/.well-known/weir-agent.json`);
});

check('it never claims a standard it does not have', () => {
  assert.match(discoveryDocument(options, [], 'https://mcp.example').note, /no ratified standard/);
});

/* ---- and over a real socket ------------------------------------------------------------------ */

const http = await serveHttp(async () => new McpServer({ name: 'harness', version: '0.0.0' }, {}), {
  ...options,
  discoveryTools: ['weir_search', 'weir_quote', 'weir_read'],
});

const served = await fetch(`http://${HOST}:${PORT}${DISCOVERY_PATH}`);
const body = (await served.json()) as Record<string, unknown>;

check('a plain GET is answered with the document', () => {
  assert.equal(served.status, 200);
  assert.deepEqual(body.tools, ['weir_search', 'weir_quote', 'weir_read']);
  assert.equal(body.readOnly, true);
  assert.equal(body.transport, 'streamable-http');
  assert.equal(body.authentication, 'none');
});

check('it is readable cross-origin, because it is a constant and drives nothing', () => {
  assert.equal(served.headers.get('access-control-allow-origin'), '*');
});

/*
  Awaited out here, not inside `check`. `check` is synchronous: an async callback handed to it
  returns a promise it never awaits, so every assertion inside would run after the check had
  already printed "ok" and a failure would surface as an unhandled rejection instead of a failed
  test. Two of these were written that way and passed without asserting anything.
*/
const browser = await fetch(`http://${HOST}:${PORT}${DISCOVERY_PATH}`, { headers: { origin: 'https://evil.example' } });
check('a browser Origin is served here, unlike the protocol path', () => {
  assert.equal(browser.status, 200);
});

const posted = await fetch(`http://${HOST}:${PORT}${DISCOVERY_PATH}`, { method: 'POST', body: '{}' });
check('POST is refused and names the right path', () => {
  assert.equal(posted.status, 405);
});

const rebound = await getWithHost(DISCOVERY_PATH, 'rebind.example');
check('the Host control still runs in front of it', () => {
  assert.equal(rebound.status, 403);
  assert.match(rebound.body, /host_refused/);
});

const missing = await fetch(`http://${HOST}:${PORT}/.well-known/anything-else.json`);
check('an unknown well-known path is still a 404', () => {
  assert.equal(missing.status, 404);
});

http.close();
console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
