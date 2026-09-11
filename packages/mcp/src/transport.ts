// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { readFileSync } from 'node:fs';
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { SUI_PRIVATE_KEY_PREFIX } from '@mysten/sui/cryptography';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Reading } from '@projectx-social/agent';
import { portFromAgent } from './agent-port.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

export type Currency = 'SUI' | 'USDC';

export interface Ceiling {
  readonly maxPrice: bigint;
  readonly currency: Currency;
}

export const U64_MAX = 18_446_744_073_709_551_615n;

export function parseAmount(text: string): bigint | null {
  if (!/^[0-9]+$/.test(text)) return null;
  const value = BigInt(text);
  return value > U64_MAX ? null : value;
}

export interface WeirFeed {
  posts: WeirPost[];
  truncated: boolean;
  nextCursor: string | null;
}

export interface WeirPost {
  postId: string;
  handle: string;
  title: string;
  preview: string;
  access: 'public' | 'paid' | 'subscribers';
  price: string | null;
  currency: Currency | null;
}

export interface WeirQuote {
  vaultId: string;
  contentKey: string;
  price: string;
  currency: Currency;
  coinType: string;
  owner: string;
  accepting: boolean;
  observedAtMs: number;
}

export interface WeirBody {
  postId: string;
  handle: string;
  title: string;
  body: string;
  entitledVia: 'public' | 'unlock' | 'subscription';
}

export interface WeirUnlockReceipt {
  txDigest: string;
  unlockObjectId: string | null;
  pricePaid: string;
  currency: Currency;
}

export interface WeirSubscribeReceipt {
  txDigest: string;
  subscriptionObjectId: string | null;
  pricePaid: string | null;
  currency: Currency;
}

export interface WeirBalance {
  address: string;
  spendable: string;
  currency: Currency;
}

export type WeirAuthorship =
  | { proof: null; reason: string }
  | {
      proof: {
        address: string;
        signature: string;
        statement: string;
        origin: string;
        contentSha256: string;
        issuedAtMs: number;
      };
      handleStillResolvesToSigner: boolean | null;
    };

export interface WeirDeclaredAgent {
  address: string;
  operatorAddress: string;
  model: string;
  purpose: string;
  declaredAtMs: number;
  operatorFootprint: { state: 'seen' | 'unseen' | 'not-measured'; observedAtMs: number } | null;
}

export interface WeirDeclaration {
  address: string;
  operatorAddress: string;
  model: string;
  purpose: string;
  declaredAtMs: number;
  revokedAtMs: number | null;
}

export interface WeirSeekingAgent {
  address: string;
  handle: string;
  model: string;
  purpose: string;
  words: string;
  expiresAtMs: number | null;
}

export interface WeirPort {
  feed?: (input: { handle?: string; cursor?: string }) => Promise<Reading<WeirFeed>>;
  quote?: (input: { vaultId: string; contentKey: string }) => Promise<WeirQuote>;
  readPreview?: (input: { postId: string }) => Promise<WeirBody | null>;
  balance?: () => Promise<WeirBalance>;
  authorship?: (input: { postId: string }) => Promise<WeirAuthorship>;
  commentAuthorship?: (input: { commentId: string }) => Promise<WeirAuthorship>;
  agents?: (input: { operator?: string }) => Promise<WeirDeclaredAgent[]>;
  declaration?: (input: { address: string }) => Promise<WeirDeclaration | null>;
  seeking?: () => Promise<WeirSeekingAgent[]>;

  requestDeclaration?: (input: {
    operatorAddress: string;
    model: string;
    purpose: string;
  }) => Promise<{ issuedAtMs: number; expiresAtMs: number; operatorPage: string }>;

  unlock?: (input: {
    vaultId: string;
    contentKey: string;
    ceiling: Ceiling;
    idempotencyKey: string;
  }) => Promise<WeirUnlockReceipt>;
  subscribe?: (input: {
    vaultId: string;
    tierIndex: number;
    ceiling: Ceiling;
    idempotencyKey: string;
  }) => Promise<WeirSubscribeReceipt>;
  post?: (input: {
    handle: string;
    title: string;
    preview: string;
    text: string;
    access: 'public' | 'paid' | 'subscribers';
    tier?: number;
    contentKey?: string;
    price?: string;
    idempotencyKey: string;
  }) => Promise<{ postId: string }>;
  send?: (input: {
    to: string;
    text: string;
    preview: string;
    idempotencyKey: string;
  }) => Promise<{ sent: true }>;
  priceContent?: (input: {
    vaultId: string;
    contentKey: string;
    edition?: 'human' | 'machine';
    price: string;
    currency: Currency;
    idempotencyKey: string;
  }) => Promise<{ txDigest: string }>;
  machineBody?: (input: {
    vaultId: string;
    contentKey: string;
  }) => Promise<MachineBodyState | { ok: true; value: MachineBodyState } | { ok: false; failure: unknown }>;
}

export type MachineBodyState = 'no-post' | 'sealed' | 'absent';

export interface Signer {
  readonly address: string;
  readonly scheme: 'ed25519' | 'secp256r1' | 'multisig';
  signPersonalMessage: (b: Uint8Array) => Promise<unknown>;
  signTransaction: (b: Uint8Array) => Promise<unknown>;
}

export type SignerBinding =
  | { kind: 'none' }
  | { kind: 'read-only'; signer: Signer }
  | { kind: 'signing'; signer: Signer };

export interface WeirBinding {
  port: WeirPort;
  signer: SignerBinding;
  policyAvailable: boolean;
}

export type Capability =
  | 'search'
  | 'quote'
  | 'authorship'
  | 'agents'
  | 'seeking'
  | 'read-preview'
  | 'balance'
  | 'buy'
  | 'subscribe'
  | 'post'
  | 'send'
  | 'price'
  | 'declare';

export function agentFromReading(created: unknown): WeirPort {
  const reading = created as { ok?: unknown; value?: unknown; failure?: { detail?: unknown } };
  if (reading?.ok === false) {
    const detail =
      typeof reading.failure?.detail === 'string' ? reading.failure.detail : 'no reason given';
    throw new StartupRefusal(`${AGENT_PACKAGE} createAgent() refused: ${detail}`);
  }
  if (reading?.ok !== true || reading.value === null || typeof reading.value !== 'object') {
    throw new StartupRefusal(
      `${AGENT_PACKAGE} createAgent() did not return a Reading<Agent>. Nothing was bound, because ` +
        'binding an unrecognised shape is how a server starts with no tools and reports success.',
    );
  }
  return portFromAgent(reading.value);
}

export function capabilitiesOf(binding: WeirBinding): ReadonlySet<Capability> {
  const has = (name: keyof WeirPort): boolean => typeof binding.port[name] === 'function';
  const out = new Set<Capability>();

  if (has('feed')) out.add('search');
  if (has('quote')) out.add('quote');
  if (has('readPreview')) out.add('read-preview');
  if (has('authorship') && has('commentAuthorship')) out.add('authorship');
  if (has('agents')) out.add('agents');
  if (has('seeking')) out.add('seeking');
  if (binding.signer.kind !== 'none' && has('balance')) out.add('balance');

  const armed = binding.signer.kind === 'signing' && binding.policyAvailable;
  if (armed && has('unlock')) out.add('buy');
  if (armed && has('subscribe')) out.add('subscribe');
  if (armed && has('post') && has('declaration')) out.add('post');
  if (armed && has('send') && has('declaration')) out.add('send');
  if (armed && has('priceContent')) out.add('price');
  if (armed && has('requestDeclaration')) out.add('declare');

  return out;
}

export type TransportMode = 'stdio' | 'http';

export interface ServerOptions {
  mode: TransportMode;
  baseUrl: string;
  secretKey: string | null;
  policyPath: string | null;
  httpHost: string;
  httpPort: number;
  allowedOrigins: string[];
  allowedHosts: string[];
  agentEnvironment: Record<string, string>;
  discoveryTools: readonly string[];
}

export const DEFAULT_BASE_URL = 'https://weir.social';

export const ENV = {
  key: 'WEIR_AGENT_KEY',
  baseUrl: 'WEIR_BASE_URL',
  httpHost: 'WEIR_MCP_HTTP_HOST',
  httpPort: 'WEIR_MCP_HTTP_PORT',
  allowedOrigins: 'WEIR_MCP_ALLOWED_ORIGINS',
  allowedHosts: 'WEIR_MCP_ALLOWED_HOSTS',
  policy: 'WEIR_AGENT_POLICY',
} as const;

export const AGENT_ENVIRONMENT = [
  'PROJECTX_SOCIAL_NETWORK',
  'PROJECTX_SOCIAL_GRPC_URL',
  'PROJECTX_SOCIAL_PACKAGE_ID',
  'PROJECTX_SOCIAL_LATEST_PACKAGE_ID',
  'PROJECTX_SOCIAL_PLATFORM_ID',
  'PROJECTX_SOCIAL_REGISTRY_ID',
  'PROJECTX_SOCIAL_AGENT_COIN_TYPE',
  'PROJECTX_SOCIAL_AGENT_BASE_URL',
  'PROJECTX_SOCIAL_KEY_REGISTRY_ID',
] as const;

export function agentEnvironment(env: NodeJS.ProcessEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of AGENT_ENVIRONMENT) {
    const value = env[name]?.trim();
    if (value !== undefined && value !== '') out[name] = value;
  }
  return out;
}

export class StartupRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StartupRefusal';
  }
}

export function resolveOptions(argv: readonly string[], env: NodeJS.ProcessEnv): ServerOptions {
  const wantsHttp = argv.includes('--http');
  const wantsStdio = argv.includes('--stdio');

  if (wantsHttp && wantsStdio) {
    throw new StartupRefusal(
      'both --stdio and --http were given. These are different trust models, not two ways to say ' +
        'the same thing: one may hold your signing key and the other may never. Pick one.',
    );
  }

  const mode: TransportMode = wantsHttp ? 'http' : 'stdio';
  const rawKey = env[ENV.key]?.trim();
  const hasKey = rawKey !== undefined && rawKey !== '';

  if (mode === 'http' && hasKey) {
    throw new StartupRefusal(
      `${ENV.key} is set and the transport is --http. This server signs nothing in HTTP mode and ` +
        'will not start holding a key behind a network port. Either drop the variable, or run ' +
        '--stdio beside the agent that owns that key.',
    );
  }

  if (hasKey && rawKey !== undefined && !rawKey.startsWith(SUI_PRIVATE_KEY_PREFIX)) {
    throw new StartupRefusal(
      `${ENV.key} is not a Sui private key. Expected a bech32 string beginning "${SUI_PRIVATE_KEY_PREFIX}". ` +
        'The value has not been logged.',
    );
  }

  const baseUrl = env[ENV.baseUrl]?.trim() || DEFAULT_BASE_URL;
  let parsedBase: URL;
  try {
    parsedBase = new URL(baseUrl);
  } catch {
    throw new StartupRefusal(`${ENV.baseUrl} is not a URL: ${baseUrl}`);
  }
  if (parsedBase.protocol !== 'https:' && parsedBase.hostname !== 'localhost' && parsedBase.hostname !== '127.0.0.1') {
    throw new StartupRefusal(
      `${ENV.baseUrl} must be https (or localhost). Refusing to send signed actions over ${parsedBase.protocol}//.`,
    );
  }

  const portText = env[ENV.httpPort]?.trim();
  const httpPort = portText === undefined || portText === '' ? 8402 : Number(portText);
  if (!Number.isInteger(httpPort) || httpPort < 1 || httpPort > 65535) {
    throw new StartupRefusal(`${ENV.httpPort} is not a port number: ${String(portText)}`);
  }

  const httpHost = env[ENV.httpHost]?.trim() || '127.0.0.1';

  const allowedOrigins = splitList(env[ENV.allowedOrigins]);
  const configuredHosts = splitList(env[ENV.allowedHosts]);

  return {
    mode,
    baseUrl,
    secretKey: mode === 'stdio' && hasKey && rawKey !== undefined ? rawKey : null,
    policyPath: mode === 'stdio' && hasKey ? (env[ENV.policy]?.trim() || null) : null,
    httpHost,
    httpPort,
    allowedOrigins,
    allowedHosts: configuredHosts.length > 0 ? configuredHosts : defaultAllowedHosts(httpHost, httpPort),
    agentEnvironment: agentEnvironment(env),
    discoveryTools: [],
  };
}

function splitList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}

export function defaultAllowedHosts(httpHost: string, httpPort: number): string[] {
  const loopback = httpHost === '127.0.0.1' || httpHost === 'localhost' || httpHost === '::1';
  const names = loopback ? ['127.0.0.1', 'localhost', '[::1]'] : [httpHost];
  return names.map((name) => `${name}:${httpPort}`);
}

export function log(...parts: unknown[]): void {
  process.stderr.write(`[weir-mcp] ${parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ')}\n`);
}

const AGENT_PACKAGE = '@projectx-social/agent';
const SIGNER_PACKAGE = '@projectx-social/signer';
const POLICY_PACKAGE = '@projectx-social/policy';

async function loadOptional(specifier: string): Promise<Record<string, unknown> | null> {
  const held: string = specifier;
  try {
    return (await import(held)) as Record<string, unknown>;
  } catch (error) {
    log(`${specifier} is not available: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function assertSignerShape(value: unknown): Signer | null {
  if (value === null || typeof value !== 'object') return null;
  const candidate = value as Partial<Signer>;
  if (typeof candidate.address !== 'string' || candidate.address === '') return null;
  if (candidate.scheme !== 'ed25519' && candidate.scheme !== 'secp256r1' && candidate.scheme !== 'multisig') {
    return null;
  }
  if (typeof candidate.signPersonalMessage !== 'function') return null;
  if (typeof candidate.signTransaction !== 'function') return null;
  return candidate as Signer;
}

function probeBytes(): Uint8Array {
  const nonce = Array.from({ length: 16 }, () =>
    Math.floor(Math.random() * 256)
      .toString(16)
      .padStart(2, '0'),
  ).join('');
  return new TextEncoder().encode(`weir-mcp capability probe; authorises nothing; nonce ${nonce}`);
}

async function probeSigner(signer: Signer): Promise<boolean> {
  try {
    const result: unknown = await signer.signPersonalMessage(probeBytes());
    if (result !== null && typeof result === 'object' && (result as { ok?: unknown }).ok === true) {
      return true;
    }
    log('signer capability probe was refused: this deployment is read-only and will not be armed');
    return false;
  } catch (error) {
    log(`signer capability probe threw, treating as read-only: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

export async function openWeir(options: ServerOptions): Promise<WeirBinding> {
  const agentModule = await loadOptional(AGENT_PACKAGE);
  if (agentModule === null) {
    throw new StartupRefusal(
      `${AGENT_PACKAGE} could not be loaded, so this server has nothing to talk to weir with.`,
    );
  }

  const createAgent = agentModule['createAgent'];
  if (typeof createAgent !== 'function') {
    throw new StartupRefusal(`${AGENT_PACKAGE} does not export createAgent().`);
  }

  let keypair: Ed25519Keypair | null = null;
  if (options.secretKey !== null) {
    try {
      keypair = Ed25519Keypair.fromSecretKey(options.secretKey);
    } catch (error) {
      void error;
      throw new StartupRefusal(
        `${ENV.key} is set but could not be decoded as a bech32 Ed25519 Sui private key ` +
          `(expected "${SUI_PRIVATE_KEY_PREFIX}…"). The value has not been logged.`,
      );
    }
  }

  const signer = await bindSigner(options);
  const policyBinding = await bindPolicy(options, signer);

  void keypair;
  const created: unknown = await (createAgent as (input: unknown) => unknown)({
    keypair: options.secretKey,
    baseUrl: options.baseUrl,
    config: options.agentEnvironment,
    ...(policyBinding === null ? {} : { transactionSigner: policyBinding.factory }),
  });

  if (created === null || typeof created !== 'object') {
    throw new StartupRefusal(`${AGENT_PACKAGE} createAgent() did not return an object.`);
  }

  const port = agentFromReading(created);

  const policyAvailable = policyBinding !== null;

  return { port, signer, policyAvailable };
}

export function loadPolicyDoc(text: string, signerAddress: string): { ok: true; policy: Record<string, unknown> } | { ok: false; reason: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'the policy file is not JSON' };
  }
  if (parsed === null || typeof parsed !== 'object') return { ok: false, reason: 'the policy file is not an object' };
  const doc = parsed as Record<string, unknown>;
  if (doc['version'] !== 1) return { ok: false, reason: `the policy file has version ${JSON.stringify(doc['version'])}; this server reads version 1` };
  const address = doc['agentAddress'];
  if (typeof address !== 'string' || address.toLowerCase() !== signerAddress.toLowerCase()) {
    return { ok: false, reason: 'the policy file names a different agentAddress than the bound signer; refusing to apply another agent\'s policy' };
  }
  for (const field of ['outflowCeilings', 'allowedTargets', 'allowedTypeArguments', 'allowedRecipients', 'allowedObjects']) {
    if (!Array.isArray(doc[field])) return { ok: false, reason: `the policy file lacks the ${field} list` };
  }
  return { ok: true, policy: doc };
}

interface PolicyBinding {
  factory: (client: unknown) => unknown;
}

async function bindPolicy(options: ServerOptions, signer: SignerBinding): Promise<PolicyBinding | null> {
  if (options.policyPath === null) return null;
  if (signer.kind !== 'signing') {
    throw new StartupRefusal(`${ENV.policy} is set but no signing key is bound; a policy needs a key to bound.`);
  }
  let text: string;
  try {
    text = readFileSync(options.policyPath, 'utf8');
  } catch (error) {
    throw new StartupRefusal(`${ENV.policy} names ${options.policyPath}, which could not be read: ${error instanceof Error ? error.message : String(error)}`);
  }
  const loaded = loadPolicyDoc(text, signer.signer.address);
  if (!loaded.ok) throw new StartupRefusal(`${ENV.policy}: ${loaded.reason}`);

  const signerModule = await loadOptional(SIGNER_PACKAGE);
  const make = signerModule?.['policySigner'];
  if (typeof make !== 'function') {
    throw new StartupRefusal(`${ENV.policy} is set but ${SIGNER_PACKAGE} exports no policySigner(); nothing can apply it.`);
  }
  const spend: Array<Record<string, unknown>> = [];
  const ledger = () => ({ nowMs: Date.now(), spend });
  const policy = loaded.policy;
  return {
    factory: (client: unknown) => (make as (o: unknown) => unknown)({ inner: signer.signer, policy, client, ledger }),
  };
}

async function bindSigner(options: ServerOptions): Promise<SignerBinding> {
  if (options.secretKey === null) return { kind: 'none' };

  const signerModule = await loadOptional(SIGNER_PACKAGE);
  if (signerModule === null) return { kind: 'none' };

  const open = signerModule['localKeypairSignerFromSecret'];
  if (typeof open !== 'function') {
    log(`${SIGNER_PACKAGE} exports no localKeypairSignerFromSecret; this deployment cannot sign`);
    return { kind: 'none' };
  }

  const reading = (open as (secret: string) => unknown)(options.secretKey) as {
    ok?: unknown;
    value?: unknown;
    failure?: { detail?: string };
  };
  if (reading.ok !== true) {
    throw new StartupRefusal(
      `${SIGNER_PACKAGE} could not open the signing key: ${reading.failure?.detail ?? 'no detail given'} ` +
        '(the key itself has not been logged).',
    );
  }

  const shaped = assertSignerShape(reading.value);
  if (shaped === null) {
    throw new StartupRefusal(
      `${SIGNER_PACKAGE} returned something that is not a Signer. Expected { address, scheme, ` +
        'signPersonalMessage, signTransaction }. Refusing to start rather than arming a spending ' +
        'tool against an object this package cannot describe.',
    );
  }

  return (await probeSigner(shaped))
    ? { kind: 'signing', signer: shaped }
    : { kind: 'read-only', signer: shaped };
}

export async function serveStdio(server: McpServer): Promise<void> {
  await server.connect(new StdioServerTransport());
  log('listening on stdio');
}

export const MCP_PATH = '/mcp';

export const DISCOVERY_PATH = '/.well-known/mcp.json';

export const GLAMA_PATH = '/.well-known/glama.json';
export const GLAMA_CLAIM = 'glama_claim_o-_Gm-jHE0A1-cMdeJRYmXxso3KeH6T2';

export interface Discovery {
  name: string;
  description: string;
  endpoint: string;
  transport: 'streamable-http';
  tools: string[];
  readOnly: boolean;
  authentication: 'none';
  free: string;
  documentation: string;
  manifest: string;
  note: string;
}

export function canonicalOrigin(options: ServerOptions, requestHost: string | undefined): string {
  const host = options.allowedHosts[0] ?? requestHost;
  if (host === undefined || host.trim() === '') return '';
  const loopback = /^(127\.0\.0\.1|localhost|\[::1\])(:|$)/.test(host);
  return `${loopback ? 'http' : 'https'}://${host}`;
}

const SPENDING_TOOLS = ['weir_buy', 'weir_subscribe', 'weir_post', 'weir_send', 'weir_price'] as const;

const WRITING_TOOLS = [...SPENDING_TOOLS, 'weir_declare'] as const;

export function describeTools(tools: readonly string[]): string {
  const has = (name: string): boolean => tools.includes(name);
  const can: string[] = [];
  if (has('weir_search') || has('weir_read')) can.push('read what a creator published');
  if (has('weir_quote')) can.push('price it from the chain');
  if (has('weir_authorship')) can.push('check who signed it');
  if (has('weir_agents') || has('weir_seeking')) can.push('see the other agents');
  if (has('weir_balance')) can.push('check a balance');
  if (tools.some((t) => (SPENDING_TOOLS as readonly string[]).includes(t))) {
    can.push('buy, subscribe, price and publish with the bound key');
  }
  if (has('weir_declare')) can.push('declare itself to the register, for its operator to counter-sign');
  if (can.length === 0) return 'weir.social as a tool: this process registered no tools.';
  const list = can.length === 1 ? can[0] : `${can.slice(0, -1).join(', ')}, and ${can[can.length - 1]}`;
  return `weir.social as a tool: ${list}. An agent holds the same account a person holds.`;
}

export function describeFree(tools: readonly string[]): string {
  const has = (name: string): boolean => tools.includes(name);
  const spends = tools.some((t) => (SPENDING_TOOLS as readonly string[]).includes(t));
  if (!spends) {
    return tools.length === 0
      ? 'This process registered no tools, so nothing here can spend.'
      : 'Every tool on this endpoint is free and reads only. Nothing here can spend, and there ' +
        'is no account to open to use it.';
  }
  const reads = ['weir_search', 'weir_read', 'weir_authorship', 'weir_quote', 'weir_agents', 'weir_seeking', 'weir_balance'].filter(has);
  const parts: string[] = [];
  if (reads.length > 0) {
    const list = reads.length === 1 ? reads[0] : `${reads.slice(0, -1).join(', ')} and ${reads[reads.length - 1]}`;
    parts.push(`${list} ${reads.length === 1 ? 'is a free read' : 'are free reads'}.`);
  }
  const buySub = ['weir_buy', 'weir_subscribe'].filter(has);
  if (buySub.length > 0) {
    parts.push(`${buySub.join(' and ')} spend${buySub.length === 1 ? 's' : ''} from your own wallet.`);
  }
  if (has('weir_price')) parts.push('weir_price changes what every future buyer pays.');
  const writes = ['weir_post', 'weir_send'].filter(has);
  if (writes.length > 0) {
    parts.push(
      `${writes.join(' and ')} write${writes.length === 1 ? 's' : ''} publicly under your own ` +
        `account and cost${writes.length === 1 ? 's' : ''} gas.`,
    );
  }
  return parts.join(' ');
}

export function discoveryDocument(options: ServerOptions, tools: readonly string[], origin: string): Discovery {
  const readOnly = !tools.some((t) => (WRITING_TOOLS as readonly string[]).includes(t));
  return {
    name: 'weir',
    description: describeTools(tools),
    endpoint: `${origin}${MCP_PATH}`,
    transport: 'streamable-http',
    tools: [...tools],
    readOnly,
    authentication: 'none',
    free: describeFree(tools),
    documentation: `${options.baseUrl}/llms.txt`,
    manifest: `${options.baseUrl}/.well-known/weir-agent.json`,
    note:
      readOnly
        ? 'This endpoint holds no key and registers no tool that spends or writes. It exits before ' +
          'listening if a key is placed in its environment. To buy, subscribe, price or publish, run ' +
          '@projectx-social/mcp yourself with your own key. Nothing hosted here will ever hold yours. ' +
          'There is no ratified standard for this file; it is served because clients ask for it.'
        : 'This process has spending tools registered, so it is bound to a key. It is not the hosted ' +
          'endpoint. There is no ratified standard for this file; it is served because clients ask for it.',
  };
}

export function originAllowed(origin: string | undefined, allowed: readonly string[]): boolean {
  if (origin === undefined) return true;
  return allowed.includes(origin);
}

export function hostAllowed(host: string | undefined, allowed: readonly string[]): boolean {
  if (host === undefined || host.trim() === '') return false;
  const seen = host.trim().toLowerCase();
  return allowed.some((entry) => entry.trim().toLowerCase() === seen);
}

export async function serveHttp(
  newServer: () => Promise<McpServer>,
  options: ServerOptions,
): Promise<HttpServer> {
  const http = createServer((req: IncomingMessage, res: ServerResponse) => {
    void handleHttpRequest(req, res, newServer, options);
  });

  await new Promise<void>((resolve) => {
    http.listen(options.httpPort, options.httpHost, resolve);
  });

  log(`listening on http://${options.httpHost}:${options.httpPort}${MCP_PATH} (stateless, keyless)`);
  log(`Host allowlist: ${options.allowedHosts.join(', ')} — anything else is refused (DNS rebinding)`);
  if (options.allowedOrigins.length === 0) {
    log(`no ${ENV.allowedOrigins} set: browser origins are refused, non-browser clients are served`);
  }
  return http;
}

async function handleHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  newServer: () => Promise<McpServer>,
  options: ServerOptions,
): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  res.setHeader('Strict-Transport-Security', 'max-age=63072000');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'");

  if (url.pathname === '/') {
    respondJson(res, 200, {
      service: 'weir-mcp',
      detail:
        `This host serves Model Context Protocol at ${MCP_PATH} over streamable HTTP, and ` +
        `describes itself at ${DISCOVERY_PATH}. There is nothing at the root. Documentation is at ` +
        'https://weir.social/llms.txt.',
      mcp: MCP_PATH,
      discovery: DISCOVERY_PATH,
    });
    return;
  }

  if (url.pathname !== MCP_PATH && url.pathname !== DISCOVERY_PATH && url.pathname !== GLAMA_PATH) {
    respondJson(res, 404, { error: 'not_found', detail: `MCP is served at ${MCP_PATH}` });
    return;
  }

  if (!hostAllowed(req.headers.host, options.allowedHosts)) {
    respondJson(res, 403, {
      error: 'host_refused',
      detail:
        `Host ${String(req.headers.host)} is not one this endpoint answers to. Set ` +
        `${ENV.allowedHosts} if this deployment is reached under another name.`,
    });
    return;
  }

  if (url.pathname === DISCOVERY_PATH) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      respondJson(res, 405, { error: 'method_not_allowed', detail: `${DISCOVERY_PATH} answers GET. MCP is served at ${MCP_PATH}.` });
      return;
    }
    respondJson(res, 200, discoveryDocument(options, options.discoveryTools, canonicalOrigin(options, req.headers.host)), {
      'access-control-allow-origin': '*',
      'cache-control': 'public, max-age=300',
    });
    return;
  }

  if (url.pathname === GLAMA_PATH) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      respondJson(res, 405, { error: 'method_not_allowed', detail: `${GLAMA_PATH} answers GET. MCP is served at ${MCP_PATH}.` });
      return;
    }
    respondJson(
      res,
      200,
      { $schema: 'https://glama.ai/mcp/schemas/connector.json', claim: GLAMA_CLAIM },
      { 'access-control-allow-origin': '*', 'cache-control': 'public, max-age=300' },
    );
    return;
  }

  if (!originAllowed(req.headers.origin, options.allowedOrigins)) {
    respondJson(res, 403, {
      error: 'origin_refused',
      detail: `Origin ${String(req.headers.origin)} is not in ${ENV.allowedOrigins}.`,
    });
    return;
  }

  if (req.headers.cookie !== undefined) {
    respondJson(res, 400, {
      error: 'cookie_refused',
      detail:
        'this endpoint accepts no cookies and issues none. There is no session here to carry: ' +
        'every weir write is authorised by a fresh single-use signature, never by ambient ' +
        'credentials. Send the request without a Cookie header.',
    });
    return;
  }

  const server = await newServer();
  const transport = new StreamableHTTPServerTransport({
    enableJsonResponse: true,
  });

  res.on('close', () => {
    void transport.close();
    void server.close();
  });

  try {
    await server.connect(asTransport(transport));
    await transport.handleRequest(req, res);
  } catch (error) {
    log('http request failed:', error instanceof Error ? error.message : String(error));
    if (!res.headersSent) {
      respondJson(res, 500, { error: 'internal', detail: 'the request could not be served' });
    }
  }
}

function asTransport(transport: StreamableHTTPServerTransport): Transport {
  return transport as unknown as Transport;
}

function respondJson(res: ServerResponse, status: number, body: unknown, extra: Record<string, string> = {}): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text), ...extra });
  res.end(text);
}
