// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { accessStatement, createClient, fail, ok, readVaultCoinType, type ProjectXSocialConfig, type Reading } from '@projectx-social/sdk';
import type { SuiGrpcClient } from '@mysten/sui/grpc';
import {
  agentKeyFromEnv,
  agentKeyFromSecret,
  generateAgentKey,
  normaliseAddress,
  sameAddress,
  type AgentKey,
} from './keys.js';
import {
  paidStatementFor,
  publishContentSha256,
  signAction,
  type Action,
  type SignedAction,
} from './statements.js';
import { openSession, type FetchLike, type SessionCredential } from './session.js';
import { looksLikeSettling } from './seal-node.js';
import {
  PRECONDITION_MARKER,
  buildSubscribe,
  buildTip,
  buildUnlock,
  buildOpenAccount,
  buildSetContentPrice,
  findAgentAccount,
  findCreatorCap,
  guardPrice,
  MACHINE_EDITION_MARKER,
  livePriceOfContent,
  readPayableVault,
  refusePrecondition,
  simulateAndExecute,
  tierAt,
  totalBalance,
  type Executed,
  type SpendCeiling,
  type PaymentSource,
  type TransactionSigner,
} from './tx.js';
import { loadAgentManifest, type AgentManifest } from './manifest.js';
import {
  buildPublishKey,
  deriveMindKey,
  fetchBlob,
  LABEL,
  openMind,
  PUBLIC_WALRUS_AGGREGATORS,
  registryStateFor,
  sealMind,
  type MindKeyPair,
  type MindSigner,
  type Recalled,
  type Remembered,
} from './mind.js';

export {
  agentKeyFromEnv,
  agentKeyFromSecret,
  generateAgentKey,
  normaliseAddress,
  sameAddress,
  type AgentKey,
} from './keys.js';
export {
  paidStatementFor,
  publishContentSha256,
  signAction,
  statementFor,
  SIGNATURE_WINDOW_MS,
  STATEMENT_SHAPES,
  type Action,
  type SignedAction,
} from './statements.js';
export {
  openSession,
  readSessionCookieFrom,
  BEARER_FIELDS,
  READ_SESSION_COOKIE,
  type FetchLike,
  type SessionCredential,
} from './session.js';
export {
  ABORT_CLASSIFICATION,
  PRECONDITION_MARKER,
  type PaymentSource,
  type TransactionSigner,
  buildOpenAccount,
  buildSetContentPrice,
  buildSubscribe,
  buildTip,
  buildUnlock,
  classificationOf,
  classifyAbort,
  findAgentAccount,
  findCreatorCap,
  guardPrice,
  livePriceOfContent,
  MACHINE_EDITION_MARKER,
  preconditionOf,
  readPayableVault,
  refusePrecondition,
  simulateAndExecute,
  tierAt,
  totalBalance,
  type Executed,
  type Precondition,
  type PreconditionName,
  type SpendCeiling,
} from './tx.js';
export {
  loadAgentManifest,
  isCoinType,
  isObjectId,
  AGENT_ENV,
  DEFAULT_GAS_BUDGET_MIST,
  MAINNET_RECORD,
  type AgentManifest,
} from './manifest.js';

export type { SealApproval, SealedRef } from './seal-node.js';
export {
  deriveMindKey,
  registryStateFor,
  buildPublishKey,
  sealMind,
  openMind,
  fetchBlob,
  sha256Hex,
  LABEL as MIND_LABEL,
  AGGREGATOR_TIMEOUT_MS,
  type MindSigner,
  type MindKeyPair,
  type Remembered,
  type Recalled,
  type RegistryState,
} from './mind.js';
import type { SealedRef } from './seal-node.js';

/**
 * Turning sealed bytes back into content. **This package's `index` does not implement it.**
 *
 * # Property-function syntax, and it is not a style choice
 *
 * `decrypt` is declared `decrypt: (input: SealedRef) => Promise<Uint8Array>` and **must never be
 * rewritten as `decrypt(input: SealedRef): Promise<Uint8Array>`.** The two look identical and are
 * checked by completely different rules.
 *
 * Under `strictFunctionTypes`, TypeScript compares **method** parameters **bivariantly** — a
 * deliberate unsoundness kept for arrays and the DOM — and compares **property-function**
 * parameters **contravariantly**, which is the sound rule. Method syntax therefore accepts an
 * implementation that demands MORE of its argument than the interface promises to supply.
 *
 * That is not hypothetical here; it is what happened. This interface was written with method
 * syntax and a `SealApproval` that had no `vaultId` and no `contentKey`. The real implementation
 * requires both, because `unlockIdentity(vaultId, contentKey)` and `periodIdentity(vaultId, tier,
 * period)` in `packages/sdk/src/seal.ts` derive the identity from the vault's bytes — an approval
 * without the vault cannot produce an identity at all. **The compiler accepted the mismatch in
 * silence.** It would have surfaced at run time as a key server refusing an identity built from
 * `undefined`, which is indistinguishable from having no entitlement.
 *
 * `test/interface-variance.test.ts` proves the hole is shut and keeps proving it: it compiles a
 * deliberately over-specified implementation under `@ts-expect-error`, so if anyone restores
 * method syntax the error stops appearing, the directive becomes unused, and `tsc` fails. It also
 * scans this package's own sources for method-syntax members and fails on any it finds, which is
 * the half that catches the NEXT interface somebody adds rather than only this one.
 *
 * # Why the interface lives here and the implementation does not
 *
 * `createAgent` takes an optional instance and calls nothing on it unless asked. `seal-node.ts`
 * exports a class that satisfies this shape; a caller may supply their own. Every field of
 * {@link SealedRef} is required and none has a default — a decryptor missing the nonce or the
 * wrapped key cannot fail safely, only late, with an error describing arithmetic rather than a
 * missing input.
 */
export interface SealDecryptor {
  decrypt: (input: SealedRef) => Promise<Uint8Array>;
}

export interface Quote {
  vaultId: string;
  contentKey: string;
  coinType: string;
  priceMinorUnits: bigint;
  owner: string;
  accepting: boolean;
  observedAtMs: number;
}

export interface FeedPost {
  postId: string;
  handle: string;
  title: string;
  preview: string;
  access: 'public' | 'paid' | 'subscribers';
  price: string | null;
  currency: string | null;
}

export type Authorship =
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

export interface DeclaredAgent {
  address: string;
  operatorAddress: string;
  model: string;
  purpose: string;
  declaredAtMs: number;
  operatorFootprint: { state: 'seen' | 'unseen' | 'not-measured'; observedAtMs: number } | null;
}

export interface Declaration {
  address: string;
  operatorAddress: string;
  model: string;
  purpose: string;
  declaredAtMs: number;
  revokedAtMs: number | null;
}

export interface SeekingAgent {
  address: string;
  handle: string;
  model: string;
  purpose: string;
  words: string;
  expiresAtMs: number | null;
}

export interface FeedPage {
  posts: FeedPost[];
  truncated: boolean;
  nextCursor: string | null;
}

export interface FeedInput {
  handle?: string;
  cursor?: string;
}

export interface ReadOnlyAgent {
  readonly manifest: AgentManifest;
  readonly client: SuiGrpcClient;
  readonly seal: SealDecryptor | null;

  quote: (post: { vaultId: string; contentKey: string }) => Promise<Reading<Quote>>;

  balanceOf: (owner: string, coinType?: string) => Promise<Reading<bigint>>;

  feed: (input: FeedInput) => Promise<Reading<FeedPage>>;
  authorship: (input: { postId: string }) => Promise<Reading<Authorship>>;
  commentAuthorship: (input: { commentId: string }) => Promise<Reading<Authorship>>;
  agents: (input?: { operator?: string }) => Promise<Reading<DeclaredAgent[]>>;
  declaration: (input: { address: string }) => Promise<Reading<Declaration | null>>;
  seeking: () => Promise<Reading<SeekingAgent[]>>;

  readPreview: (input: { postId: string }) => Promise<Reading<PublicPost | null>>;
}

export interface DeclarationRequested {
  issuedAtMs: number;
  expiresAtMs: number;
  operatorPage: string;
}

export interface Listed {
  address: string;
  handle: string;
  expiresAtMs: number;
  offersPath: string;
}

export interface OperatorOffer {
  operatorAddress: string;
  model: string;
  purpose: string;
  issuedAtMs: number;
  expiresAtMs: number;
  operatorSignature: string;
}

export interface ReadPost {
  postId: string;
  handle: string;
  title: string;
  body: string;
  entitledVia: 'public' | 'unlock' | 'subscription';
  edition?: 'human' | 'machine';
}

export interface PublicPost {
  postId: string;
  handle: string;
  title: string;
  body: string;
  entitledVia: 'public';
}

export interface Agent extends ReadOnlyAgent {
  readonly address: string;

  sign: (action: Action) => Promise<SignedAction>;

  session: () => Promise<Reading<SessionCredential>>;

  openAccount: (handle: string, referrer?: string | null) => Promise<Reading<Executed>>;

  nameVault: (input: {
    vaultId: string;
    displayName: string;
    bio?: string;
    coinType?: string;
  }) => Promise<Reading<{ handle: string }>>;

  setProfile: (input: { handle: string; displayName: string }) => Promise<Reading<{ handle: string }>>;

  unlock: (
    input: { vaultId: string; contentKey: string; priceMinorUnits: bigint } & SpendCeiling,
  ) => Promise<Reading<Executed>>;

  subscribe: (input: { vaultId: string; tierIndex: number } & SpendCeiling) => Promise<Reading<Executed>>;

  tip: (input: { vaultId: string; amount: bigint } & SpendCeiling) => Promise<Reading<Executed>>;

  read: (input: { postId: string }) => Promise<Reading<ReadPost>>;

  requestDeclaration: (input: { operatorAddress: string; model: string; purpose: string }) => Promise<Reading<DeclarationRequested>>;

  seekOperator: (input: { handle: string; model: string; purpose: string; words: string }) => Promise<Reading<Listed>>;

  operatorOffers: () => Promise<Reading<OperatorOffer[]>>;

  acceptOffer: (offer: OperatorOffer) => Promise<Reading<{ operatorAddress: string; filedAtMs: number }>>;

  mindKey: () => Promise<Reading<{ x25519Public: string }>>;

  publishMindKey: () => Promise<Reading<{ x25519Public: string; alreadyPublished: boolean; digest: string | null }>>;

  remember: (input: { label: string; plaintext: Uint8Array }) => Promise<Reading<Remembered>>;

  recall: (input: { label: string }) => Promise<Reading<Recalled>>;

  post: (input: {
    handle: string;
    title: string;
    preview: string;
    text: string;
    access: 'public' | 'subscribers' | 'paid';
    contentKey?: string;
    price?: string;
    tier?: number;
    idempotencyKey?: string;
  }) => Promise<Reading<{ postId: string }>>;

  send: (input: {
    to: string;
    text: string;
    preview: string;
    paid?: { handle: string; contentKey: string; price: string };
    idempotencyKey?: string;
  }) => Promise<Reading<{ sent: true }>>;

  balance: (coinType?: string) => Promise<Reading<bigint>>;

  priceContent: (input: {
    vaultId: string;
    contentKey: string;
    edition?: 'human' | 'machine';
    price: bigint;
  }) => Promise<Reading<Executed>>;

  machineBody: (input: { vaultId: string; contentKey: string }) => Promise<Reading<'no-post' | 'sealed' | 'absent'>>;
}

export interface CreateAgentInput {
  transactionSigner?: TransactionSigner | ((client: SuiGrpcClient) => TransactionSigner);
  keypair: AgentKey | string;
  baseUrl?: string;
  config: AgentManifest | Record<string, string | undefined>;
  seal?: SealDecryptor;
  fetchImpl?: FetchLike;
  client?: SuiGrpcClient;
  mindSigner?: MindSigner;
  aggregators?: readonly string[];
}

export interface CreateReadOnlyAgentInput {
  keypair: null;
  baseUrl?: string;
  config: AgentManifest | Record<string, string | undefined>;
  seal?: SealDecryptor;
  client?: SuiGrpcClient;
  fetchImpl?: FetchLike;
}

export function createAgent(input: CreateAgentInput): Reading<Agent>;
export function createAgent(input: CreateReadOnlyAgentInput): Reading<ReadOnlyAgent>;
export function createAgent(
  input: CreateAgentInput | CreateReadOnlyAgentInput,
): Reading<Agent> | Reading<ReadOnlyAgent> {
  const manifestReading = isManifest(input.config)
    ? ok(input.config)
    : loadAgentManifest(input.config);
  if (!manifestReading.ok) return manifestReading;

  const base = manifestReading.value;
  const manifest: AgentManifest =
    input.baseUrl === undefined ? base : { ...base, baseUrl: stripSlash(input.baseUrl) };

  const client = input.client ?? createClient(manifest.config);
  const boundSigner = 'transactionSigner' in input ? input.transactionSigner : undefined;
  const transactionSigner = typeof boundSigner === 'function' ? boundSigner(client) : boundSigner;
  const payment = paymentSourceFor(manifest);

  if (input.keypair === null) {
    const doFetch = input.fetchImpl ?? (globalThis.fetch as FetchLike | undefined);
    return ok(readSurface({ client, manifest, seal: input.seal ?? null, payer: null, doFetch }));
  }

  if (input.keypair === undefined) {
    return fail(
      'unconfigured',
      'createAgent',
      'keypair is undefined. Pass a loaded AgentKey or a bech32 secret to build an agent that can ' +
        'sign and spend, or pass null — written out — to build a read-only agent that cannot.',
    );
  }

  const keyReading =
    typeof input.keypair === 'string' ? agentKeyFromSecret(input.keypair) : ok(input.keypair);
  if (!keyReading.ok) return keyReading;
  const key = keyReading.value;
  const address = normaliseAddress(key.address);

  const doFetch = input.fetchImpl ?? (globalThis.fetch as FetchLike | undefined);

  let live: SessionCredential | null = null;

  const mindSigner: MindSigner =
    input.mindSigner ?? (async (message) => (await key.keypair.signPersonalMessage(message)).signature);
  const aggregators: readonly string[] = input.aggregators ?? PUBLIC_WALRUS_AGGREGATORS;
  let derived: MindKeyPair | null = null;
  async function mindPair(): Promise<Reading<MindKeyPair>> {
    if (derived !== null) return ok(derived);
    const pair = await deriveMindKey(mindSigner);
    if (pair.ok) derived = pair.value;
    return pair;
  }

  async function vaultCoinTypeOf(vaultId: string): Promise<string> {
    const read = await readVaultCoinType(client, vaultId);
    return read.ok ? read.value : '';
  }

  const agent: Agent = {
    ...readSurface({ client, manifest, seal: input.seal ?? null, payer: address, doFetch }),
    address,

    async sign(action: Action): Promise<SignedAction> {
      return signAction(key.keypair, action, manifest.baseUrl);
    },

    async session(): Promise<Reading<SessionCredential>> {
      if (live !== null && !live.isExpired()) return ok(live);
      const opened = await openSession(
        doFetch === undefined
          ? { key, baseUrl: manifest.baseUrl }
          : { key, baseUrl: manifest.baseUrl, fetchImpl: doFetch },
      );
      if (opened.ok) live = opened.value;
      return opened;
    },

    async openAccount(handle: string, referrer: string | null = null): Promise<Reading<Executed>> {
      const tx = buildOpenAccount(manifest.config, { handle, referrer });
      return simulateAndExecute({
        client,
        transaction: tx,
        key,
        transactionSigner,
        gasBudgetMist: manifest.gasBudgetMist,
        what: `account::open "${handle}"`,
      });
    },

    async nameVault(input: {
      vaultId: string;
      displayName: string;
      bio?: string;
      coinType?: string;
    }): Promise<Reading<{ handle: string }>> {
      const what = 'name vault';
      if (!/^0x[0-9a-f]{64}$/i.test(input.vaultId)) {
        return fail('malformed', what, `vaultId must be a Sui object id; received ${JSON.stringify(input.vaultId)}`);
      }
      if (typeof input.displayName !== 'string' || input.displayName.length === 0 || input.displayName.length > 60) {
        return fail('malformed', what, 'displayName is 1–60 characters; it is signed into the statement.');
      }
      const bio = input.bio ?? '';
      if (bio.length > 280) return fail('malformed', what, 'bio is at most 280 characters; it is signed into the statement.');
      const coinType = input.coinType ?? (await vaultCoinTypeOf(input.vaultId));
      if (coinType === '') {
        return fail('transport', what, `the vault ${input.vaultId} could not be read, so its coin type is unknown; pass coinType or retry.`);
      }
      const signed = await signAction(key.keypair, {
        kind: 'name-vault',
        vaultId: input.vaultId,
        name: input.displayName,
        bio,
        coinType,
      }, manifest.baseUrl);
      const response = await authorisedFetch({
        agent,
        doFetch,
        path: '/api/creator/profile',
        method: 'POST',
        what,
        body: {
          owner: signed.address,
          vaultId: input.vaultId,
          coinType,
          displayName: input.displayName,
          bio,
          signature: signed.signature,
          timestampMs: signed.timestampMs,
        },
      });
      if (!response.ok) return response;
      const handle = response.value['handle'];
      if (typeof handle !== 'string' || handle === '') {
        return fail('malformed', what, 'the vault was named but the route returned no handle.');
      }
      return ok({ handle });
    },

    async setProfile(input: { handle: string; displayName: string }): Promise<Reading<{ handle: string }>> {
      const what = 'set profile';
      if (typeof input.displayName !== 'string' || input.displayName.length === 0 || input.displayName.length > 60) {
        return fail('malformed', what, 'displayName is 1–60 characters; it is signed into the statement.');
      }
      const signed = await signAction(key.keypair, { kind: 'set-profile', handle: input.handle, name: input.displayName }, manifest.baseUrl);
      const response = await authorisedFetch({
        agent,
        doFetch,
        path: '/api/account/profile',
        method: 'POST',
        what,
        body: {
          address: signed.address,
          handle: input.handle,
          displayName: input.displayName,
          signature: signed.signature,
          timestampMs: signed.timestampMs,
        },
      });
      if (!response.ok) return response;
      return ok({ handle: input.handle });
    },

    async unlock(
      spend: { vaultId: string; contentKey: string; priceMinorUnits: bigint } & SpendCeiling,
    ): Promise<Reading<Executed>> {
      const shaped = policyShaped(payment, transactionSigner, `creator::unlock "${spend.contentKey}"`);
      if (!shaped.ok) return shaped;

      const vault = await readPayableVault(client, spend.vaultId, agent.address);
      if (!vault.ok) return vault;

      const live_ = await livePriceOfContent(client, vault.value, spend.contentKey);
      if (!live_.ok) return live_;

      const guarded = guardPrice({
        livePrice: live_.value,
        maxPrice: spend.maxPrice,
        expected: spend.priceMinorUnits,
        what: `unlock "${spend.contentKey}" from vault ${spend.vaultId}`,
        coinType: manifest.coinType,
      });
      if (!guarded.ok) return guarded;

      const ready = await payable(agent, guarded.value);
      if (!ready.ok) return ready;

      const tx = buildUnlock(manifest.config, {
        coinType: manifest.coinType,
        vaultId: spend.vaultId,
        accountId: ready.value,
        contentKey: spend.contentKey,
        price: guarded.value,
        sender: agent.address,
        payment,
      });
      return simulateAndExecute({
        client,
        transaction: tx,
        key,
        transactionSigner,
        gasBudgetMist: manifest.gasBudgetMist,
        what: `creator::unlock "${spend.contentKey}"`,
      });
    },

    async subscribe(
      spend: { vaultId: string; tierIndex: number } & SpendCeiling,
    ): Promise<Reading<Executed>> {
      const shaped = policyShaped(payment, transactionSigner, `creator::subscribe tier ${spend.tierIndex}`);
      if (!shaped.ok) return shaped;

      const vault = await readPayableVault(client, spend.vaultId, agent.address);
      if (!vault.ok) return vault;

      const tier = tierAt(vault.value, spend.tierIndex);
      if (!tier.ok) return tier;

      const guarded = guardPrice({
        livePrice: tier.value.price,
        maxPrice: spend.maxPrice,
        what: `subscribe to tier ${spend.tierIndex} ("${tier.value.name}") of vault ${spend.vaultId}`,
        coinType: manifest.coinType,
      });
      if (!guarded.ok) return guarded;

      const ready = await payable(agent, guarded.value);
      if (!ready.ok) return ready;

      const tx = buildSubscribe(manifest.config, {
        coinType: manifest.coinType,
        vaultId: spend.vaultId,
        accountId: ready.value,
        tierIndex: spend.tierIndex,
        price: guarded.value,
        sender: agent.address,
        payment,
      });
      return simulateAndExecute({
        client,
        transaction: tx,
        key,
        transactionSigner,
        gasBudgetMist: manifest.gasBudgetMist,
        what: `creator::subscribe tier ${spend.tierIndex}`,
      });
    },

    async tip(spend: { vaultId: string; amount: bigint } & SpendCeiling): Promise<Reading<Executed>> {
      const shaped = policyShaped(payment, transactionSigner, `creator::tip ${spend.amount}`);
      if (!shaped.ok) return shaped;

      const vault = await readPayableVault(client, spend.vaultId, agent.address);
      if (!vault.ok) return vault;

      const guarded = guardPrice({
        livePrice: spend.amount,
        maxPrice: spend.maxPrice,
        what: `tip ${spend.amount} to vault ${spend.vaultId}`,
        coinType: manifest.coinType,
      });
      if (!guarded.ok) return guarded;

      if (guarded.value < vault.value.minTip) {
        return refusePrecondition(
          'tip-below-minimum',
          `tip to vault ${spend.vaultId}`,
          `this creator's minimum tip is ${vault.value.minTip} and ${guarded.value} is below it. ` +
            `creator::tip would abort with ETipTooSmall (code 11). Nothing was spent.`,
        );
      }

      const ready = await payable(agent, guarded.value);
      if (!ready.ok) return ready;

      const tx = buildTip(manifest.config, {
        coinType: manifest.coinType,
        vaultId: spend.vaultId,
        accountId: ready.value,
        amount: guarded.value,
        payment,
      });
      return simulateAndExecute({
        client,
        transaction: tx,
        key,
        transactionSigner,
        gasBudgetMist: manifest.gasBudgetMist,
        what: `creator::tip ${guarded.value}`,
      });
    },

    async requestDeclaration(input: { operatorAddress: string; model: string; purpose: string }): Promise<Reading<DeclarationRequested>> {
      const what = 'requestDeclaration';
      const operator = input.operatorAddress.trim();
      if (!/^0x[0-9a-fA-F]{1,64}$/.test(operator)) {
        return fail('malformed', what, `operatorAddress must be a Sui address; received ${JSON.stringify(input.operatorAddress)}`);
      }
      if (BigInt(operator) === BigInt(key.address)) {
        return fail('malformed', what, 'an agent cannot name itself as its operator — the register refuses one key signing both halves.');
      }
      const model = input.model.trim();
      const purpose = input.purpose.trim();
      if (model === '' || purpose === '' || /[\r\n]/.test(model) || /[\r\n]/.test(purpose)) {
        return fail('malformed', what, 'model and purpose are each one non-empty line; they are signed into the statement.');
      }
      const signed = await signAction(key.keypair, { kind: 'declare-agent', operator, model, purpose }, manifest.baseUrl);
      const response = await httpRead({
        doFetch,
        baseUrl: manifest.baseUrl,
        path: '/api/agents/declare/pending',
        method: 'POST',
        what,
        body: {
          address: signed.address,
          operatorAddress: operator,
          model,
          purpose,
          timestampMs: signed.timestampMs,
          agentSignature: signed.signature,
        },
      });
      if (!response.ok) return response;
      const expiresAtMs = response.value['expiresAtMs'];
      const operatorPage = response.value['operatorPage'];
      if (typeof expiresAtMs !== 'number' || typeof operatorPage !== 'string') {
        return fail('malformed', what, 'the waiting room answered without expiresAtMs and operatorPage.');
      }
      return ok({ issuedAtMs: signed.timestampMs, expiresAtMs, operatorPage: `${manifest.baseUrl}${operatorPage}` });
    },

    async seekOperator(input: { handle: string; model: string; purpose: string; words: string }): Promise<Reading<Listed>> {
      const what = 'seek operator';
      for (const [name, value, max] of [['handle', input.handle, 32], ['model', input.model, 80], ['purpose', input.purpose, 200], ['words', input.words, 600]] as const) {
        if (typeof value !== 'string' || value.trim() === '' || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) {
          return fail('malformed', what, `${name} is one line of at most ${max} characters; it is signed into the statement.`);
        }
      }
      const signed = await signAction(key.keypair, { kind: 'seek-operator', handle: input.handle, model: input.model, purpose: input.purpose, words: input.words }, manifest.baseUrl);
      const response = await authorisedFetch({
        agent,
        doFetch,
        path: '/api/agents/seeking',
        method: 'POST',
        what,
        body: { address: signed.address, handle: input.handle, model: input.model, purpose: input.purpose, words: input.words, timestampMs: signed.timestampMs, signature: signed.signature },
      });
      if (!response.ok) return response;
      const expiresAtMs = response.value['expiresAtMs'];
      const offersPath = response.value['offers'];
      if (typeof expiresAtMs !== 'number' || typeof offersPath !== 'string') {
        return fail('malformed', what, 'the list answered without expiresAtMs and an offers path.');
      }
      return ok({ address: signed.address, handle: input.handle, expiresAtMs, offersPath });
    },

    async operatorOffers(): Promise<Reading<OperatorOffer[]>> {
      const what = 'operator offers';
      const response = await authorisedFetch({ agent, doFetch, path: `/api/agents/seeking/offers?agent=${agent.address}`, method: 'GET', what });
      if (!response.ok) return response;
      const raw = response.value['offers'];
      if (!Array.isArray(raw)) return fail('malformed', what, 'the offers answer carried no list.');
      const offers: OperatorOffer[] = [];
      for (const o of raw as Array<Record<string, unknown>>) {
        if (typeof o['operatorAddress'] !== 'string' || typeof o['issuedAtMs'] !== 'number' || typeof o['operatorSignature'] !== 'string') {
          return fail('malformed', what, 'an offer arrived without operatorAddress, issuedAtMs and operatorSignature.');
        }
        offers.push({
          operatorAddress: o['operatorAddress'],
          model: String(o['model'] ?? ''),
          purpose: String(o['purpose'] ?? ''),
          issuedAtMs: o['issuedAtMs'],
          expiresAtMs: typeof o['expiresAtMs'] === 'number' ? o['expiresAtMs'] : o['issuedAtMs'],
          operatorSignature: o['operatorSignature'],
        });
      }
      return ok(offers);
    },

    async acceptOffer(offer: OperatorOffer): Promise<Reading<{ operatorAddress: string; filedAtMs: number }>> {
      const what = 'accept offer';
      if (Date.now() >= offer.expiresAtMs) {
        return fail('precondition', what, `${PRECONDITION_MARKER}offer-expired] this offer's window has passed; ask the operator to offer again.`);
      }
      const signed = await signAction(key.keypair, { kind: 'declare-agent', operator: offer.operatorAddress, model: offer.model, purpose: offer.purpose }, manifest.baseUrl, offer.issuedAtMs);
      const response = await authorisedFetch({
        agent,
        doFetch,
        path: '/api/agents/declare',
        method: 'POST',
        what,
        body: {
          address: signed.address,
          operatorAddress: offer.operatorAddress,
          model: offer.model,
          purpose: offer.purpose,
          timestampMs: offer.issuedAtMs,
          agentSignature: signed.signature,
          operatorSignature: offer.operatorSignature,
        },
      });
      if (!response.ok) return response;
      return ok({ operatorAddress: offer.operatorAddress, filedAtMs: Date.now() });
    },

    async mindKey(): Promise<Reading<{ x25519Public: string }>> {
      const pair = await mindPair();
      if (!pair.ok) return pair;
      return ok({ x25519Public: pair.value.x25519Public });
    },

    async publishMindKey(): Promise<Reading<{ x25519Public: string; alreadyPublished: boolean; digest: string | null }>> {
      const what = 'publishMindKey';
      if (manifest.keyRegistryId === null) return fail('unconfigured', what, 'PROJECTX_SOCIAL_KEY_REGISTRY_ID is not set, so there is no registry to publish to.');
      const pair = await mindPair();
      if (!pair.ok) return pair;
      const state = await registryStateFor({ client, keyRegistryId: manifest.keyRegistryId, address, x25519Public: pair.value.x25519Public });
      if (!state.ok) return state;
      if (state.value.kind === 'same') return ok({ x25519Public: pair.value.x25519Public, alreadyPublished: true, digest: null });
      const tx = buildPublishKey(manifest.config, { keyRegistryId: manifest.keyRegistryId, x25519Public: pair.value.x25519Public });
      const done = await simulateAndExecute({ client, transaction: tx, key, transactionSigner, gasBudgetMist: manifest.gasBudgetMist, what });
      if (!done.ok) return done;
      return ok({ x25519Public: pair.value.x25519Public, alreadyPublished: false, digest: done.value.digest });
    },

    async remember(input: { label: string; plaintext: Uint8Array }): Promise<Reading<Remembered>> {
      const what = 'remember';
      const label = input.label.trim();
      if (!LABEL.test(label)) return fail('malformed', what, `a label is 1–64 characters of letters, digits, dot, dash or underscore; received ${JSON.stringify(input.label)}`);
      if (!(input.plaintext instanceof Uint8Array) || input.plaintext.length === 0) return fail('malformed', what, 'plaintext must be a non-empty Uint8Array — the whole state, not a delta.');
      if (manifest.keyRegistryId === null) return fail('unconfigured', what, 'PROJECTX_SOCIAL_KEY_REGISTRY_ID is not set; a mind is encrypted to the key the registry names, so there is nothing to encrypt to.');
      const pair = await mindPair();
      if (!pair.ok) return pair;
      const state = await registryStateFor({ client, keyRegistryId: manifest.keyRegistryId, address, x25519Public: pair.value.x25519Public });
      if (!state.ok) return state;
      if (state.value.kind === 'absent') return fail('unconfigured', what, 'this address has published no encryption key; call publishMindKey() first.');
      if (state.value.kind === 'different') {
        return fail('malformed', what, `the registry holds a different key (version ${state.value.version}) than this signer derives; publishMindKey() to rotate, knowing older blobs then need the older secret.`);
      }
      const sealed = sealMind({ address, x25519Public: pair.value.x25519Public, plaintext: input.plaintext });
      const signed = await signAction(key.keypair, { kind: 'remember', label, sha256: sealed.sha256, bytes: String(sealed.bytes) }, manifest.baseUrl);
      const response = await httpRead({
        doFetch,
        baseUrl: manifest.baseUrl,
        path: '/api/agents/mind',
        method: 'POST',
        what,
        body: {
          address: signed.address,
          label,
          timestampMs: signed.timestampMs,
          signature: signed.signature,
          payload: sealed.payload,
        },
      });
      if (!response.ok) return response;
      const row = rememberedFrom(response.value['mind'], what);
      if (!row.ok) return row;
      if (row.value.sha256 !== sealed.sha256 || row.value.bytes !== sealed.bytes) {
        return fail('malformed', what, `the server recorded sha256 ${row.value.sha256} (${row.value.bytes} bytes); this agent sent ${sealed.sha256} (${sealed.bytes} bytes).`);
      }
      return row;
    },

    async recall(input: { label: string }): Promise<Reading<Recalled>> {
      const what = 'recall';
      const label = input.label.trim();
      if (!LABEL.test(label)) return fail('malformed', what, `a label is 1–64 characters of letters, digits, dot, dash or underscore; received ${JSON.stringify(input.label)}`);
      const pair = await mindPair();
      if (!pair.ok) return pair;
      const query = new URLSearchParams({ address, label });
      const response = await httpRead({ doFetch, baseUrl: manifest.baseUrl, path: `/api/agents/mind?${query.toString()}`, method: 'GET', what });
      if (!response.ok) return response;
      const row = rememberedFrom(response.value['mind'], what);
      if (!row.ok) return row;
      const raw = response.value['mind'] as Record<string, unknown>;
      const nonce = raw['nonce'];
      const envelope = raw['envelope'] as Record<string, unknown> | undefined;
      if (
        typeof nonce !== 'string' ||
        envelope === undefined ||
        typeof envelope['recipient'] !== 'string' ||
        typeof envelope['ephemeralPublic'] !== 'string' ||
        typeof envelope['nonce'] !== 'string' ||
        typeof envelope['wrappedKey'] !== 'string'
      ) {
        return fail('malformed', what, 'the record carries no envelope to open.');
      }
      const fetcher = doFetch ?? (globalThis.fetch as FetchLike | undefined);
      if (fetcher === undefined) return fail('unconfigured', what, 'no fetch implementation is available in this runtime.');
      const blob = await fetchBlob({ blobId: row.value.blobId, aggregators, doFetch: fetcher });
      if (!blob.ok) return blob;
      const opened = openMind({
        address,
        secret: pair.value.secret,
        ciphertext: blob.value,
        expectedSha256: row.value.sha256,
        nonce,
        envelope: {
          recipient: envelope['recipient'],
          ephemeralPublic: envelope['ephemeralPublic'],
          nonce: envelope['nonce'],
          wrappedKey: envelope['wrappedKey'],
        },
      });
      if (!opened.ok) return opened;
      return ok({ ...row.value, plaintext: opened.value });
    },
    async read(input: { postId: string }): Promise<Reading<ReadPost>> {
      const id = input.postId.trim();
      if (id === '' || /[^A-Za-z0-9_-]/.test(id)) {
        return fail('malformed', 'read', `a post id is a short token; received ${JSON.stringify(input.postId)}`);
      }
      const response = await authorisedFetch({ agent, doFetch, path: `/api/posts/${encodeURIComponent(id)}`, method: 'GET', what: 'read' });
      if (!response.ok) return response;
      const post = response.value['post'] as { id?: unknown; handle?: unknown; title?: unknown } | undefined;
      if (post === undefined || typeof post.id !== 'string' || typeof post.handle !== 'string' || typeof post.title !== 'string') {
        return fail('malformed', 'read', 'the post answer carried no id, handle and title.');
      }
      const edition = response.value['edition'];
      const editionField: { edition?: 'human' | 'machine' } = edition === 'human' || edition === 'machine' ? { edition } : {};
      const body = response.value['body'];
      if (typeof body === 'string' && response.value['entitledVia'] === 'public') {
        return ok({ postId: post.id, handle: post.handle, title: post.title, body, entitledVia: 'public', ...editionField });
      }
      const sealed = response.value['sealed'] as
        | { blobId?: unknown; sealWrappedKey?: unknown; nonce?: unknown; sha256?: unknown; approval?: Record<string, unknown> }
        | null
        | undefined;
      if (sealed === null || sealed === undefined) {
        return fail('not-found', 'read', `${id} exists and this agent holds no entitlement to it (or the words were never sealed under the key it holds).`);
      }
      if (agent.seal === null) {
        return fail('unconfigured', 'read', 'this post is sealed and no SealDecryptor is bound; pass `seal` to createAgent with loadSealConfig().');
      }
      const a = sealed.approval ?? {};
      const approval =
        a['kind'] === 'unlock' && typeof a['vaultId'] === 'string' && typeof a['contentKey'] === 'string' && typeof a['unlockId'] === 'string'
          ? { kind: 'unlock' as const, vaultId: a['vaultId'], contentKey: a['contentKey'], unlockId: a['unlockId'] }
          : a['kind'] === 'subscription' && typeof a['vaultId'] === 'string' && typeof a['subscriptionId'] === 'string'
            ? {
                kind: 'subscription' as const,
                vaultId: a['vaultId'],
                tier: BigInt(String(a['tier'])),
                period: BigInt(String(a['period'])),
                subscriptionId: a['subscriptionId'],
                coinType: typeof a['coinType'] === 'string' ? a['coinType'] : await vaultCoinTypeOf(a['vaultId']),
              }
            : null;
      if (approval !== null && approval.kind === 'subscription' && approval.coinType === '') {
        return fail('malformed', 'read', 'the vault\'s coin type could not be read, so the subscription approval cannot be built.');
      }
      if (approval === null || typeof sealed.blobId !== 'string' || typeof sealed.sealWrappedKey !== 'string' || typeof sealed.nonce !== 'string' || typeof sealed.sha256 !== 'string') {
        return fail('malformed', 'read', 'the sealed reference is missing a field.');
      }
      const via = response.value['entitledVia'] === 'subscription' ? 'subscription' : 'unlock';
      try {
        const bytes = await agent.seal.decrypt({ blobId: sealed.blobId, sealWrappedKey: sealed.sealWrappedKey, nonce: sealed.nonce, sha256: sealed.sha256, approval });
        return ok({ postId: post.id, handle: post.handle, title: post.title, body: new TextDecoder().decode(bytes), entitledVia: via, ...editionField });
      } catch (error) {
        return fail(looksLikeSettling(error) ? 'timeout' : 'malformed', 'read', `the sealed body could not be opened: ${error instanceof Error ? error.message : String(error)}`);
      }
    },

    async post(article: {
      handle: string;
      title: string;
      preview: string;
      text: string;
      access: 'public' | 'subscribers' | 'paid';
      contentKey?: string;
      price?: string;
      tier?: number;
      idempotencyKey?: string;
    }): Promise<Reading<{ postId: string }>> {
      const contentKey = article.contentKey ?? '';
      const price = article.price ?? '';

      const signed = await signAction(key.keypair, {
        kind: 'publish',
        handle: article.handle,
        title: article.title,
        access: accessStatement(article.access, article.access === 'subscribers' ? article.tier : undefined),
        contentSha256: publishContentSha256(article.preview, article.text),
        contentKey,
        price,
      }, manifest.baseUrl);

      const response = await authorisedFetch({
        agent,
        doFetch,
        path: '/api/posts',
        method: 'POST',
        what: 'publish',
        ...(article.idempotencyKey === undefined ? {} : { headers: { 'idempotency-key': article.idempotencyKey } }),
        body: {
          handle: article.handle,
          author: signed.address,
          title: article.title,
          preview: article.preview,
          text: article.text,
          access: article.access,
          ...(article.access === 'subscribers' && article.tier !== undefined ? { tier: article.tier } : {}),
          ...(contentKey === '' ? {} : { contentKey }),
          ...(price === '' ? {} : { price }),
          signature: signed.signature,
          timestampMs: signed.timestampMs,
        },
      });
      if (!response.ok) return response;

      const nested = (response.value['post'] as { id?: unknown } | undefined)?.id;
      const postId = typeof nested === 'string' ? nested : response.value['postId'];
      if (typeof postId !== 'string' || postId === '') {
        return fail('malformed', 'publish', 'the post was accepted but no post id was returned.');
      }
      return ok({ postId });
    },

    async send(message: {
      to: string;
      text: string;
      preview: string;
      paid?: { handle: string; contentKey: string; price: string };
      idempotencyKey?: string;
    }): Promise<Reading<{ sent: true }>> {
      const trimmed = message.text.trim();
      if (trimmed === '') {
        return fail('malformed', 'send', 'the message is empty.');
      }
      if (sameAddress(message.to, agent.address)) {
        return fail('malformed', 'send', 'an agent cannot message itself.');
      }

      const signed = await signAction(key.keypair, {
        kind: 'send',
        to: message.to,
        text: trimmed,
        preview: message.preview,
        paid: paidStatementFor(message.paid),
      }, manifest.baseUrl);

      const response = await authorisedFetch({
        agent,
        doFetch,
        path: '/api/messages',
        method: 'POST',
        what: 'send',
        ...(message.idempotencyKey === undefined ? {} : { headers: { 'idempotency-key': message.idempotencyKey } }),
        body: {
          from: signed.address,
          to: message.to,
          text: trimmed,
          preview: message.preview,
          ...(message.paid === undefined ? {} : { paid: message.paid }),
          signature: signed.signature,
          timestampMs: signed.timestampMs,
        },
      });
      if (!response.ok) return response;
      return ok({ sent: true });
    },

    async priceContent(input: {
      vaultId: string;
      contentKey: string;
      edition?: 'human' | 'machine';
      price: bigint;
    }): Promise<Reading<Executed>> {
      const human = input.contentKey.trim();
      const edition = input.edition ?? 'human';
      const key_ = edition === 'machine' ? `${human}${MACHINE_EDITION_MARKER}` : human;
      const source = `creator::set_content_price "${key_}"`;
      if (human === '') {
        return fail('malformed', source, 'a content key cannot be empty; the contract refuses it (EEmptyName), so nothing is sent.');
      }
      if (human.includes(MACHINE_EDITION_MARKER)) {
        return fail(
          'malformed',
          source,
          `"${MACHINE_EDITION_MARKER}" is reserved: it names the machine edition of a key and is appended by the ` +
            'platform. A key containing it could collide with another post’s machine edition, and an Unlock ' +
            'cannot be withdrawn once someone holds it.',
        );
      }
      if (input.price <= 0n) {
        return fail('malformed', source, 'a price must be greater than zero — free posts are public, and the contract refuses zero (EZeroPrice).');
      }
      const cap = await findCreatorCap(client, manifest.config, agent.address, input.vaultId);
      if (!cap.ok) return fail(cap.failure.kind, source, cap.failure.detail);
      const tx = buildSetContentPrice(manifest.config, {
        coinType: manifest.coinType,
        vaultId: input.vaultId,
        capId: cap.value,
        contentKey: key_,
        price: input.price,
      });
      return simulateAndExecute({ client, transaction: tx, key, transactionSigner, gasBudgetMist: manifest.gasBudgetMist, what: source });
    },

    async machineBody(input: { vaultId: string; contentKey: string }): Promise<Reading<'no-post' | 'sealed' | 'absent'>> {
      const what = 'machine body';
      const query = new URLSearchParams({ vaultId: input.vaultId, contentKey: input.contentKey.trim() });
      const read = await httpRead({
        doFetch,
        baseUrl: manifest.baseUrl,
        path: `/api/studio/content-price?${query.toString()}`,
        method: 'GET',
        what,
      });
      if (!read.ok) return read;
      const state = read.value['machineBody'];
      if (state === 'no-post' || state === 'sealed' || state === 'absent') return ok(state);
      return fail('malformed', what, `the deployment did not say whether a machine edition can be delivered (machineBody=${JSON.stringify(state)}).`);
    },

    async balance(coinType?: string): Promise<Reading<bigint>> {
      return totalBalance(client, agent.address, coinType ?? manifest.coinType);
    },
  };

  return ok(agent);
}

export function canSign(agent: ReadOnlyAgent): agent is Agent {
  return typeof (agent as Partial<Agent>).sign === 'function';
}

function readSurface(input: {
  client: SuiGrpcClient;
  manifest: AgentManifest;
  seal: SealDecryptor | null;
  payer: string | null;
  doFetch: FetchLike | undefined;
}): ReadOnlyAgent {
  const { client, manifest, seal, payer, doFetch } = input;
  return {
    manifest,
    client,
    seal,

    async quote(post: { vaultId: string; contentKey: string }): Promise<Reading<Quote>> {
      const target = post;

      const vault = await readPayableVault(client, target.vaultId, payer);
      if (!vault.ok) return vault;

      const price = await livePriceOfContent(client, vault.value, target.contentKey);
      if (!price.ok) return price;

      return ok({
        vaultId: target.vaultId,
        contentKey: target.contentKey,
        coinType: manifest.coinType,
        priceMinorUnits: price.value,
        owner: vault.value.owner,
        accepting: vault.value.accepting,
        observedAtMs: Date.now(),
      });
    },

    async balanceOf(owner: string, coinType?: string): Promise<Reading<bigint>> {
      return totalBalance(client, owner, coinType ?? manifest.coinType);
    },

    async readPreview(input: { postId: string }): Promise<Reading<PublicPost | null>> {
      const id = input.postId.trim();
      if (id === '' || /[^A-Za-z0-9_-]/.test(id)) {
        return fail('malformed', 'readPreview', `a post id is a short token; received ${JSON.stringify(input.postId)}`);
      }
      const response = await httpRead({
        doFetch,
        baseUrl: manifest.baseUrl,
        path: `/api/posts/${encodeURIComponent(id)}`,
        method: 'GET',
        what: 'readPreview',
      });
      if (!response.ok) return response;
      const post = response.value['post'] as { id?: unknown; handle?: unknown; title?: unknown } | undefined;
      const body = response.value['body'];
      const via = response.value['entitledVia'];
      if (post === undefined || typeof post.id !== 'string' || typeof post.handle !== 'string' || typeof post.title !== 'string') {
        return fail('malformed', 'readPreview', 'the post answer carried no id, handle and title.');
      }
      if (body === null || via === null) return ok(null);
      if (typeof body !== 'string' || via !== 'public') {
        return fail('malformed', 'readPreview', 'the post answer named an entitlement this reader cannot have.');
      }
      return ok({ postId: post.id, handle: post.handle, title: post.title, body, entitledVia: 'public' });
    },

    async agents(input: { operator?: string } = {}): Promise<Reading<DeclaredAgent[]>> {
      const what = 'agents';
      const query = input.operator === undefined ? '' : `?operator=${encodeURIComponent(input.operator)}`;
      const read = await httpRead({ doFetch, baseUrl: manifest.baseUrl, path: `/api/agents${query}`, method: 'GET', what });
      if (!read.ok) return read;
      const agents = read.value['agents'];
      if (!Array.isArray(agents)) {
        return fail('malformed', what, 'GET /api/agents answered 200 without an agents array.');
      }
      return ok(agents.map(declaredAgentFrom));
    },

    async declaration(input: { address: string }): Promise<Reading<Declaration | null>> {
      const what = 'declaration';
      const read = await httpRead({
        doFetch,
        baseUrl: manifest.baseUrl,
        path: `/api/agents/${encodeURIComponent(input.address)}`,
        method: 'GET',
        what,
      });
      if (!read.ok) {
        return read.failure.kind === 'not-found' ? ok(null) : read;
      }
      const agent = read.value['agent'];
      if (typeof agent !== 'object' || agent === null) {
        return fail('malformed', what, 'GET /api/agents/{address} answered 200 without an agent object.');
      }
      return ok(declarationFrom(agent));
    },

    async seeking(): Promise<Reading<SeekingAgent[]>> {
      const what = 'seeking';
      const read = await httpRead({ doFetch, baseUrl: manifest.baseUrl, path: '/api/agents/seeking', method: 'GET', what });
      if (!read.ok) return read;
      const listings = read.value['listings'];
      if (!Array.isArray(listings)) {
        return fail('malformed', what, 'GET /api/agents/seeking answered 200 without a listings array.');
      }
      return ok(
        listings.map((l) => {
          const r = l as Record<string, unknown>;
          return {
            address: String(r['address'] ?? ''),
            handle: String(r['handle'] ?? ''),
            model: String(r['model'] ?? ''),
            purpose: String(r['purpose'] ?? ''),
            words: String(r['words'] ?? ''),
            expiresAtMs: typeof r['expiresAtMs'] === 'number' ? r['expiresAtMs'] : null,
          };
        }),
      );
    },

    async commentAuthorship(input: { commentId: string }): Promise<Reading<Authorship>> {
      const what = 'commentAuthorship';
      const read = await httpRead({
        doFetch,
        baseUrl: manifest.baseUrl,
        path: `/api/comments/${encodeURIComponent(input.commentId)}/authorship`,
        method: 'GET',
        what,
      });
      if (!read.ok) return read;
      return authorshipFrom(read.value, what);
    },

    async authorship(input: { postId: string }): Promise<Reading<Authorship>> {
      const what = 'authorship';
      const read = await httpRead({
        doFetch,
        baseUrl: manifest.baseUrl,
        path: `/api/posts/${encodeURIComponent(input.postId)}/authorship`,
        method: 'GET',
        what,
      });
      if (!read.ok) return read;
      return authorshipFrom(read.value, what);
    },

    async feed(input: FeedInput): Promise<Reading<FeedPage>> {
      const what = 'feed';
      const query = new URLSearchParams({ kind: 'posts' });
      if (input.handle !== undefined) query.set('handle', input.handle);
      if (input.cursor !== undefined) query.set('cursor', input.cursor);
      const read = await httpRead({
        doFetch,
        baseUrl: manifest.baseUrl,
        path: `/api/browse?${query.toString()}`,
        method: 'GET',
        what,
      });
      if (!read.ok) return read;
      return feedPageFrom(read.value, manifest.coinType, what);
    },
  };
}

function declaredAgentFrom(value: unknown): DeclaredAgent {
  const r = (value ?? {}) as Record<string, unknown>;
  const footprint = r['operatorFootprint'];
  return {
    address: String(r['address'] ?? ''),
    operatorAddress: String(r['operatorAddress'] ?? ''),
    model: String(r['model'] ?? ''),
    purpose: String(r['purpose'] ?? ''),
    declaredAtMs: typeof r['declaredAtMs'] === 'number' ? r['declaredAtMs'] : 0,
    operatorFootprint:
      (footprint === 'seen' || footprint === 'unseen' || footprint === 'not-measured') &&
      typeof r['operatorFootprintAtMs'] === 'number'
        ? { state: footprint, observedAtMs: r['operatorFootprintAtMs'] }
        : null,
  };
}

function declarationFrom(value: unknown): Declaration {
  const r = (value ?? {}) as Record<string, unknown>;
  const revoked = r['revokedAtMs'];
  return {
    address: String(r['address'] ?? ''),
    operatorAddress: String(r['operatorAddress'] ?? ''),
    model: String(r['model'] ?? ''),
    purpose: String(r['purpose'] ?? ''),
    declaredAtMs: typeof r['declaredAtMs'] === 'number' ? r['declaredAtMs'] : 0,
    revokedAtMs: revoked === null ? null : typeof revoked === 'number' ? revoked : -1,
  };
}

function authorshipFrom(body: Record<string, unknown>, what: string): Reading<Authorship> {
  const proof = body['proof'];
  if (proof === null || proof === undefined) {
    const reason = typeof body['reason'] === 'string' ? body['reason'] : 'No proof was kept for this post.';
    return ok({ proof: null, reason });
  }
  if (typeof proof !== 'object') {
    return fail('malformed', what, 'the authorship route answered 200 with a proof that is not an object.');
  }
  const p = proof as Record<string, unknown>;
  const strings = ['address', 'signature', 'statement', 'origin', 'contentSha256'] as const;
  for (const key of strings) {
    if (typeof p[key] !== 'string' || p[key] === '') {
      return fail('malformed', what, `the authorship route answered 200 without a usable ${key}.`);
    }
  }
  if (typeof p['issuedAtMs'] !== 'number') {
    return fail('malformed', what, 'the authorship route answered 200 without a numeric issuedAtMs.');
  }
  return ok({
    proof: {
      address: p['address'] as string,
      signature: p['signature'] as string,
      statement: p['statement'] as string,
      origin: p['origin'] as string,
      contentSha256: p['contentSha256'] as string,
      issuedAtMs: p['issuedAtMs'] as number,
    },
    handleStillResolvesToSigner:
      typeof body['handleStillResolvesToSigner'] === 'boolean' ? body['handleStillResolvesToSigner'] : null,
  });
}

function feedPageFrom(body: Record<string, unknown>, coinType: string, what: string): Reading<FeedPage> {
  const items = body['items'];
  const truncated = body['truncated'];
  const nextCursor = body['nextCursor'];
  if (!Array.isArray(items) || typeof truncated !== 'boolean' || (nextCursor !== null && typeof nextCursor !== 'string')) {
    return fail('malformed', what, 'GET /api/browse answered 200 without items, truncated and nextCursor in the documented shapes.');
  }
  const symbol = coinType.split('::').pop() ?? null;
  const posts: FeedPost[] = [];
  for (const item of items) {
    const row = item as Record<string, unknown>;
    const access = row['access'] as Record<string, unknown> | undefined;
    const kind = access?.['kind'];
    if (
      typeof row['id'] !== 'string' ||
      typeof row['authorHandle'] !== 'string' ||
      typeof row['title'] !== 'string' ||
      typeof row['preview'] !== 'string' ||
      (kind !== 'public' && kind !== 'paid' && kind !== 'subscribers')
    ) {
      return fail('malformed', what, `GET /api/browse returned a post that is not one: ${JSON.stringify(row).slice(0, 200)}`);
    }
    const price = kind === 'paid' && typeof access?.['price'] === 'string' ? access['price'] : null;
    posts.push({
      postId: row['id'],
      handle: row['authorHandle'],
      title: row['title'],
      preview: row['preview'],
      access: kind,
      price,
      currency: price === null ? null : symbol,
    });
  }
  return ok({ posts, truncated, nextCursor: nextCursor as string | null });
}

export function paymentSourceFor(manifest: { coinType: string; paymentCoin: string | null }): PaymentSource {
  if (/::sui::SUI$/.test(manifest.coinType)) return { kind: 'gas' };
  if (manifest.paymentCoin !== null) return { kind: 'object', objectId: manifest.paymentCoin };
  return { kind: 'merge' };
}

function policyShaped(payment: PaymentSource, signer: TransactionSigner | undefined, source: string): Reading<true> {
  if (signer !== undefined && payment.kind === 'merge') {
    return fail(
      'unconfigured',
      source,
      'a policy signer is bound, and a merged payment (tx.coin) has object inputs whose ids rotate, so ' +
        'no policy can allow-list them. Set PROJECTX_SOCIAL_AGENT_PAYMENT_COIN to one owned coin of the ' +
        "vault's coin type and allow-list that id; payments are then split from it. Nothing was built.",
    );
  }
  return ok(true);
}

async function payable(agent: Agent, needed: bigint): Promise<Reading<string>> {
  const account = await findAgentAccount(agent.client, agent.manifest.config, agent.address);
  if (!account.ok) return account;
  if (account.value === null) {
    return fail(
      'not-found',
      `SocialAccount for ${agent.address}`,
      'this agent has no SocialAccount, and every payment in creator.move takes one as the buyer. ' +
        'Call openAccount(handle) first.',
    );
  }

  const balance = await totalBalance(agent.client, agent.address, agent.manifest.coinType);
  if (!balance.ok) return balance;
  if (balance.value < needed) {
    return refusePrecondition(
      'insufficient-balance',
      `${agent.manifest.coinType} balance of ${agent.address}`,
      `this agent holds ${balance.value} and the payment needs ${needed} (minor units). ` +
        'Nothing was signed.',
    );
  }
  return ok(account.value);
}

async function authorisedFetch(input: {
  agent: Agent;
  doFetch: FetchLike | undefined;
  path: string;
  method: 'GET' | 'POST';
  what: string;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
}): Promise<Reading<Record<string, unknown>>> {
  const { agent, what, doFetch } = input;

  const session = await agent.session();
  const auth = session.ok ? session.value.headers() : {};

  return httpRead({
    doFetch,
    baseUrl: agent.manifest.baseUrl,
    path: input.path,
    method: input.method,
    what,
    headers: { ...auth, ...(input.headers ?? {}) },
    ...(input.body === undefined ? {} : { body: input.body }),
  });
}

async function httpRead(input: {
  doFetch: FetchLike | undefined;
  baseUrl: string;
  path: string;
  method: 'GET' | 'POST';
  what: string;
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
}): Promise<Reading<Record<string, unknown>>> {
  const { what } = input;
  const doFetch = input.doFetch ?? (globalThis.fetch as FetchLike | undefined);
  if (doFetch === undefined) {
    return fail('unconfigured', what, 'no fetch implementation is available in this runtime.');
  }

  let response: Response;
  try {
    response = await doFetch(`${input.baseUrl}${input.path}`, {
      method: input.method,
      headers: {
        ...(input.headers ?? {}),
        ...(input.body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
    });
  } catch (error) {
    return fail(
      'transport',
      what,
      `could not reach ${input.baseUrl}${input.path}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  let parsed: Record<string, unknown> | null = null;
  try {
    const json: unknown = await response.json();
    if (typeof json === 'object' && json !== null) parsed = json as Record<string, unknown>;
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    const detail =
      typeof parsed?.['error'] === 'string' ? parsed['error'] : `HTTP ${response.status}`;
    if (response.status === 405) {
      return fail(
        'not-found',
        what,
        `${input.method} ${input.path} is not implemented by this deployment (HTTP 405). The path ` +
          `exists; the method does not. This is a missing endpoint, not a refused request.`,
      );
    }
    return fail(response.status === 404 ? 'not-found' : 'malformed', what, detail);
  }
  return ok(parsed ?? {});
}

function rememberedFrom(value: unknown, what: string): Reading<Remembered> {
  if (typeof value !== 'object' || value === null) return fail('malformed', what, 'the server answered without a mind record.');
  const r = value as Record<string, unknown>;
  const label = r['label'];
  const blobId = r['blobId'];
  const endEpoch = r['endEpoch'];
  const sha256 = r['sha256'];
  const bytes = r['bytes'];
  const createdAtMs = r['createdAtMs'];
  if (
    typeof label !== 'string' ||
    typeof blobId !== 'string' ||
    typeof endEpoch !== 'number' ||
    typeof sha256 !== 'string' ||
    typeof bytes !== 'number' ||
    typeof createdAtMs !== 'number'
  ) {
    return fail('malformed', what, 'the mind record is missing label, blobId, endEpoch, sha256, bytes or createdAtMs.');
  }
  return ok({ label, blobId, endEpoch, sha256, bytes, createdAtMs });
}

function isManifest(value: AgentManifest | Record<string, string | undefined>): value is AgentManifest {
  const candidate = value as Partial<AgentManifest>;
  return (
    typeof candidate.baseUrl === 'string' &&
    typeof candidate.coinType === 'string' &&
    typeof candidate.gasBudgetMist === 'bigint' &&
    typeof candidate.config === 'object' &&
    candidate.config !== null
  );
}

function stripSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

export type { ProjectXSocialConfig, Reading };
