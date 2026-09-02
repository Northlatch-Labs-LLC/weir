// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

/**
 * `weir_search` takes the shop window's shape — run against a stub port, not argued.
 *
 * # What this pins
 *
 * Four properties of the tool, independent of any agent implementation:
 *
 *   1. The page size is not the caller's. The input schema has no `limit` and no `query`; the port
 *      is called with exactly `{ handle?, cursor? }` and nothing else, and the page shown is the
 *      page the port gave, however long.
 *   2. `truncated` and `nextCursor` reach the caller untouched. A first page says `truncated: true`
 *      with a cursor; the cursor handed back arrives at the port byte-for-byte; the last page says
 *      `truncated: false` with `nextCursor: null`.
 *   3. A failed read is a refusal carrying the failure's kind — `isError`, `reason: 'read_failed'`,
 *      `failure.kind` — and NEVER an empty page. The stub's failure mode returns a `Reading` with
 *      `ok: false`, exactly what the agent library returns for a 500 from `/api/browse`.
 *   4. The tool is in the read set: it registers with no signer and no policy.
 *
 * The HTTP call itself — two pages served by a fixture server, a 500 turned into that `Reading` —
 * belongs with the agent's `feed()` and is tested there.
 */

import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerTools } from '../src/tools.js';
import type { WeirBinding, WeirFeed, WeirPort, WeirPost } from '../src/transport.js';

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

function post(i: number, handle = 'alice'): WeirPost {
  return { postId: `p${String(i).padStart(3, '0')}`, handle, title: `Post ${i}`, preview: `preview ${i}`, access: 'public', price: null, currency: null };
}

/** Two pages, the first deliberately NOT twenty long: the tool must not care what the page size is. */
const PAGE_ONE: WeirFeed = { posts: Array.from({ length: 7 }, (_, i) => post(i)), truncated: true, nextCursor: 'eyJrIjoicG9zdHMiLCJ0IjoxfQ' };
const PAGE_TWO: WeirFeed = { posts: [post(7), post(8)], truncated: false, nextCursor: null };

class StubShopWindow implements WeirPort {
  readonly calls: unknown[] = [];
  failNext = false;
  feed = async (input: { handle?: string; cursor?: string }) => {
    this.calls.push(input);
    if (this.failNext) {
      this.failNext = false;
      return { ok: false as const, failure: { kind: 'transport' as const, source: 'feed', detail: 'GET /api/browse answered 500' } };
    }
    const page = input.cursor === undefined ? PAGE_ONE : input.cursor === PAGE_ONE.nextCursor ? PAGE_TWO : null;
    if (page === null) return { ok: false as const, failure: { kind: 'malformed' as const, source: 'feed', detail: 'cursor not one this endpoint issued' } };
    return { ok: true as const, value: page, observedAtMs: Date.now() };
  };
}

async function connect(binding: WeirBinding): Promise<{ client: Client; registered: string[] }> {
  const server = new McpServer({ name: 'weir-mcp', version: '1.0.0', title: 'weir.social' });
  const registered = registerTools(server, binding);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'search-shape-harness', version: '1.0.0' });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return { client, registered };
}

type Structured = { posts: unknown[]; count: number; truncated: boolean; nextCursor: string | null };

async function main(): Promise<void> {
  const window = new StubShopWindow();
  // No signer, no policy: the hosted, keyless deployment. Search must still be there.
  const { client, registered } = await connect({ port: window, signer: { kind: 'none' }, policyAvailable: false });

  console.log('=== the read set ===');
  check('weir_search registers with no signer and no policy', () => {
    assert.ok(registered.includes('weir_search'), registered.join(', '));
  });
  const listed = (await client.listTools()).tools.find((t) => t.name === 'weir_search');
  check('its input has no page-size and no free-text parameter — only handle and cursor', () => {
    const props = Object.keys((listed?.inputSchema as { properties?: Record<string, unknown> }).properties ?? {}).sort();
    assert.deepEqual(props, ['cursor', 'handle']);
  });

  console.log('=== the page is the server’s ===');
  const first = await client.callTool({ name: 'weir_search', arguments: {} });
  const firstValue = first.structuredContent as Structured;
  check('the port is called with exactly { } for the first page — no limit, no query', () => {
    assert.deepEqual(window.calls[0], {});
  });
  check('the page shown is the page the port gave, seven posts, not padded and not capped', () => {
    assert.equal(firstValue.count, 7);
    assert.equal(firstValue.posts.length, 7);
  });
  check('truncated: true and the cursor reach the caller untouched', () => {
    assert.equal(firstValue.truncated, true);
    assert.equal(firstValue.nextCursor, PAGE_ONE.nextCursor);
  });

  const second = await client.callTool({ name: 'weir_search', arguments: { cursor: firstValue.nextCursor, handle: 'alice' } });
  const secondValue = second.structuredContent as Structured;
  check('the cursor handed back arrives at the port byte-for-byte, with the handle', () => {
    assert.deepEqual(window.calls[1], { handle: 'alice', cursor: PAGE_ONE.nextCursor });
  });
  check('the last page says truncated: false, nextCursor: null', () => {
    assert.equal(secondValue.count, 2);
    assert.equal(secondValue.truncated, false);
    assert.equal(secondValue.nextCursor, null);
  });
  check('every post is framed as untrusted, on both pages', () => {
    for (const p of [...firstValue.posts, ...secondValue.posts] as { authored?: { untrusted?: unknown } }[]) {
      assert.equal(p.authored?.untrusted, true);
    }
  });

  console.log('=== a failed read is a failure, never an empty page ===');
  window.failNext = true;
  const failed = await client.callTool({ name: 'weir_search', arguments: {} });
  const text = (failed.content as { text?: string }[]).map((b) => b.text ?? '').join('\n');
  check('a port failure comes back as isError with reason read_failed and the failure kind', () => {
    assert.equal(failed.isError, true, text);
    const parsed = JSON.parse(text) as { ok: boolean; reason: string; failure?: { kind: string } };
    assert.equal(parsed.ok, false);
    assert.equal(parsed.reason, 'read_failed');
    assert.equal(parsed.failure?.kind, 'transport');
  });
  check('…and NOT as a page with zero posts', () => {
    assert.equal(failed.structuredContent, undefined, JSON.stringify(failed.structuredContent));
    assert.ok(!/"posts"\s*:\s*\[\s*\]/.test(text), text);
  });
  const bad = await client.callTool({ name: 'weir_search', arguments: { cursor: 'not-issued' } });
  check('a cursor the server refuses is a failure of kind malformed, not an empty page', () => {
    assert.equal(bad.isError, true);
    const parsed = JSON.parse((bad.content as { text?: string }[]).map((b) => b.text ?? '').join('')) as { failure?: { kind: string } };
    assert.equal(parsed.failure?.kind, 'malformed');
  });

  console.log(`${checks - failures}/${checks} checks passed, ${failures} failed`);
  if (failures > 0) process.exitCode = 1;
  await client.close();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
