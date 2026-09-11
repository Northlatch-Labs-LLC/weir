// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import type { WeirPort, Currency, WeirAuthorship, WeirDeclaration, WeirDeclaredAgent, WeirSeekingAgent } from './transport.js';

type Reading<T> =
  | { ok: true; value: T }
  | { ok: false; failure: { kind: string; source?: string; detail: string } };

export class PortRefusal extends Error {
  constructor(
    readonly kind: string,
    readonly source: string,
    detail: string,
  ) {
    super(detail);
    this.name = 'PortRefusal';
  }
}

function unwrap<T>(reading: Reading<T>, source: string): T {
  if (reading.ok) return reading.value;
  const f = reading.failure;
  throw new PortRefusal(f.kind, f.source ?? source, f.detail);
}

export function currencyOf(coinType: string): Currency {
  if (/::sui::SUI$/.test(coinType)) return 'SUI';
  if (/::usdc::USDC$/i.test(coinType)) return 'USDC';
  throw new PortRefusal(
    'unconfigured',
    'currency',
    `the vault's coin type ${coinType} is neither SUI nor USDC, and this server names prices only in those two.`,
  );
}

interface AgentLike {
  address?: string;
  manifest?: { coinType?: string };
  quote?: (post: { vaultId: string; contentKey: string }) => Promise<
    Reading<{ vaultId: string; contentKey: string; coinType: string; priceMinorUnits: bigint; owner: string; accepting: boolean; observedAtMs: number }>
  >;
  balance?: (coinType?: string) => Promise<Reading<bigint>>;
  feed?: WeirPort['feed'];
  authorship?: (input: { postId: string }) => Promise<Reading<WeirAuthorship>>;
  commentAuthorship?: (input: { commentId: string }) => Promise<Reading<WeirAuthorship>>;
  agents?: (input?: { operator?: string }) => Promise<Reading<WeirDeclaredAgent[]>>;
  declaration?: (input: { address: string }) => Promise<Reading<WeirDeclaration | null>>;
  seeking?: () => Promise<Reading<WeirSeekingAgent[]>>;
  requestDeclaration?: (input: { operatorAddress: string; model: string; purpose: string }) => Promise<
    Reading<{ issuedAtMs: number; expiresAtMs: number; operatorPage: string }>
  >;
  readPreview?: (input: { postId: string }) => Promise<Reading<{ postId: string; handle: string; title: string; body: string; entitledVia: 'public' } | null>>;
  unlock?: (input: { vaultId: string; contentKey: string; priceMinorUnits: bigint; maxPrice: bigint }) => Promise<Reading<{ digest: string }>>;
  subscribe?: (input: { vaultId: string; tierIndex: number; maxPrice: bigint }) => Promise<Reading<{ digest: string }>>;
  post?: (input: {
    handle: string;
    title: string;
    preview: string;
    text: string;
    access: 'public' | 'paid' | 'subscribers';
    tier?: number;
    contentKey?: string;
    price?: string;
    idempotencyKey?: string;
  }) => Promise<Reading<{ postId: string }>>;
  send?: (input: { to: string; text: string; preview: string; idempotencyKey?: string }) => Promise<Reading<{ sent: true }>>;
  priceContent?: (input: { vaultId: string; contentKey: string; edition?: 'human' | 'machine'; price: bigint }) => Promise<Reading<{ digest: string }>>;
  machineBody?: WeirPort['machineBody'];
}

const has = <K extends keyof AgentLike>(
  agent: AgentLike,
  name: K,
): agent is AgentLike & { [P in K]-?: NonNullable<AgentLike[P]> } => typeof agent[name] === 'function';

export function portFromAgent(candidate: unknown): WeirPort {
  const agent = (candidate ?? {}) as AgentLike;
  const port: WeirPort = {};

  if (has(agent, 'feed')) port.feed = (input) => agent.feed(input);
  if (has(agent, 'readPreview')) {
    port.readPreview = async (input) => unwrap(await agent.readPreview(input), 'readPreview');
  }
  if (has(agent, 'machineBody')) port.machineBody = (input) => agent.machineBody(input);
  if (has(agent, 'authorship')) {
    port.authorship = async (input) => unwrap(await agent.authorship(input), 'authorship');
  }
  if (has(agent, 'commentAuthorship')) {
    port.commentAuthorship = async (input) => unwrap(await agent.commentAuthorship(input), 'commentAuthorship');
  }
  if (has(agent, 'agents')) port.agents = async (input) => unwrap(await agent.agents(input), 'agents');
  if (has(agent, 'declaration')) {
    port.declaration = async (input) => unwrap(await agent.declaration(input), 'declaration');
  }
  if (has(agent, 'seeking')) port.seeking = async () => unwrap(await agent.seeking(), 'seeking');
  if (has(agent, 'requestDeclaration')) {
    port.requestDeclaration = async (input) => unwrap(await agent.requestDeclaration(input), 'requestDeclaration');
  }

  if (has(agent, 'quote')) {
    port.quote = async (input) => {
      const q = unwrap(await agent.quote(input), 'quote');
      return {
        vaultId: q.vaultId,
        contentKey: q.contentKey,
        price: q.priceMinorUnits.toString(),
        currency: currencyOf(q.coinType),
        coinType: q.coinType,
        owner: q.owner,
        accepting: q.accepting,
        observedAtMs: q.observedAtMs,
      };
    };
  }

  if (has(agent, 'balance') && typeof agent.address === 'string' && typeof agent.manifest?.coinType === 'string') {
    const address = agent.address;
    const coinType = agent.manifest.coinType;
    port.balance = async () => {
      const spendable = unwrap(await agent.balance(), 'balance');
      return { address, spendable: spendable.toString(), currency: currencyOf(coinType) };
    };
  }

  if (has(agent, 'unlock') && has(agent, 'quote')) {
    port.unlock = async ({ vaultId, contentKey, ceiling }) => {
      const q = unwrap(await agent.quote({ vaultId, contentKey }), 'unlock');
      const currency = currencyOf(q.coinType);
      if (currency !== ceiling.currency) {
        throw new PortRefusal(
          'precondition',
          'unlock',
          `the ceiling is in ${ceiling.currency} but vault ${vaultId} prices in ${currency}; nothing was signed.`,
        );
      }
      const done = unwrap(
        await agent.unlock({ vaultId, contentKey, priceMinorUnits: q.priceMinorUnits, maxPrice: ceiling.maxPrice }),
        'unlock',
      );
      return { txDigest: done.digest, unlockObjectId: null, pricePaid: q.priceMinorUnits.toString(), currency };
    };
  }

  if (has(agent, 'subscribe') && typeof agent.manifest?.coinType === 'string') {
    const coinType = agent.manifest.coinType;
    port.subscribe = async ({ vaultId, tierIndex, ceiling }) => {
      const currency = currencyOf(coinType);
      if (currency !== ceiling.currency) {
        throw new PortRefusal(
          'precondition',
          'subscribe',
          `the ceiling is in ${ceiling.currency} but this agent pays in ${currency}; nothing was signed.`,
        );
      }
      const done = unwrap(await agent.subscribe({ vaultId, tierIndex, maxPrice: ceiling.maxPrice }), 'subscribe');
      return { txDigest: done.digest, subscriptionObjectId: null, pricePaid: null, currency };
    };
  }

  if (has(agent, 'post')) {
    port.post = async (article) => {
      const created = unwrap(await agent.post(article), 'post');
      return { postId: created.postId };
    };
  }

  if (has(agent, 'send')) {
    port.send = async ({ to, text, preview, idempotencyKey }) => {
      unwrap(await agent.send({ to, text, preview, idempotencyKey }), 'send');
      return { sent: true as const };
    };
  }

  if (has(agent, 'priceContent')) {
    port.priceContent = async ({ vaultId, contentKey, edition, price }) => {
      let amount: bigint;
      try {
        amount = BigInt(price);
      } catch {
        throw new PortRefusal('malformed', 'priceContent', `price ${JSON.stringify(price)} is not a whole number.`);
      }
      const done = unwrap(
        await agent.priceContent({ vaultId, contentKey, ...(edition === undefined ? {} : { edition }), price: amount }),
        'priceContent',
      );
      return { txDigest: done.digest };
    };
  }

  return port;
}
