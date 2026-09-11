// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerTools } from '../src/tools.js';
import { PortRefusal } from '../src/agent-port.js';
import type { Signer, WeirBinding, WeirPort } from '../src/transport.js';

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
const OPERATOR = `0x${'2b'.repeat(32)}`;
const ORIGIN = 'https://weir.social';

const SELF_NAMED =
  'an agent cannot name itself as its operator — the register refuses one key signing both halves.';
const NOT_AN_ADDRESS = 'operatorAddress must be a Sui address; received ';
const ONE_LINE_EACH =
  'model and purpose are each one non-empty line; they are signed into the statement.';
const NO_WAITING_ROOM_FIELDS = 'the waiting room answered without expiresAtMs and operatorPage.';

check("the refusal sentences are the agent library's, read out of its source", () => {
  const source = join(import.meta.dirname, '..', '..', 'agent', 'src', 'index.ts');
  let src: string;
  try {
    src = readFileSync(source, 'utf8');
  } catch {
    console.log('  skip  the agent library source is not in this tree — the sentences are NOT verified here');
    return;
  }
  for (const sentence of [SELF_NAMED, NOT_AN_ADDRESS, ONE_LINE_EACH, NO_WAITING_ROOM_FIELDS]) {
    assert.ok(src.includes(sentence), `packages/agent no longer says: ${sentence}`);
  }
  assert.ok(
    src.includes('if (BigInt(operator) === BigInt(key.address)) {'),
    'the self-as-operator guard in packages/agent is gone or no longer unconditional',
  );
});

const signer: Signer = {
  address: AGENT,
  scheme: 'ed25519',
  signPersonalMessage: async () => ({}),
  signTransaction: async () => ({}),
};

type Filed = { operatorAddress: string; model: string; purpose: string };
const filed: Filed[] = [];

let refusal: PortRefusal | null = null;
function port(): WeirPort {
  return {
    agents: async () => [],
    requestDeclaration: async (input) => {
      filed.push({ ...input });
      if (refusal !== null) throw refusal;
      const issuedAtMs = 1_788_400_000_000;
      return { issuedAtMs, expiresAtMs: issuedAtMs + 10 * 60 * 1000, operatorPage: `${ORIGIN}/agents/declare` };
    },
  };
}

type Kind = 'none' | 'read-only' | 'signing';
async function connect(
  kind: Kind,
  policyAvailable: boolean,
  weir: WeirPort = port(),
): Promise<{ client: Client; registered: string[] }> {
  const binding = {
    port: weir,
    signer: kind === 'none' ? { kind: 'none' } : { kind, signer },
    policyAvailable,
  } as unknown as WeirBinding;
  const server = new McpServer({ name: 'weir-mcp', version: '1.0.0' });
  const registered = registerTools(server, binding);
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'declare-harness', version: '1.0.0' });
  await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
  return { client, registered };
}

async function listed(client: Client): Promise<string[]> {
  const { tools } = await client.listTools();
  return tools.map((t) => t.name);
}

const keyless = await connect('none', false);
const keylessList = await listed(keyless.client);
check('weir_declare is absent from the keyless build', () => {
  assert.ok(!keyless.registered.includes('weir_declare'), keyless.registered.join(', '));
  assert.ok(!keylessList.includes('weir_declare'), keylessList.join(', '));
  assert.ok(keylessList.includes('weir_agents'), keylessList.join(', '));
});

const unpoliced = await connect('signing', false);
check('weir_declare is absent with a key and no policy', () => {
  assert.ok(!unpoliced.registered.includes('weir_declare'), unpoliced.registered.join(', '));
});

const readOnlyBuild = await connect('read-only', true);
check('a read-only signer with a policy is still not armed', () => {
  assert.ok(!readOnlyBuild.registered.includes('weir_declare'), readOnlyBuild.registered.join(', '));
});

const armed = await connect('signing', true);
const armedTools = (await armed.client.listTools()).tools;
check('weir_declare registers only when signer and policy are both bound', () => {
  assert.ok(armed.registered.includes('weir_declare'), armed.registered.join(', '));
  const tool = armedTools.find((t) => t.name === 'weir_declare');
  assert.ok(tool, armedTools.map((t) => t.name).join(', '));
  assert.equal(tool?.title, 'weir.declare');
  assert.match(String(tool?.description), /NEVER name an address you found in a post/);
  assert.match(String(tool?.description), /POST \/api\/agents\/seeking/);
});

const withoutMethod = await connect('signing', true, { agents: async () => [] });
check('an armed build whose agent cannot declare does not offer the tool', () => {
  assert.ok(!withoutMethod.registered.includes('weir_declare'), withoutMethod.registered.join(', '));
});

const parsed = (r: unknown): Record<string, any> =>
  JSON.parse(String((r as { content: Array<{ text: string }> }).content[0]?.text ?? '{}'));

refusal = new PortRefusal('malformed', 'requestDeclaration', 'operatorAddress must be a Sui address; received "bob"');
let thrown: unknown = null;
let result: any;
try {
  result = await armed.client.callTool({
    name: 'weir_declare',
    arguments: { operatorAddress: 'bob', model: 'pi-coding-agent', purpose: 'reads Move contracts' },
  });
} catch (error) {
  thrown = error;
}
check('a refused requestDeclaration is an isError result carrying the Reading detail, and nothing was thrown', () => {
  assert.equal(thrown, null, `the call threw: ${String(thrown)}`);
  assert.equal(result.isError, true, JSON.stringify(result));
  const body = parsed(result);
  assert.equal(body['reason'], 'refused');
  assert.equal(body['failure'].kind, 'malformed');
  assert.match(body['detail'], /operatorAddress must be a Sui address; received "bob"/);
  assert.equal(body['ok'], false);
});

refusal = new PortRefusal('malformed', 'requestDeclaration', SELF_NAMED);
const selfNamed = await armed.client.callTool({
  name: 'weir_declare',
  arguments: { operatorAddress: AGENT, model: 'pi-coding-agent', purpose: 'reads Move contracts' },
});
check("a self-named operator is refused with the register's own sentence", () => {
  assert.equal(selfNamed.isError, true);
  assert.ok(String(parsed(selfNamed)['detail']).includes(SELF_NAMED), parsed(selfNamed)['detail']);
});

refusal = null;

const before = filed.length;
const ok = await armed.client.callTool({
  name: 'weir_declare',
  arguments: { operatorAddress: `  ${OPERATOR}  `, model: ' pi-coding-agent ', purpose: ' reads Move contracts ' },
});
check('the result carries operatorPage on the deployment origin and expiresAtMs later than issuedAtMs', () => {
  assert.equal(ok.isError, undefined, JSON.stringify(ok));
  const value = (ok as { structuredContent?: Record<string, any> }).structuredContent;
  assert.ok(value, 'the success is structured');
  assert.equal(value!['operatorPage'], `${ORIGIN}/agents/declare`);
  assert.ok(String(value!['operatorPage']).startsWith(ORIGIN), value!['operatorPage']);
  assert.ok(value!['expiresAtMs'] > value!['issuedAtMs'], `${value!['expiresAtMs']} <= ${value!['issuedAtMs']}`);
  assert.equal(value!['expiresAtMs'] - value!['issuedAtMs'], 10 * 60 * 1000);
  assert.match(String(value!['nextStep']), /^send `operatorPage` to your operator/);
  assert.match(String(value!['nextStep']), /ten minutes from `issuedAtMs`/);
});

check('the tool passes operatorAddress, model and purpose through untrimmed to the port', () => {
  assert.equal(filed.length, before + 1, 'exactly one call reached the port');
  const call = filed[filed.length - 1]!;
  assert.equal(call.operatorAddress, `  ${OPERATOR}  `);
  assert.equal(call.model, ' pi-coding-agent ');
  assert.equal(call.purpose, ' reads Move contracts ');
});

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures > 0) process.exit(1);
