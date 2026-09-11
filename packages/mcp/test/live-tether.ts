// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import assert from 'node:assert/strict';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerTools } from '../src/tools.js';
import { PortRefusal } from '../src/agent-port.js';
import type { Signer, WeirBinding, WeirDeclaration, WeirPort } from '../src/transport.js';

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

const AGENT = `0x${'1a'.repeat(32)}`;
const SOMEBODY_ELSE = `0x${'3c'.repeat(32)}`;
const OPERATOR = `0x${'2b'.repeat(32)}`;

const signer: Signer = {
  address: AGENT,
  scheme: 'ed25519',
  signPersonalMessage: async () => ({}),
  signTransaction: async () => ({}),
};

function live(address: string): WeirDeclaration {
  return { address, operatorAddress: OPERATOR, model: 'pi', purpose: 'writes', declaredAtMs: 1_788_400_000_000, revokedAtMs: null };
}

let asked: string[] = [];
let posted: unknown[] = [];
let sent: unknown[] = [];
let bought: unknown[] = [];
let declared: unknown[] = [];

type Answer = (address: string) => WeirDeclaration | null;
let answer: Answer = () => live(AGENT);
let registerThrows: unknown = null;

function port(overrides: Partial<WeirPort> = {}): WeirPort {
  return {
    agents: async () => [],
    quote: async ({ vaultId, contentKey }) => ({
      vaultId,
      contentKey,
      price: '1000',
      currency: 'SUI' as const,
      coinType: '0x2::sui::SUI',
      owner: SOMEBODY_ELSE,
      accepting: true,
      observedAtMs: 1_788_400_000_000,
    }),
    declaration: async ({ address }) => {
      asked.push(address);
      if (registerThrows !== null) throw registerThrows;
      return answer(address);
    },
    post: async (article) => {
      posted.push(article);
      return { postId: 'p_written' };
    },
    send: async (message) => {
      sent.push(message);
      return { sent: true as const };
    },
    unlock: async (input) => {
      bought.push(input);
      return { txDigest: 'digest_bought', unlockObjectId: null, pricePaid: '1000', currency: 'SUI' as const };
    },
    requestDeclaration: async (input) => {
      declared.push(input);
      const issuedAtMs = 1_788_400_000_000;
      return { issuedAtMs, expiresAtMs: issuedAtMs + 600_000, operatorPage: 'https://weir.social/agents/declare' };
    },
    ...overrides,
  };
}

async function connect(weir: WeirPort): Promise<{ client: Client; registered: string[] }> {
  const binding = { port: weir, signer: { kind: 'signing', signer }, policyAvailable: true } as unknown as WeirBinding;
  const server = new McpServer({ name: 'weir-mcp', version: '1.0.0' });
  const registered = registerTools(server, binding);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'tether-harness', version: '1.0.0' });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return { client, registered };
}

const parsed = (r: unknown): Record<string, any> =>
  JSON.parse(String((r as { content: Array<{ text: string }> }).content[0]?.text ?? '{}'));

const A_POST = { handle: 'kaela', title: 'A title', preview: 'A preview', text: 'A body', access: 'public' as const };
const A_MESSAGE = { to: 'someone', text: 'hello', preview: 'hello' };

function reset(): void {
  asked = [];
  posted = [];
  sent = [];
  bought = [];
  declared = [];
  registerThrows = null;
}

reset();
const armed = await connect(port());
check('weir_post and weir_send register on an armed binding that can read the register', () => {
  assert.ok(armed.registered.includes('weir_post'), armed.registered.join(', '));
  assert.ok(armed.registered.includes('weir_send'), armed.registered.join(', '));
});

const withoutRegister = port();
delete withoutRegister.declaration;
const noRegister = await connect(withoutRegister);
check('a binding that cannot read the register offers neither tool, rather than one that always refuses', () => {
  assert.ok(!noRegister.registered.includes('weir_post'), noRegister.registered.join(', '));
  assert.ok(!noRegister.registered.includes('weir_send'), noRegister.registered.join(', '));
  assert.ok(noRegister.registered.includes('weir_buy'), noRegister.registered.join(', '));
  assert.ok(noRegister.registered.includes('weir_declare'), noRegister.registered.join(', '));
});

reset();
answer = () => null;
const undeclared = await armed.client.callTool({ name: 'weir_post', arguments: A_POST });
check('an undeclared agent is refused with not_declared and pointed at weir_declare', () => {
  assert.equal(undeclared.isError, true, JSON.stringify(undeclared));
  const body = parsed(undeclared);
  assert.equal(body['reason'], 'not_declared');
  assert.equal(body['address'], AGENT);
  assert.equal(body['next'].tool, 'weir_declare');
  assert.match(body['detail'], /costs the platform storage it pays for/);
  assert.match(body['detail'], /Nothing was written/);
});

check('nothing reached the platform when the tether was refused', () => {
  assert.equal(posted.length, 0, `post was called ${posted.length} time(s) on a refused publish`);
  assert.equal(asked.length, 1, `the register was consulted ${asked.length} time(s)`);
});

reset();
answer = (address) => (address === SOMEBODY_ELSE ? live(SOMEBODY_ELSE) : null);
const forged = await armed.client.callTool({
  name: 'weir_post',
  arguments: { ...A_POST, handle: 'somebody_else' },
});
check('a caller naming another handle cannot borrow that party’s tether', () => {
  assert.equal(forged.isError, true, JSON.stringify(forged));
  assert.equal(parsed(forged)['reason'], 'not_declared');
  assert.equal(parsed(forged)['address'], AGENT, 'the refusal names the principal, not the argument');
  assert.equal(posted.length, 0, 'a forged handle must not reach the platform');
});

check('the register was asked about the bound signer and about nothing else', () => {
  assert.deepEqual(asked, [AGENT], `the register was asked about: ${asked.join(', ')}`);
  assert.ok(!asked.includes(SOMEBODY_ELSE), 'an argument decided which declaration was consulted');
});

reset();
const REVOKED_AT = 1_788_500_000_000;
answer = () => ({ ...live(AGENT), revokedAtMs: REVOKED_AT });
const revoked = await armed.client.callTool({ name: 'weir_post', arguments: A_POST });
check('a declaration the operator withdrew refuses, and is told apart from never having declared', () => {
  assert.equal(revoked.isError, true, JSON.stringify(revoked));
  const body = parsed(revoked);
  assert.equal(body['reason'], 'revoked', 'a withdrawn declaration must not read as not_declared');
  assert.equal(body['revokedAtMs'], REVOKED_AT);
  assert.match(body['detail'], /withdrew that declaration/);
});

check('a withdrawn declaration writes nothing either', () => {
  assert.equal(posted.length, 0, `post was called ${posted.length} time(s) for a revoked agent`);
});

reset();
registerThrows = new PortRefusal('transport', 'declaration', 'could not reach https://weir.social/api/agents/0x1a…');
const unread = await armed.client.callTool({ name: 'weir_post', arguments: A_POST });
check('an unreadable register refuses rather than assuming, and carries the failure kind', () => {
  assert.equal(unread.isError, true, JSON.stringify(unread));
  const body = parsed(unread);
  assert.equal(body['reason'], 'register_unread', 'a failed read must not read as not_declared');
  assert.equal(body['failure'].kind, 'transport');
  assert.match(body['detail'], /an unreadable register is not an answer/);
});

check('nothing was written while the register was unreachable', () => {
  assert.equal(posted.length, 0, 'a publish went through on an unreadable register');
});

reset();
answer = () => null;
const sendRefused = await armed.client.callTool({ name: 'weir_send', arguments: A_MESSAGE });
check('weir_send demands the same live tether and stores nothing without it', () => {
  assert.equal(sendRefused.isError, true, JSON.stringify(sendRefused));
  assert.equal(parsed(sendRefused)['reason'], 'not_declared');
  assert.equal(sent.length, 0, `send was called ${sent.length} time(s) on a refused message`);
  assert.deepEqual(asked, [AGENT]);
});

reset();
answer = () => null;
const declaredOk = await armed.client.callTool({
  name: 'weir_declare',
  arguments: { operatorAddress: OPERATOR, model: 'pi', purpose: 'writes' },
});
check('weir_declare works for an UNDECLARED agent — the tether is bootstrapped through it', () => {
  assert.equal(declaredOk.isError, undefined, JSON.stringify(declaredOk));
  assert.equal(declared.length, 1, 'the declaration request did not reach the port');
  assert.equal(asked.length, 0, 'weir_declare consulted the register; it must not');
});

reset();
answer = () => null;
const quoted = await armed.client.callTool({
  name: 'weir_quote',
  arguments: { vaultId: `0x${'9f'.repeat(32)}`, contentKey: 'a-key' },
});
check('a free read still answers an undeclared caller', () => {
  assert.equal(quoted.isError, undefined, JSON.stringify(quoted));
  assert.equal((quoted as { structuredContent?: Record<string, any> }).structuredContent?.['price'], '1000');
  assert.equal(asked.length, 0, 'a read consulted the register; reads are not gated');
});

reset();
answer = () => null;
const boughtOk = await armed.client.callTool({
  name: 'weir_buy',
  arguments: { vaultId: `0x${'9f'.repeat(32)}`, contentKey: 'a-key', maxPrice: '5000', currency: 'SUI' },
});
check('weir_buy still spends the caller’s OWN coin while undeclared — the platform pays nothing for it', () => {
  assert.equal(boughtOk.isError, undefined, JSON.stringify(boughtOk));
  assert.equal(bought.length, 1, 'the purchase did not reach the port');
  assert.equal(asked.length, 0, 'a purchase consulted the register; it must not');
});

reset();
answer = () => live(AGENT);
const published = await armed.client.callTool({ name: 'weir_post', arguments: A_POST });
check('a live tether publishes, and the arguments reach the port unchanged', () => {
  assert.equal(published.isError, undefined, JSON.stringify(published));
  assert.equal(posted.length, 1, 'the publish did not reach the port');
  const article = posted[0] as Record<string, unknown>;
  assert.equal(article['handle'], 'kaela');
  assert.equal(article['title'], 'A title');
  assert.equal(article['access'], 'public');
});

const second = await armed.client.callTool({ name: 'weir_send', arguments: A_MESSAGE });
check('the register is consulted on every gated call, not once at startup', () => {
  assert.equal(second.isError, undefined, JSON.stringify(second));
  assert.equal(sent.length, 1);
  assert.equal(asked.length, 2, `the register was consulted ${asked.length} time(s) across two gated calls`);
  assert.deepEqual(asked, [AGENT, AGENT]);
});

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
