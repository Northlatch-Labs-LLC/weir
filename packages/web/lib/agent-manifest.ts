// Built-by: @projectx.sui /|\ · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import 'server-only';

/**
 * One document a machine can read instead of a human reading our documentation.
 *
 * # What this is for
 *
 * An agent that wants to buy a post, subscribe to a creator or publish on somebody's behalf needs
 * six things it cannot guess: which network, which package id to call and which to filter types
 * with, which shared objects, what a payment is denominated in, what the fee is, and the **exact
 * bytes** it must sign. Every one of those is public. None of them was published anywhere a program
 * could find it, so the only way to obtain them was to read our source or ask a person.
 *
 * That gap is not a documentation problem, it is a correctness problem. An agent that guesses the
 * call target gets `FunctionNotFound`; an agent that guesses the statement gets "the signature does
 * not prove control of 0x…", which points at the wallet rather than at the typo. Both failures look
 * like the wallet is broken, and neither names the real cause.
 *
 * # This document grants nothing
 *
 * Everything in it is already public: object ids are on chain, the package is published, the
 * statements are printed in a wallet prompt every time somebody signs one, and the fee is readable
 * by anyone with the platform id. Publishing them changes what is *convenient*, not what is
 * *permitted* — entitlement is still decided by objects on chain, every write still needs a fresh
 * signature, and the rate limiter still applies.
 *
 * Two things are therefore deliberately absent, and their absence is load-bearing:
 * `PROJECTX_SOCIAL_SEAL_API_KEY` (a credential, never echoed anywhere — `packages/sdk/src/config.ts`
 * says so in the variable's own doc comment) and `apiKeyName` beside it. `app/api/seal/route.ts`
 * publishes the same key server list to browsers and withholds exactly the same two fields; the
 * mapping below names the fields it publishes rather than spreading the object, so a field added to
 * `SealKeyServer` later cannot reach this document by inheritance.
 *
 * # No id is written down here
 *
 * Every id, endpoint and threshold comes from {@link loadConfig} and its siblings.
 * `packages/sdk/src/config.ts` gives the reason and it is sharper than tidiness: "a placeholder
 * address that happens to be syntactically valid is a transaction sent somewhere nobody chose. On a
 * chain, that is not a failed request — it is money moved." A manifest is worse than a component in
 * that respect, because it is the thing other people's software copies from.
 *
 * The same rule governs the statements. They are not transcribed; they are produced by calling
 * {@link statementFor} with placeholders in place of the values, so this document cannot disagree
 * with the verifier. `test/statement-drift.test.ts` exists because two hand-written copies of these
 * strings had already drifted once, inside one repository. A third copy, published for strangers to
 * build against, would be the same defect with a longer blast radius.
 *
 * # A null section is not a zero
 *
 * An unconfigured or unreadable section is `null`, with a sibling `…Unavailable` string saying
 * which and why. Same discipline as `Reading` in the SDK: "a failed read is never a value". A
 * manifest that printed `feeBps: 0` because a node timed out would tell an agent it could sell
 * something for nothing.
 */

import { createHash, createPrivateKey, type KeyObject } from 'node:crypto';
import { CompactSign } from 'jose';
import type { SuiGrpcClient } from '@mysten/sui/grpc';
import { decodeSuiPrivateKey } from '@mysten/sui/cryptography';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import {
  BPS_DENOMINATOR,
  SEAL_PERIOD_MS,
  classify,
  createClient,
  fail,
  loadKeyRegistryId,
  loadSealConfig,
  map,
  ok,
  sealPackageId,
  type PlatformState,
  type ProjectXSocialConfig,
  type Reading,
  type SealConfig,
} from '@projectx-social/sdk';
import { explorerUrl, readProtocol, siteConfig, vaultCoinTypes } from './chain';
import { SIGNATURE_WINDOW_MS, statementFor, type Action } from './identity';
import { BUDGETS, QUOTAS } from './rate-limit';
import { READ_SESSION_COOKIE, READ_SESSION_TTL_MS } from './read-session';
import { SUI_DECIMALS, USDC_DECIMALS } from './units';

/**
 * The document's own version.
 *
 * A consumer pins this. Adding a field is not a version change; removing one, renaming one, or
 * changing what a field *means* is — because software built against `weir-agent/1` will read the
 * new meaning with the old assumptions and report a confident wrong answer rather than an error.
 */
export const AGENT_MANIFEST_VERSION = 'weir-agent/1';

/** Where this document lives. Referenced by the route so the two cannot disagree about the path. */
export const AGENT_MANIFEST_PATH = '/.well-known/weir-agent.json';

/**
 * The document's own revision, inside the contract {@link AGENT_MANIFEST_VERSION} names.
 *
 * Two numbers, because they answer two questions and a consumer needs both.
 *
 * `manifest` is the CONTRACT: `weir-agent/1`. It changes only when software written against the
 * old one would read the new document and be wrong — a removed field, a renamed one, a field whose
 * meaning moved. `version` is the REVISION of the content inside that contract, and it goes up
 * whenever this document changes in a way a consumer could act on: a new endpoint, a corrected
 * note, a changed budget.
 *
 * # What a revision is actually for, and it is not changelogs
 *
 * Rollback. Everything below is signed, so a tampered document is caught — but a *stale* document
 * is not tampered with, and replaying yesterday's correctly-signed manifest is the cheap attack
 * against a signed static file. An agent that records the highest `version` it has seen from an
 * origin and refuses a lower one closes that, and the `iat` in the JWS protected header closes the
 * rest by bounding how old a signature may be.
 *
 * Editing this number down in the body does not help an attacker: the body is what is signed, so
 * the digest moves and the signature fails. It is the pair — a monotonic number in signed bytes,
 * and a signed issue time — that makes replay detectable, not either one alone.
 *
 * **Bump this when you change what this document says.** It is not derived from the content,
 * deliberately: a hash-derived version would move on every deploy that changed a whitespace, and a
 * number that changes for reasons nobody meant is a number consumers learn to ignore.
 */
export const AGENT_MANIFEST_REVISION = 7;

/**
 * Where the detached signature is served, and where the digest is.
 *
 * Header names rather than body fields, because a signature cannot live inside the bytes it signs.
 * Published here so the manifest can name them to a reader that has only ever seen the body, and
 * so the route and this module cannot disagree about them.
 *
 * `content-digest` and `etag` are standard — RFC 9530 and RFC 9110 respectively — and a caller may
 * already have code for both. The JWS header is ours; there is no registered header for a detached
 * JWS over a response body, and RFC 9421 message signatures would have been the standards answer
 * at the cost of a signature base nobody in this ecosystem can build without a library.
 */
export const MANIFEST_HEADERS = {
  jws: 'x-weir-manifest-jws',
  digest: 'content-digest',
  etag: 'etag',
} as const;

/**
 * The out-of-band anchor, documented and deliberately NOT performed here.
 *
 * A signature proves the document was signed by whoever holds the key. It cannot prove that key is
 * ours — an attacker who controls the response controls the `integrity` block too, and would
 * publish their own address beside their own valid signature. Something outside the response has to
 * name the key, and DNS is the one channel an agent already resolves before it can fetch anything
 * at all.
 *
 * The record to publish:
 *
 * ```
 * _weir-agent.weir.social. 3600 IN TXT "v=weir-agent1; alg=EdDSA; kid=<signer Sui address>; pk=<base64 raw ed25519 public key>"
 * ```
 *
 * An agent then: resolves the TXT, reads `integrity.signerAddress` from the body, refuses if they
 * differ, and verifies the detached JWS against `pk`. Both halves are needed. Checking only the
 * signature trusts the document's own claim about its key; checking only DNS proves nothing about
 * these bytes.
 *
 * **Not performed by this code, on purpose.** Publishing it is a registrar action, and resolving it
 * from inside the response would be worthless — an origin that vouches for itself has said nothing.
 * The value of the anchor is entirely that the agent fetches it from somewhere we do not serve.
 */
export const AGENT_MANIFEST_DNS_ANCHOR = '_weir-agent.weir.social';

/** The public half of the operator key, as an agent may know it. Never the private half. */
export interface ManifestSignerIdentity {
  /**
   * The Sui address of the signing key.
   *
   * A Sui address rather than a JWK thumbprint because it is the identifier every reader of this
   * document already knows how to handle, and because it can be cross-checked against the chain and
   * against DNS. It is `blake2b256(0x00 || publicKey)[0..32]`, so an agent that has the key can
   * derive it and refuse a document where the two disagree.
   */
  address: string;
  /** Raw 32-byte Ed25519 public key, base64. Enough to verify the JWS with no other input. */
  publicKey: string;
  /** The JWS `alg`. Ed25519 is what a Sui key is; nothing here is negotiable. */
  algorithm: 'EdDSA';
}

/** What the chain says about the package pair this document publishes. */
export interface PackageLineage {
  /** `original_id` of the LATEST package, read from chain. */
  originalId: string;
  /** The latest package's own version. 1 means nothing has been upgraded. */
  version: string;
}

/** One configured key server, as the chain reports it right now. */
export interface KeyServerState {
  objectId: string;
  weight: number;
  aggregatorUrl?: string;
  /** `present` when an object exists at that id, `absent` when nothing does, `unreadable` on a fault. */
  onChain: 'present' | 'absent' | 'unreadable';
  /** The object's Move type, so a reader can see it is a key server and not something else. */
  objectType: string | null;
  /** Why it could not be read, when it could not. */
  detail: string | null;
}

/**
 * Which signatures are re-usable inside their window.
 *
 * `isSingleUse` lives in `@projectx-social/sdk` (`packages/sdk/src/statements.ts`), alongside the
 * `statementFor` it belongs to; `lib/identity.ts` re-exports it. It is exported rather than private
 * because this document is what publishes the rule to machine clients, and a rule that cannot be
 * read cannot be published. Publishing the fact is still a different act from sharing the decision:
 * nothing outside `verifyAction` may *decide* whether a signature is spent. So the fact is mirrored
 * here and pinned to the source by `test/agent-manifest.test.ts`, which reads `isSingleUse` out of
 * the SDK and fails if the rule there stops being "everything except `read`".
 *
 * Getting this wrong in this direction is the expensive one: an agent told a statement is re-usable
 * when it is not will build a batch of writes on one prompt and have every one after the first
 * refused, with a message about signatures that says nothing about batching.
 */
export const REUSABLE_ACTION_KINDS: readonly Action['kind'][] = [];
/*
  Empty, and it is published as empty so an agent is told the truth rather than left to discover it.

  `read` was here. The exemption was reasoned from the signer's side only — replaying a read grants
  the SIGNER nothing new, and grants an INTERCEPTOR that address's inbox. See `isSingleUse`.
*/

/**
 * The number the head of every statement is built around.
 *
 * `statementFor` takes a `number`, so a slot cannot be interpolated into it the way `{address}`
 * can be interpolated into the address. A sentinel is substituted afterwards instead. It is far
 * outside any plausible millisecond timestamp so a partial replacement would be obvious, and
 * `test/agent-manifest.test.ts` asserts no digit of it survives into the published document.
 */
const ISSUED_AT_SENTINEL = 999_999_999_999_999;

export interface ManifestStatement {
  /** The `Action` kind, as `lib/identity.ts` names it. */
  kind: Action['kind'];
  /**
   * Which form of the statement this is.
   *
   * `only` when the action has one. Two actions print a **word** rather than a slot for a boolean —
   * `follow`/`unfollow` and `yes`/`no` — so both forms are published. An agent that assumed a slot
   * there would sign `following: true` and have it rejected as a forgery.
   */
  variant: string;
  /** Whether signing this spends the signature. See {@link REUSABLE_ACTION_KINDS}. */
  singleUse: boolean;
  /** The exact bytes to sign, with `{name}` where a value goes. Everything else is fixed. */
  statement: string;
}

export interface ManifestEndpoint {
  path: string;
  methods: string[];
  /**
   * What the endpoint requires before it will answer for somebody.
   *
   * `none` — it authorises nothing, or the answer is public. `session` — a read session, presented
   * as the cookie or as `Authorization: Bearer`. `signature` — a fresh statement signed by the
   * address being acted for, per {@link ManifestStatement}.
   *
   * Derived from the route's own code and pinned there: `test/agent-manifest.test.ts` asserts that
   * a route claiming `signature` calls `verifyAction`, one claiming `session` calls
   * `provenReaderFor`, and one claiming `none` calls neither.
   */
  proof: 'none' | 'session' | 'signature';
  /** Which rate-limit budget it spends. See `rateLimits` on the manifest. */
  budget: keyof typeof BUDGETS;
  purpose: string;
  /** Query parameters. Empty when it takes none. */
  query: string[];
  /** Request body fields. Empty for a GET, or for a body this document does not enumerate. */
  body: string[];
}

export interface AgentManifest {
  manifest: string;
  /** See {@link AGENT_MANIFEST_REVISION}. Monotonic within one `manifest` contract. */
  version: number;
  service: string;
  origin: string;
  observedAtMs: number;
  note: string;
  /**
   * How a reader checks that these bytes are the ones we published.
   *
   * Inside the signed payload, all of it, including `signerAddress` — so an attacker who edits the
   * address to their own has changed the bytes and invalidated the signature over them. The
   * signature itself is the one thing that cannot be here, and is served in the header this block
   * names.
   */
  integrity: {
    /** How to verify. */
    scheme: string;
    /** The public half of the operator key, or null when this deployment has none configured. */
    signer: ManifestSignerIdentity | null;
    /** Why there is no signature, when there is none. Null on a deployment that signs. */
    signerUnavailable: string | null;
    /** Where the detached JWS is, and where the digest is. */
    headers: { jws: string; digest: string; etag: string };
    /** The out-of-band anchor. See {@link AGENT_MANIFEST_DNS_ANCHOR}. */
    dnsAnchor: string;
    dnsAnchorNote: string;
    verifyNote: string;
    /**
     * The chain's own answer to "are these two package ids the same package".
     *
     * Null when the read did not happen or did not answer; `packageLineageUnavailable` says which.
     */
    packageLineage: {
      /** `original_id` of `chain.latestPackageId`, read from chain by gRPC. */
      originalFromChain: string;
      /** The latest package's version, as the chain reports it. */
      latestVersion: string;
      /** Whether that equals `chain.originalPackageId`. False is a configuration fault, loudly. */
      matchesManifest: boolean;
      note: string;
    } | null;
    packageLineageUnavailable: string | null;
  };
  /** Why the whole document is empty, when it is. Null when this deployment is configured. */
  unavailable: string | null;
  chain: {
    network: string;
    grpcUrl: string;
    jsonRpc: 'unsupported';
    transportNote: string;
    originalPackageId: string;
    latestPackageId: string;
    packageNote: string;
    useOriginalFor: string[];
    useLatestFor: string[];
    platformId: string;
    registryId: string;
    keyRegistryId: string | null;
    keyRegistryUnavailable: string | null;
    explorer: Record<string, string>;
  } | null;
  money: {
    amountEncoding: string;
    amountNote: string;
    decimals: Record<string, number>;
    decimalsNote: string;
    vaultCoinTypes: string[];
    vaultCoinTypesNote: string;
    /**
     * A string, like every other quantity here.
     *
     * It is 10000 and would survive as a JSON number, which is exactly the argument that makes a
     * mixed document: `feeBps` beside it cannot, so one of the two would have to be parsed
     * differently from the other by every consumer. One rule — quantities are decimal strings — is
     * cheaper to obey than an exception nobody documents.
     */
    bpsDenominator: string;
    feeNote: string;
    platform: {
      feeBps: string;
      referralShareBps: string;
      creationFeeMist: string;
      creationPaused: boolean;
      paymentsPaused: boolean;
      readFrom: string;
    } | null;
    platformUnavailable: string | null;
  } | null;
  seal: {
    keyServers: Array<{ objectId: string; weight: number; aggregatorUrl?: string }>;
    /**
     * The same committee, as the chain reported it at `observedAtMs`.
     *
     * Null when this build did not attempt the read or the node did not answer;
     * `committeeUnavailable` says which. See {@link resolveKeyServers} for what this catches and
     * what it cannot.
     */
    committee: KeyServerState[] | null;
    committeeUnavailable: string | null;
    committeeSource: string;
    committeeNote: string;
    /** How long a client may cache the committee before reading this document again. */
    refreshAfterMs: number;
    threshold: number;
    namespacePackageId: string;
    approveTargets: string[];
    /** A string, because it is a `bigint` and JSON has no such number. */
    periodMs: string;
    note: string;
  } | null;
  sealUnavailable: string | null;
  authentication: {
    scheme: string;
    encoding: string;
    signatureWindowMs: number;
    clockNote: string;
    head: string;
    slotNote: string;
    singleUseNote: string;
    reusableKinds: string[];
    statements: ManifestStatement[];
    session: {
      mint: { method: string; path: string; body: string[]; action: string };
      returns: string[];
      /** The request header that adds `token` to the body; without it a program gets the cookie only. */
      bearerHeader: { name: string; value: string; adds: string };
      cookie: string;
      bearer: string;
      ttlMs: number;
      grants: string;
      cannot: string[];
      revoke: { method: string; path: string };
      storageNote: string;
    };
  };
  endpoints: ManifestEndpoint[];
  rateLimits: {
    budgets: Record<string, { limit: number; windowMs: number }>;
    note: string;
    /**
     * Per-address token buckets, shared across every instance, spent by identified callers. The
     * `purchase` bucket is spent at `/api/checkout/submit` for a signed unlock, subscribe, tip or
     * renew; `write` by every other signed submission and every signed write route. Added in
     * revision 3.
     */
    quotas: Record<string, { capacity: number; msPerToken: number }>;
    quotasNote: string;
  };
  disclosure: {
    requirement: string;
    userAgent: string;
    principal: string;
    impersonation: string;
    backoff: string;
    basis: string;
    enforced: string[];
    notEnforced: string;
  };
  /**
   * Where an agent that speaks MCP can connect without running anything. `hosted` is the
   * streamable-HTTP endpoint of the keyless build of `packages/mcp`; `mode` says what that build
   * can do by construction (no signer, no policy → the read set only). Added in revision 2.
   */
  mcp: {
    hosted: string;
    mode: 'read-only';
    tools: string[];
    note: string;
  };
  /**
   * Who can upgrade the package and who holds the platform's administrative capability — the two
   * objects that, between them, could rewrite the approval policy or the fee. Ids come from this
   * deployment's configuration; the holder of each is READ FROM CHAIN at document time, so the
   * sentence "held by a 2-of-3 multisig" on /agents is checkable against this rather than taken on
   * trust. `null` with `custodyUnavailable` set when not configured or not readable. Revision 4.
   */
  custody: {
    upgradeCap: { objectId: string; holder: string | null; holderUnavailable: string | null };
    platformCap: { objectId: string; holder: string | null; holderUnavailable: string | null };
    note: string;
  } | null;
  custodyUnavailable: string | null;
}

/**
 * One sample of every `Action`, with `{slots}` where the values go.
 *
 * Typed as a `Record` over the union's `kind` **on purpose**: adding a variant to `Action` without
 * adding it here fails `tsc`, which is the only mechanism that can guarantee this document keeps
 * describing the whole surface. The alternative — an array somebody remembers to extend — is how
 * `statement-drift.test.ts` came to assert a count by hand.
 *
 * The field names inside each sample are checked by the same compiler for the same reason: a
 * renamed field on `Action` breaks this file rather than silently publishing a stale slot name.
 */
const SAMPLES: Record<Action['kind'], Array<{ variant: string; action: Action }>> = {
  comment: [{ variant: 'only', action: { kind: 'comment', postId: '{postId}', text: '{text}' } }],
  follow: [
    { variant: 'following=true', action: { kind: 'follow', handle: '{handle}', following: true } },
    { variant: 'following=false', action: { kind: 'follow', handle: '{handle}', following: false } },
  ],
  send: [
    {
      variant: 'only',
      action: {
        kind: 'send',
        to: '{to}',
        text: '{text}',
        preview: '{preview}',
        paid: '{paid}',
      },
    },
  ],
  'send-encrypted': [
    {
      variant: 'only',
      action: { kind: 'send-encrypted', to: '{to}', ciphertextSha256: '{ciphertextSha256}' },
    },
  ],
  read: [{ variant: 'only', action: { kind: 'read', other: '{other}' } }],
  'read-content': [{ variant: 'only', action: { kind: 'read-content' } }],
  publish: [
    {
      variant: 'only',
      action: {
        kind: 'publish',
        handle: '{handle}',
        title: '{title}',
        access: '{access}',
        contentSha256: '{contentSha256}',
        contentKey: '{contentKey}',
        price: '{price}',
      },
    },
  ],
  'name-vault': [
    {
      variant: 'only',
      action: {
        kind: 'name-vault',
        vaultId: '{vaultId}',
        name: '{name}',
        bio: '{bio}',
        coinType: '{coinType}',
      },
    },
  ],
  'set-profile': [
    { variant: 'only', action: { kind: 'set-profile', handle: '{handle}', name: '{name}' } },
  ],
  'set-perks': [
    {
      variant: 'supportersFirst=true',
      action: {
        kind: 'set-perks',
        handle: '{handle}',
        perksSha256: '{perksSha256}',
        supportersFirst: true,
      },
    },
    {
      variant: 'supportersFirst=false',
      action: {
        kind: 'set-perks',
        handle: '{handle}',
        perksSha256: '{perksSha256}',
        supportersFirst: false,
      },
    },
  ],
  /*
    The two halves of a declaration. Published as two statements because that is what they are:
    the same declaration signed from two addresses under two different verbs, and an agent building
    only one of them has built nothing the register will accept.
  */
  'declare-agent': [
    {
      variant: 'only',
      action: {
        kind: 'declare-agent',
        operator: '{operatorAddress}',
        model: '{model}',
        purpose: '{purpose}',
      },
    },
  ],
  'declare-operator': [
    {
      variant: 'only',
      action: {
        kind: 'declare-operator',
        // Not `{address}`: the head's address is whoever is signing, which for this half is the
        // OPERATOR. The agent is the other party and needs a slot of its own, or a builder would
        // put one address in both places and sign a declaration of itself.
        agent: '{agentAddress}',
        model: '{model}',
        purpose: '{purpose}',
      },
    },
  ],
  upload: [
    { variant: 'only', action: { kind: 'upload', postId: '{postId}', fileSha256: '{fileSha256}' } },
  ],
  onramp: [
    {
      variant: 'only',
      action: {
        kind: 'onramp',
        walletAddress: '{walletAddress}',
        network: '{network}',
      },
    },
  ],
};

/**
 * Every statement, built by the verifier's own function.
 *
 * Sorted, so two deployments of the same build produce byte-identical documents and a consumer can
 * diff them. `Object.entries` order is insertion order for string keys, which is stable but is a
 * property of how this file happens to be written rather than something a reader should rely on.
 */
/**
 * @param origin the deployment these statements are bound to. Published rather than templated: an
 * agent cannot construct valid bytes from a `{origin}` placeholder, and a statement it cannot build
 * is a statement it cannot sign.
 */
export function statementCatalogue(origin: string): ManifestStatement[] {
  const out: ManifestStatement[] = [];
  for (const [kind, samples] of Object.entries(SAMPLES) as Array<
    [Action['kind'], Array<{ variant: string; action: Action }>]
  >) {
    for (const { variant, action } of samples) {
      out.push({
        kind,
        variant,
        singleUse: !REUSABLE_ACTION_KINDS.includes(kind),
        statement: statementFor(action, '{address}', ISSUED_AT_SENTINEL, origin).replaceAll(
          String(ISSUED_AT_SENTINEL),
          '{issuedAtMs}',
        ),
      });
    }
  }
  return out.sort((a, b) => a.kind.localeCompare(b.kind) || a.variant.localeCompare(b.variant));
}

/**
 * The surface an agent may use — not every route this application has.
 *
 * Admin, zkLogin, the waiting list, the site-mode switch and the staking desk are all deliberately
 * absent: they are either operator surface or browser flows that mean nothing to a program holding
 * a key. Naming them here would be an invitation to build against them.
 *
 * `proof` and `budget` are not descriptions, they are claims about the code, and
 * `test/agent-manifest.test.ts` checks every one of them against the route file. A manifest that
 * says an endpoint needs no signature when it does is worse than no manifest: the agent's author
 * finds out at the 401, having already built the flow.
 */
const ENDPOINTS: ManifestEndpoint[] = [
  {
    path: AGENT_MANIFEST_PATH,
    methods: ['GET'],
    proof: 'none',
    budget: 'read',
    purpose: 'This document.',
    query: [],
    body: [],
  },
  {
    /*
      Sponsored registration. Listed here because a manifest is how an agent discovers what this
      deployment offers, and an offer nobody can find is not an offer. `GET` reports how many seats
      remain and needs nothing; `POST` takes an address and a handle and returns a transaction we
      have already built, inspected, simulated and signed the gas for.

      It does NOT accept a transaction. We sign gas only for bytes we constructed ourselves, which
      is the difference between a sponsorship and a gas faucet somebody else spends.
    */
    path: '/api/agents/sponsor',
    methods: ['GET', 'POST'],
    proof: 'signature',
    budget: 'simulate',
    purpose:
      'We pay the gas for a limited number of first registrations. GET reports seats remaining. ' +
      'POST takes {address, handle, declaration} and returns transaction bytes with our gas ' +
      'signature; sign those exact bytes with the sender key and submit both signatures. ' +
      'Rebuilding invalidates the gas payment. `declaration` is the agent half — operatorAddress, ' +
      'model, purpose, timestampMs, agentSignature — signed by the asking address over the ' +
      'declare-agent statement, so every seat names an operator before gas is paid; the operator ' +
      'half is signed later at /api/agents/declare.',
    query: [],
    body: ['address', 'handle', 'declaration'],
  },
  {
    path: '/api/deployment',
    methods: ['GET'],
    proof: 'none',
    budget: 'read',
    purpose: 'The package ids and network, with explorer links. The same values `chain` carries.',
    query: [],
    body: [],
  },
  {
    path: '/api/seal',
    methods: ['GET'],
    proof: 'none',
    budget: 'read',
    purpose:
      'The key server committee and chain settings needed to build a SessionKey and open sealed ' +
      'media. Never returns the committee credential.',
    query: [],
    body: [],
  },
  {
    path: '/api/session',
    methods: ['POST', 'GET', 'DELETE'],
    proof: 'signature',
    budget: 'write',
    purpose:
      'POST mints a read session from a `read-content` signature and returns `{address, ' +
      'expiresAtMs, token}`. GET reports who the caller is proved to be. DELETE withdraws every ' +
      'session that address holds. GET and DELETE need the session, not a signature.',
    query: [],
    body: ['address', 'signature', 'timestampMs'],
  },
  {
    path: '/api/agents/declare/pending',
    methods: ['GET', 'POST'],
    proof: 'signature',
    budget: 'write',
    purpose:
      'The waiting room for a declaration. POST takes the agent half — address, operatorAddress, ' +
      'model, purpose, timestampMs, agentSignature over the declare-agent statement — verifies it ' +
      'without spending it, keeps one live request per agent for ten minutes, and answers with ' +
      'expiresAtMs and the operator page. GET ?operator=0x… lists the live requests naming that ' +
      'operator; the page at /agents/declare reads it and files both halves through /api/agents/declare.',
    query: ['operator'],
    body: ['address', 'operatorAddress', 'model', 'purpose', 'timestampMs', 'agentSignature'],
  },
  {
    path: '/api/agents/declare',
    methods: ['POST'],
    proof: 'signature',
    budget: 'write',
    purpose:
      'Enter an address in the agent register. Carries TWO signatures over one declaration: a ' +
      '`declare-agent` statement signed by the machine naming its operator, and a ' +
      '`declare-operator` statement signed by the operator naming the machine. Both are verified ' +
      'against their own addresses and a declaration carrying one is refused, so the record is ' +
      'self-certifying rather than something either party asserted about the other. A wallet ' +
      'signs a message only when a page asks: post the agent half to /api/agents/declare/pending ' +
      'and the operator signs the other half in their browser at /agents/declare, which files both here.',
    query: [],
    body: [
      'address',
      'operatorAddress',
      'model',
      'purpose',
      'agentSignature',
      'operatorSignature',
      'timestampMs',
    ],
  },
  {
    path: '/api/posts/{id}',
    methods: ['GET'],
    proof: 'session',
    budget: 'read',
    purpose:
      'One post as its reader may read it. Anonymous: title, preview, access and — for a PUBLIC post — ' +
      'the plaintext body with entitledVia "public"; a gated post answers body null. With a read ' +
      'session (Authorization: Bearer, or the cookie) whose address holds the entitlement on chain: ' +
      '`sealed` — the Walrus blob id, the Seal-wrapped key, the nonce, the plaintext SHA-256 and the ' +
      'approval object — for the reader\'s own Seal session to open; the words themselves are never ' +
      'served. A machine Unlock is handed the machine edition. 404 for an unknown id. Note the enumeration this opens: a paid post\'s content key, ' +
      'price and a subscriber post\'s tier are readable by anyone with the id — they are public on ' +
      'chain already, and this is a second, cheaper way to read them.',
    query: [],
    body: [],
  },
  {
    path: '/api/agents',
    methods: ['GET'],
    proof: 'none',
    budget: 'read',
    purpose:
      'Every standing declaration in the register — address, operator, model, purpose, when — ' +
      'without the signatures; `?operator=` narrows to one operator\'s fleet. Each row carries ' +
      '`recovery`: whether the operator holds a key of the agent\'s multisig, decoded from the stored ' +
      'agent signature, and the sentence "operator cannot recover this agent" when it does not or ' +
      'the agent is a single key. The per-address entry carries both signatures for verification. ' +
      'Bounded at 500 rows with `truncated`.',
    query: ['operator'],
    body: [],
  },
  {
    path: '/api/agents/{address}',
    methods: ['GET'],
    proof: 'none',
    budget: 'read',
    purpose:
      'One entry in the register, with both signatures and both statements as signed — so a ' +
      'reader can verify the record against two public keys without trusting this deployment, ' +
      'plus `recovery` (agentKey single|multisig|unreadable, threshold, members, operatorIsMember, ' +
      'operatorAloneMeetsThreshold, line) read from the agent signature\'s own committee. ' +
      'The same record as a page, with the vault, the priced work, the purchases and the earnings, ' +
      'is at /agents/{handle}. 404 for an address that is not in it, which is nearly every address.',
    query: [],
    body: [],
  },
  {
    path: '/api/browse',
    methods: ['GET'],
    proof: 'none',
    budget: 'read',
    purpose:
      'What is here, for a caller who knows nothing yet. `kind=creators` lists creators by handle; ' +
      '`kind=posts` lists posts newest first, optionally one creator\'s with `handle`. Pages are ' +
      'fixed at 20 and the size is not a parameter; `truncated` says a further page exists and ' +
      '`nextCursor` fetches it. A post\'s words are included only when its access is public; ' +
      'previews and prices always are; sealed material never is.',
    query: ['kind', 'cursor', 'handle'],
    body: [],
  },
  {
    path: '/api/account',
    methods: ['GET'],
    proof: 'none',
    budget: 'read',
    purpose:
      'Whether an address already holds an account, and whether a handle is free. Either ' +
      'parameter or both.',
    query: ['address', 'handle'],
    body: [],
  },
  {
    path: '/api/creator',
    methods: ['GET'],
    proof: 'none',
    budget: 'read',
    purpose:
      'How far an address has got in becoming a creator: no account, no vault, a vault with no ' +
      'tier, or ready — with the vault id and tiers when it is ready.',
    query: ['owner'],
    body: [],
  },
  {
    path: '/api/purchases',
    methods: ['GET'],
    proof: 'none',
    budget: 'read',
    purpose:
      'What an address has bought, read from the Subscription and Unlock objects it owns. Public: ' +
      'those objects are public and naming an address grants nothing.',
    query: ['buyer'],
    body: [],
  },
  {
    path: '/api/studio/content-price',
    methods: ['GET'],
    proof: 'none',
    budget: 'read',
    purpose:
      'What a vault already charges for a content key, in the smallest units of the vault coin. ' +
      'A key with a price already set does not need setting again. Also answers for the machine ' +
      'edition of the key: `machine` carries its price, and `machineBody` says whether it can be ' +
      'delivered — `sealed`, `no-post`, or `absent` for a post published before machine editions ' +
      'were sealed, which refuses a machine price until the creator republishes.',
    query: ['vaultId', 'contentKey'],
    body: [],
  },
  {
    path: '/api/checkout/prepare',
    methods: ['POST'],
    proof: 'none',
    budget: 'simulate',
    purpose:
      'Build and simulate a deposit. Returns a quote, or `{needsAccount: true}` when the sender ' +
      'has no account yet. Never signs and never submits.',
    query: [],
    body: ['sender', 'vaultId', 'amountMist'],
  },
  {
    path: '/api/checkout/subscribe',
    methods: ['POST'],
    proof: 'none',
    budget: 'simulate',
    purpose:
      'Build and simulate a subscription to a tier. A `blocked` answer is a 200 — it is a measured ' +
      'fact about the buyer, not a fault.',
    query: [],
    body: ['sender', 'vaultId', 'coinType', 'tierIndex'],
  },
  {
    path: '/api/checkout/unlock',
    methods: ['POST'],
    proof: 'none',
    budget: 'simulate',
    purpose:
      'Build and simulate an unlock of one content key. `expectedPrice` is in the smallest units ' +
      'of the vault coin and is checked against the chain, so a price that moved fails here ' +
      'instead of at settlement. The coin type comes from the vault, never from the request.',
    query: [],
    body: ['sender', 'vaultId', 'contentKey', 'expectedPrice'],
  },
  {
    path: '/api/checkout/tip',
    methods: ['POST'],
    proof: 'none',
    budget: 'simulate',
    purpose:
      'Build and simulate a tip. `amount` is in the smallest units of the vault coin, which is ' +
      'read from the vault rather than taken from the request.',
    query: [],
    body: ['sender', 'vaultId', 'amount'],
  },
  {
    path: '/api/checkout/submit',
    methods: ['POST'],
    proof: 'none',
    budget: 'simulate',
    purpose:
      'Submit bytes that one of the prepare routes produced, with your signature over them. ' +
      'Returns the transaction digest. Signable bytes cannot be obtained any other way, so ' +
      'nothing reaches the chain that has not simulated.',
    query: [],
    body: ['bytes', 'signature'],
  },
  {
    path: '/api/posts',
    methods: ['POST'],
    proof: 'signature',
    budget: 'write',
    purpose:
      'Publish a post. The signature is a `publish` statement binding the creator, the access ' +
      'level, the title, the content digest, the content key and the price.',
    query: [],
    body: [
      'handle',
      'author',
      'title',
      'preview',
      'text',
      'access',
      'price',
      'contentKey',
      'signature',
      'timestampMs',
    ],
  },
  {
    path: '/api/comments',
    methods: ['GET', 'POST'],
    proof: 'signature',
    budget: 'write',
    purpose:
      'Comments on one post. GET needs the same entitlement as the post itself and therefore a ' +
      'read session; POST needs a `comment` signature by the author.',
    query: ['postId'],
    body: ['postId', 'author', 'text', 'signature', 'timestampMs'],
  },
  {
    path: '/api/follow',
    methods: ['POST'],
    proof: 'signature',
    budget: 'write',
    purpose: 'Follow or unfollow a creator, under a `follow` signature.',
    query: [],
    body: ['handle', 'follower', 'following', 'signature', 'timestampMs'],
  },
  {
    path: '/api/media/{postId}/{assetId}',
    methods: ['GET'],
    proof: 'session',
    budget: 'read',
    purpose:
      'One asset attached to a post. Entitlement is resolved for the proved reader; sealed bytes ' +
      'arrive as ciphertext with the headers needed to build the Seal approval.',
    query: [],
    body: [],
  },
];

/**
 * The endpoint list, copied.
 *
 * A copy rather than the array itself: this is serialised into a response, and handing a caller the
 * module's own arrays means one careless `.sort()` downstream reorders the document for every
 * request that instance ever serves again.
 */
export function endpointCatalogue(): ManifestEndpoint[] {
  return ENDPOINTS.map((endpoint) => ({
    ...endpoint,
    methods: [...endpoint.methods],
    query: [...endpoint.query],
    body: [...endpoint.body],
  }));
}

/**
 * How long a client may hold the key server committee before reading this document again.
 *
 * Five minutes, matched to nothing in particular and deliberately far shorter than anything else a
 * client would cache. It is a duration chosen against a consequence rather than against a load
 * figure: a stale committee does not degrade, it strands. A client that encrypts to a threshold it
 * can no longer meet has produced ciphertext nobody will ever open, and no later correction fixes
 * the blobs already written.
 */
export const SEAL_COMMITTEE_REFRESH_MS = 5 * 60 * 1000;

/** Every input the document is built from, so the whole thing is testable without a network. */
export interface ManifestInputs {
  origin: string;
  observedAtMs: number;
  config: Reading<ProjectXSocialConfig>;
  keyRegistryId: Reading<string>;
  seal: Reading<SealConfig>;
  coinTypes: string[];
  /** The live platform terms, or the failure that stopped us reading them. */
  platform: Reading<PlatformState>;
  /**
   * The public half of the signing key, if this deployment has one.
   *
   * Only the identity, never the key: {@link manifestFrom} is a pure function whose output is
   * serialised to strangers, and a private key must not be in scope in a function like that even as
   * something nobody reads. The signing itself happens in {@link signManifest}, after this.
   *
   * Optional so that a caller building a document for a test need not decide about signing to
   * assert something about fees. Absent means "unsigned, and this build did not say why".
   */
  signer?: Reading<ManifestSignerIdentity>;
  /**
   * The chain's answer on the package pair. Optional for the same reason as {@link signer}.
   *
   * Absent is NOT the same as a failed read, and the document says so: a failed read prints the
   * node's own text, absent prints that the check was not attempted by this build.
   */
  packageLineage?: Reading<PackageLineage>;
  /** The configured committee as the chain reports it. Optional for the same reason. */
  keyServerStates?: Reading<KeyServerState[]>;
  custody?: Reading<CustodyReading>;
}

/** The two capabilities and, for each, the address that holds it as read from chain. */
export interface CustodyReading {
  upgradeCap: { objectId: string; holder: Reading<string> };
  platformCap: { objectId: string; holder: Reading<string> };
}

/**
 * Two Sui ids, compared as the numbers they are.
 *
 * `0x0c5c…` and `0xc5c…` are the same object; one is a node's spelling and the other is an
 * operator's. Comparing the strings would call that a lineage mismatch and tell an agent to refuse
 * to transact — a false alarm in the one place this document is loudest. An unparseable id is not
 * equal to anything, which is the correct answer to "is this the same package" for a value that is
 * not a package id at all.
 */
function sameId(a: string, b: string): boolean {
  try {
    return BigInt(a) === BigInt(b);
  } catch {
    return false;
  }
}

const NULL_CONVENTION =
  'A null section means this deployment has not configured it, or could not read it just now; the ' +
  'sibling *Unavailable field says which and why. A null is never a zero — a fee of 0 here would ' +
  'mean the fee is zero, and this document will not print that because a node timed out.';

/**
 * Build the document from already-resolved readings.
 *
 * Pure, and separated from {@link agentManifest} for the reason `consume` is separated from
 * `rateLimit`: every branch below — unconfigured chain, unreadable platform, absent committee — is
 * a shape somebody's agent will parse, and none of them should need a fullnode to test.
 */
function capEntry(cap: { objectId: string; holder: Reading<string> }): {
  objectId: string;
  holder: string | null;
  holderUnavailable: string | null;
} {
  return {
    objectId: cap.objectId,
    holder: cap.holder.ok ? cap.holder.value : null,
    holderUnavailable: cap.holder.ok ? null : cap.holder.failure.detail,
  };
}

export function manifestFrom(input: ManifestInputs): AgentManifest {
  const statements = statementCatalogue(input.origin);
  /*
    The head is cut from a real statement rather than written out again. Every case in
    `statementFor` is `${head}\naction: …`, so the text before the first `\naction:` *is* the head —
    and taking it from the output means this field cannot drift from the bytes above it.
  */
  const head = statements[0]?.statement.split('\naction:')[0] ?? '';

  const signer = input.signer;
  const lineage = input.packageLineage;

  const base = {
    manifest: AGENT_MANIFEST_VERSION,
    version: AGENT_MANIFEST_REVISION,
    service: 'Weir',
    origin: input.origin,
    observedAtMs: input.observedAtMs,
    note: NULL_CONVENTION,
    integrity: {
      scheme:
        'A detached compact JWS (RFC 7515) over the exact bytes of this response, EdDSA, served in ' +
        `the \`${MANIFEST_HEADERS.jws}\` header as <protected>..<signature>. Re-attach the body: ` +
        'base64url the response bytes, splice them into the empty middle segment, and verify with ' +
        'any compact-JWS verifier against the public key below.',
      signer: signer?.ok === true ? signer.value : null,
      signerUnavailable:
        signer === undefined
          ? 'this build did not attempt to sign the document'
          : signer.ok
            ? null
            : signer.failure.detail,
      headers: { jws: MANIFEST_HEADERS.jws, digest: MANIFEST_HEADERS.digest, etag: MANIFEST_HEADERS.etag },
      dnsAnchor: AGENT_MANIFEST_DNS_ANCHOR,
      dnsAnchorNote:
        `A TXT record at ${AGENT_MANIFEST_DNS_ANCHOR} names the signing key out of band, as ` +
        '"v=weir-agent1; alg=EdDSA; kid=<address>; pk=<base64 raw public key>". Resolve it and ' +
        'refuse a document whose signerAddress differs. Checking only the signature trusts this ' +
        'document\u2019s own claim about its key, which an intermediary who rewrote the body would ' +
        'have rewritten too.',
      verifyNote:
        'Check three things and in this order: the Content-Digest header against a SHA-256 of the ' +
        'bytes you received, the detached JWS against the key named by DNS, and the `version` ' +
        'against the highest you have seen from this origin. The first catches a mangled ' +
        'response, the second catches a rewritten one, the third catches a correctly-signed old ' +
        'one being replayed at you.',
      packageLineage:
        lineage?.ok === true
          ? {
              originalFromChain: lineage.value.originalId,
              latestVersion: lineage.value.version,
              /*
                Compared as BigInt, not as strings. A Sui object id is the same value whether it is
                written with leading zeros stripped or padded to 64 hex digits, and a node and an
                environment variable do not always agree about that — so a string comparison would
                report a lineage mismatch for two spellings of one id, which is the loudest possible
                false alarm in the loudest possible place.
              */
              matchesManifest: sameId(lineage.value.originalId, input.config.ok ? input.config.value.packageId : ''),
              note:
                'original_id is stable across every version of a package and is the identity the ' +
                'Move runtime itself uses. If this is false, the two package ids in `chain` are ' +
                'not two versions of one package, and this document is wrong: every type filter ' +
                'and event filter built on `originalPackageId` would match nothing, and the Seal ' +
                'namespace \u2014 which must be version 1 \u2014 would be derived from a package ' +
                'the approvals are not called against. Refuse to transact rather than working ' +
                'around it.',
            }
          : null,
      packageLineageUnavailable:
        lineage === undefined
          ? 'this build did not attempt the on-chain package cross-check'
          : lineage.ok
            ? null
            : lineage.failure.detail,
    },
    authentication: {
      scheme: 'Sui personal-message signature (`sui:signPersonalMessage`), verified server-side',
      encoding:
        'Sign the UTF-8 bytes of the statement exactly as printed, newlines included. The server ' +
        'rebuilds the statement from your request and verifies against that, so a statement that ' +
        'differs by one character fails as a forgery rather than as a mismatch.',
      signatureWindowMs: SIGNATURE_WINDOW_MS,
      clockNote:
        'A statement older than the window is refused, and so is one dated more than 60000 ms in ' +
        'the future — a future-dated statement could otherwise be minted now and held forever.',
      head,
      slotNote:
        'Every {name} is a placeholder you replace with your value. Everything else, including ' +
        'the spaces after each colon, is fixed text. {address} in the head is always the address ' +
        'doing the signing; where a statement names a second party — a declaration names both — ' +
        'that party has a slot of its own.',
      singleUseNote:
        'Signing spends the signature for every action except the reusable kinds below. A ' +
        'signature spent twice is refused, so one prompt authorises one write and not a window ' +
        'of them.',
      reusableKinds: [...REUSABLE_ACTION_KINDS],
      statements,
      session: {
        mint: {
          method: 'POST',
          path: '/api/session',
          body: ['address', 'signature', 'timestampMs'],
          action: 'read-content',
        },
        returns: ['address', 'expiresAtMs'],
        /*
          The token is ASKED FOR, never handed out by default: a browser gets the cookie and no
          body token, a program sends this header and gets `token` in the body as well. Until
          revision 4 this document promised `token` unconditionally, and an agent built from it
          read as anonymous.
        */
        bearerHeader: { name: 'x-weir-bearer', value: '1', adds: 'token' },
        cookie: READ_SESSION_COOKIE,
        bearer: 'Authorization: Bearer <token>',
        ttlMs: READ_SESSION_TTL_MS,
        grants:
          'Reads only, and only what that address already owns on chain. The chain is still ' +
          'consulted per request; the session settles whose entitlements to ask about.',
        cannot: ['publish', 'spend', 'unlock', 'follow', 'send'],
        revoke: { method: 'DELETE', path: '/api/session' },
        storageNote:
          'The server stores sha256(token) and never the token. Present it in the cookie or in ' +
          'the Authorization header; both resolve to the same row, the same expiry and the same ' +
          'revocation.',
      },
    },
    endpoints: endpointCatalogue(),
    rateLimits: {
      budgets: Object.fromEntries(
        Object.entries(BUDGETS).map(([name, budget]) => [
          name,
          { limit: budget.limit, windowMs: budget.windowMs },
        ]),
      ),
      note:
        'Per caller, sliding window. Over the limit is 429 with `retry-after` in seconds and ' +
        '`x-ratelimit-limit`; wait it out rather than retrying immediately. The limit exists to ' +
        'keep a shared fullnode answering for everybody.',
      quotas: Object.fromEntries(
        Object.entries(QUOTAS).map(([name, quota]) => [name, { capacity: quota.capacity, msPerToken: quota.msPerToken }]),
      ),
      quotasNote:
        'Per address, token buckets shared across the whole deployment: `capacity` at once, then ' +
        'one more every `msPerToken`. `purchase` is spent at /api/checkout/submit for a signed ' +
        'unlock, subscribe, tip or renew — ten at once, then one every six minutes — so a retry ' +
        'loop against the buy path is stopped before it costs more than that. A refusal is 429 ' +
        'with `retryAfterSeconds` and `remaining`; pace to `msPerToken` rather than retrying.',
    },
    disclosure: {
      requirement:
        'An address operated by software must be declared as one, at POST /api/agents/declare, ' +
        'before it acts on this platform. The declaration is a pair of signatures — the machine ' +
        'signing that it is a machine and naming its operator, the operator signing that they ' +
        'answer for it — so the register records something neither party could have written about ' +
        'the other alone. GET /api/agents/{address} hands the entry back with both statements and ' +
        'both signatures, which is what makes it checkable by anybody without trusting us.',
      userAgent:
        'Send a User-Agent naming the software and a way to reach whoever runs it — a URL or an ' +
        'email address. An agent nobody can contact cannot be told it is misbehaving before it is ' +
        'blocked.',
      principal:
        'Every signature must be made by the key of the principal you act for. This server proves ' +
        'the signature and nothing else, so an agent holding a principal’s key acts as that ' +
        'principal in full — tell that principal so, because nothing here changes it.',
      impersonation:
        'Content published through an agent must not present itself as authored by a person who ' +
        'did not author it, and must not misrepresent whose account it speaks for. Declaring an ' +
        'address as a machine and then writing as a person is the same breach with a record of it.',
      backoff:
        'Honour 429 and `retry-after`. Sustained hammering of a shared node is what the Terms ' +
        'call overloading the Service.',
      basis: 'Terms of Service sections 6(d) and 6(g). The full text is at /legal/terms.',
      enforced: [
        'both halves of a declaration, verified independently',
        'rate limits',
        'signature verification',
        'read-session proof',
        'on-chain entitlement',
      ],
      notEnforced:
        'Nothing inspects a User-Agent, and a declaration is a term you are held to rather than a ' +
        'gate every endpoint stops you at — which endpoints consult the register is a property of ' +
        'those endpoints, not of this section, and it will grow. Do not read the absence of a ' +
        'check as permission: a breach is a Section 6 matter, not a 403.',
    },
    mcp: {
      hosted: 'https://mcp.weir.social/mcp',
      mode: 'read-only' as const,
      tools: ['weir_search', 'weir_quote', 'weir_read', 'weir_balance'],
      note:
        'The hosted server is the keyless build: no signer and no policy are bound, so it registers ' +
        'only tools that read, and it exits before listening if a key is placed in its environment. ' +
        'Spending tools exist only in a copy you run yourself with your own key.',
    },
    custody:
      input.custody !== undefined && input.custody.ok
        ? {
            upgradeCap: capEntry(input.custody.value.upgradeCap),
            platformCap: capEntry(input.custody.value.platformCap),
            note:
              'The UpgradeCap is the object that can publish a new version of the package, which ' +
              'is the only power that can change what the key servers approve. The PlatformCap ' +
              'sets the platform fee for NEW vaults only (an existing vault keeps its snapshot). ' +
              'Each holder is the object\'s owner as the chain reported it when this document was ' +
              'built; read the objects yourself rather than trusting this line.',
          }
        : null,
    custodyUnavailable:
      input.custody === undefined
        ? 'this deployment has not configured its capability ids'
        : input.custody.ok
          ? null
          : input.custody.failure.detail,
  };

  if (!input.config.ok) {
    /*
      Unconfigured is a state, not an error, exactly as `/api/deployment` and `/api/seal` treat it.
      The authentication block still goes out: the statements are a property of the code rather
      than of any deployment, so an agent can still learn what it must sign.
    */
    return {
      ...base,
      unavailable: input.config.failure.detail,
      chain: null,
      money: null,
      seal: null,
      sealUnavailable: input.config.failure.detail,
    };
  }

  const config = input.config.value;

  return {
    ...base,
    unavailable: null,
    chain: {
      network: config.network,
      grpcUrl: config.grpcUrl,
      jsonRpc: 'unsupported',
      transportNote:
        'Sui public fullnodes answer JSON-RPC with -32601 "JSON-RPC on public fullnodes has been ' +
        'deprecated". Use gRPC. A client built on JSON-RPC does not degrade, it stops.',
      originalPackageId: config.packageId,
      latestPackageId: config.latestPackageId,
      packageNote:
        'These differ after an upgrade and both are correct answers to different questions. Move ' +
        'type identity is bound to the address a struct was first published at, forever, so every ' +
        'type tag and every event names the ORIGINAL. Sui does not resolve a package id to its ' +
        'newest version, so a call to the original executes the original bytecode and a module ' +
        'added since is simply not there — the failure is FunctionNotFound, which does not look ' +
        'like a version problem. Call the LATEST.',
      useOriginalFor: [
        'object type filters',
        'event filters',
        'the Seal namespace, which requires package version 1',
      ],
      useLatestFor: ['every moveCall target'],
      platformId: config.platformId,
      registryId: config.registryId,
      keyRegistryId: input.keyRegistryId.ok ? input.keyRegistryId.value : null,
      keyRegistryUnavailable: input.keyRegistryId.ok ? null : input.keyRegistryId.failure.detail,
      explorer: {
        originalPackage: explorerUrl(config.packageId),
        latestPackage: explorerUrl(config.latestPackageId),
        platform: explorerUrl(config.platformId),
        registry: explorerUrl(config.registryId),
      },
    },
    money: {
      amountEncoding:
        'Every amount crosses this boundary as a decimal string of the coin’s smallest ' +
        'units. 1.5 USDC is "1500000".',
      /*
        Written without the arithmetic spelled out, on purpose. `test/scale-guard.test.ts` greps
        this source tree for a scale multiplied or divided as a literal, and it cannot tell a string
        from code — correctly, since a string is where the last several copies of that bug were
        described rather than fixed. The sentence carries the same warning without tripping it.
      */
      amountNote:
        'Strings, not numbers, and never floats. Parsing "1.001" as a float and scaling it up by a ' +
        'million yields 1000999.9999999999, which either aborts an exact-amount call or leaves ' +
        'dust behind forever; scaling back down loses precision above 2^53, which is a rounding ' +
        'error in somebody’s earnings on the worst possible schedule.',
      decimals: { usdc: USDC_DECIMALS, sui: SUI_DECIMALS },
      decimalsNote:
        'Native Circle USDC on Sui has six and SUI has nine. Read CoinMetadata before assuming ' +
        'six for any other coin — two different coins can both end in ::USDC.',
      vaultCoinTypes: input.coinTypes,
      vaultCoinTypesNote:
        'What this interface will build and simulate, which is not what the chain permits: ' +
        'open_vault<T> is generic with no on-chain allowlist. A vault’s coin is its type ' +
        'parameter, fixed at creation, and every price against that vault is denominated in it.',
      bpsDenominator: BPS_DENOMINATOR.toString(),
      feeNote:
        'The fee is an on-chain value a capability holder can change, so it is read from the ' +
        'Platform object rather than held as a constant. Read it again rather than caching it ' +
        'across a session. referralShareBps is a share OF THE FEE, not of the payment.',
      platform: input.platform.ok
        ? {
            feeBps: input.platform.value.feeBps.toString(),
            referralShareBps: input.platform.value.referralShareBps.toString(),
            creationFeeMist: input.platform.value.creationFeeMist.toString(),
            creationPaused: input.platform.value.creationPaused,
            paymentsPaused: input.platform.value.paymentsPaused,
            readFrom: config.platformId,
          }
        : null,
      platformUnavailable: input.platform.ok ? null : input.platform.failure.detail,
    },
    seal: input.seal.ok
      ? {
          /*
            Three fields, named rather than spread. `SealKeyServer` also carries `apiKeyName` and
            `apiKey`, which are the committee credential; spreading the object would publish them
            the first time somebody added a field without thinking about this file.
          */
          keyServers: input.seal.value.keyServers.map((server) => ({
            objectId: server.objectId,
            weight: server.weight,
            // Spread rather than assigned: the Seal SDK distinguishes a committee-mode server from
            // an independent one by whether this key is PRESENT, and `undefined` counts as present.
            ...(server.aggregatorUrl === undefined ? {} : { aggregatorUrl: server.aggregatorUrl }),
          })),
          committee: input.keyServerStates?.ok === true ? input.keyServerStates.value : null,
          committeeUnavailable:
            input.keyServerStates === undefined
              ? 'this build did not resolve the committee against the chain'
              : input.keyServerStates.ok
                ? null
                : input.keyServerStates.failure.detail,
          committeeSource:
            'The list of object ids is this deployment\u2019s configuration; `committee` is what ' +
            'the chain said about each of them at observedAtMs. Seal publishes no on-chain ' +
            'registry of committees, so there is nothing to discover the LIST from \u2014 but ' +
            'whether each pinned id still names a live key server is a chain fact, and it is read ' +
            'per request rather than per deploy.',
          committeeNote:
            'Do not cache this. A committee member retired or replaced on chain shows up here as ' +
            'onChain: "absent", and a client holding a list from last week would keep encrypting ' +
            'to a threshold it can no longer meet \u2014 which surfaces to a paying reader as ' +
            'being unable to open what they bought. Re-read this document at least as often as ' +
            'refreshAfterMs.',
          refreshAfterMs: SEAL_COMMITTEE_REFRESH_MS,
          threshold: input.seal.value.threshold,
          namespacePackageId: sealPackageId(config),
          approveTargets: [
            `${config.latestPackageId}::entitlement::seal_approve_unlock`,
            `${config.latestPackageId}::entitlement::seal_approve_subscription`,
          ],
          periodMs: SEAL_PERIOD_MS.toString(),
          note:
            'The namespace is the ORIGINAL package because Seal refuses a package whose version is ' +
            'not 1; the approval call targets the LATEST, and the two being different values is ' +
            'correct rather than an inconsistency. A paid body and its media share one unlock ' +
            'identity. Subscriber content is sealed to the period it was published in, so a ' +
            'subscription opens the periods it covers and not the archive before it.',
        }
      : null,
    sealUnavailable: input.seal.ok ? null : input.seal.failure.detail,
  };
}

/**
 * The document for this deployment, right now.
 *
 * The thin adapter over {@link manifestFrom}: environment in, readings out, no decisions of its
 * own. The one chain read here is the platform's economic terms, and it is allowed to fail without
 * taking the document with it — an agent that cannot learn the fee can still learn what to sign.
 */
export async function agentManifest(origin: string): Promise<AgentManifest> {
  const env = process.env as Record<string, string | undefined>;
  const config = siteConfig();
  const seal = loadSealConfig(env);
  const protocol = await readProtocol();

  /*
    Two more chain reads, and both are allowed to fail without taking the document with them.

    They run together rather than in sequence because neither depends on the other and this route is
    on a 60-second cache — one round trip of latency is worth paying for two facts, two is not. On a
    deployment with no configuration there is no client to read with, and both come back as the same
    `unconfigured` failure the rest of the document already carries.
  */
  const client = config.ok ? createClient(config.value) : null;
  const [packageLineage, keyServerStates] = await Promise.all([
    client === null || !config.ok
      ? Promise.resolve(
          fail<PackageLineage>('unconfigured', 'package lineage', 'this deployment is not configured'),
        )
      : readPackageLineage(client, config.value.latestPackageId),
    client === null || !seal.ok
      ? Promise.resolve(
          fail<KeyServerState[]>(
            'unconfigured',
            'seal committee',
            'no key server committee is configured on this deployment',
          ),
        )
      : resolveKeyServers(client, seal.value.keyServers).then((states) => ok(states)),
  ]);

  const custody = await readCustody(env, client);

  return manifestFrom({
    origin,
    observedAtMs: Date.now(),
    config,
    custody,
    keyRegistryId: loadKeyRegistryId(env),
    seal,
    coinTypes: vaultCoinTypes(env),
    // `map`, not a rebuilt object: a failure has to pass through unchanged, carrying the kind and
    // the detail the node actually gave, so `platformUnavailable` says what went wrong.
    platform: map(protocol, (snapshot) => snapshot.platform),
    // Only the public half reaches the document. See `ManifestInputs.signer`.
    signer: map(loadManifestSigner(env), (loaded) => loaded.identity),
    packageLineage,
    keyServerStates,
  });
}

/* ------------------------------------------------------------------------------------------------
   The root of trust: signing what we serve, and the two cross-checks that go with it.
   ------------------------------------------------------------------------------------------------ */

/**
 * The environment variable holding the operator's signing key.
 *
 * A Sui private key in the `suiprivkey1…` bech32 form, Ed25519 only. **Never a fallback, never a
 * generated one.** A deployment with no key publishes `integrity.signer: null` and an unsigned
 * document, which an agent can see and decide about; a deployment that quietly signed with a key it
 * invented would publish something that verifies perfectly and proves nothing, which is worse than
 * publishing nothing — the check would pass and the reader would conclude they had checked.
 *
 * Held apart from every other key in this system on purpose. It signs a public document and must
 * not be the `PlatformCap` holder, the deployer, or any address that can move money: a key whose
 * only power is to say "this JSON is ours" can live on an application server, and one that can also
 * upgrade a package cannot.
 */
export const AGENT_MANIFEST_KEY_ENV = 'PROJECTX_SOCIAL_AGENT_MANIFEST_KEY';

/** The private half never leaves this module; only {@link ManifestSignerIdentity} is published. */
interface LoadedSigner {
  identity: ManifestSignerIdentity;
  key: KeyObject;
}

/**
 * The DER prefix that turns 32 raw Ed25519 seed bytes into a PKCS#8 private key.
 *
 * `302e020100300506032b657004220420` is a fixed, complete PKCS#8 header for an Ed25519 key of
 * exactly this length: SEQUENCE, version 0, AlgorithmIdentifier `1.3.101.112`, then the OCTET
 * STRING wrapper. It is a constant rather than a DER encoder because the input length is fixed at
 * 32 by the scheme, so there is nothing to encode — and because a hand-rolled encoder is a second
 * thing to get wrong on a path that produces a key.
 *
 * Needed because Node's `createPrivateKey` will not take raw seed bytes, and `jose` wants a key
 * object rather than a seed.
 */
const ED25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

/**
 * Load the operator key, or say why there is none.
 *
 * Every failure here is `unconfigured` or `malformed` and none of them is fatal to the document:
 * the manifest still goes out, unsigned, saying so. A discovery document that refuses to be
 * discovered because a key is missing takes the whole agent surface down to protect a signature.
 */
export function loadManifestSigner(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): Reading<LoadedSigner> {
  const source = 'agent manifest signing key';
  const raw = env[AGENT_MANIFEST_KEY_ENV]?.trim();

  if (raw === undefined || raw === '') {
    return fail(
      'unconfigured',
      source,
      `${AGENT_MANIFEST_KEY_ENV} is not set, so this manifest is published unsigned. An agent ` +
        'cannot tell it apart from one an intermediary rewrote.',
    );
  }

  let parsed: { scheme: string; secretKey: Uint8Array };
  try {
    parsed = decodeSuiPrivateKey(raw);
  } catch (error) {
    // The key's own text is NEVER echoed. `detail` carries the class of fault and nothing else,
    // because this string reaches the response body when the read fails.
    return fail(
      'malformed',
      source,
      `${AGENT_MANIFEST_KEY_ENV} is not a decodable Sui private key ` +
        `(${error instanceof Error ? error.name : 'unknown error'}).`,
    );
  }

  if (parsed.scheme !== 'ED25519') {
    return fail(
      'malformed',
      source,
      `${AGENT_MANIFEST_KEY_ENV} is a ${parsed.scheme} key. This document is signed with EdDSA, ` +
        'and a scheme mismatch is a configuration mistake rather than something to negotiate.',
    );
  }

  try {
    const keypair = Ed25519Keypair.fromSecretKey(parsed.secretKey);
    const key = createPrivateKey({
      key: Buffer.concat([ED25519_PKCS8_PREFIX, Buffer.from(parsed.secretKey)]),
      format: 'der',
      type: 'pkcs8',
    });
    return ok({
      identity: {
        address: keypair.toSuiAddress(),
        publicKey: Buffer.from(keypair.getPublicKey().toRawBytes()).toString('base64'),
        algorithm: 'EdDSA',
      },
      key,
    });
  } catch (error) {
    return fail(
      'malformed',
      source,
      `${AGENT_MANIFEST_KEY_ENV} could not be turned into a signing key ` +
        `(${error instanceof Error ? error.name : 'unknown error'}).`,
    );
  }
}

/**
 * Read the lineage of the LATEST package, so the pair this document publishes can be checked.
 *
 * # What this catches, and it is not hypothetical
 *
 * The manifest publishes two package ids and tells an agent to use the ORIGINAL for type filters,
 * event filters and the Seal namespace, and the LATEST for every `moveCall`. Both come from
 * configuration, and nothing has ever checked that they are two versions of ONE package. Three ways
 * they stop being that:
 *
 *   1. **A pasted upgrade.** Somebody upgrades and writes the new id into
 *      `PROJECTX_SOCIAL_PACKAGE_ID` instead of `PROJECTX_SOCIAL_LATEST_PACKAGE_ID`. Every
 *      `moveCall` still resolves, so nothing fails at the door — but every event filter and every
 *      object type filter now names a package that never defined those types, so an agent reads an
 *      empty chain and concludes the creator has no posts. Worse, `sealPackageId` requires version
 *      1, and the new id is version 2, so sealing stops with an error about Seal rather than about
 *      configuration.
 *   2. **Two deployments crossed.** A staging original beside a production latest. Calls land on
 *      production and types are filtered against staging; the failure is silence, not an abort.
 *   3. **A lookalike.** Somebody publishes a package with our module names and an operator, or an
 *      attacker with write access to configuration, points `latest` at it. Every call an agent
 *      makes then executes somebody else's bytecode under our manifest's name.
 *
 * The chain settles all three in one read: `original_id` is stable across every version of a
 * package and is the identity the runtime itself uses, so if the latest package's `original_id` is
 * not the id we publish as `original`, the two are not one package and this document is wrong. It
 * is the one claim in here that can be checked against something other than our own configuration.
 *
 * `gRPC` only, as everything in this repository is: `MovePackageService.GetPackage`. There is no
 * JSON-RPC path and there deliberately is not one.
 */
export async function readPackageLineage(
  client: SuiGrpcClient,
  latestPackageId: string,
): Promise<Reading<PackageLineage>> {
  const source = `package ${latestPackageId}`;
  try {
    const response = await client.movePackageService.getPackage({ packageId: latestPackageId });
    const pkg = response.response.package;
    if (pkg === undefined) {
      return fail('not-found', source, 'no package exists at that id on this network');
    }
    if (pkg.originalId === undefined || pkg.originalId === '') {
      return fail('malformed', source, 'the node returned a package with no original_id');
    }
    return ok({ originalId: pkg.originalId, version: String(pkg.version ?? '') });
  } catch (error) {
    const failure = classify(error, source);
    return fail(failure.kind, source, failure.detail);
  }
}

/**
 * Resolve the configured key server committee against the chain, at serve time.
 *
 * # What is honest about this, and what is not
 *
 * **The committee is still pinned in configuration, and this does not change that.** Seal publishes
 * no on-chain registry of "the committee for package X" — a key server is a Move object, and which
 * objects an application trusts is that application's policy, held in
 * `PROJECTX_SOCIAL_SEAL_KEY_SERVERS`. There is nothing on chain to discover the list FROM, so this
 * function cannot make the list itself chain-derived, and saying otherwise would be the kind of
 * claim this codebase spends its comments removing.
 *
 * What the chain CAN settle is whether each pinned id still names a key server, and that is what
 * this reads — per request, not per deploy. It closes the failure the pinning was worried about
 * from the side that is reachable: a committee member retired, deleted or replaced on chain now
 * shows up in this document as `absent`, at the moment an agent reads it, instead of being echoed
 * back from an environment variable forever. An agent that finds `onChain: "absent"` on enough of
 * the committee to break the threshold knows before it encrypts anything, rather than discovering
 * it when a reader cannot decrypt.
 *
 * What it does NOT close, stated so nobody reads more into it: a committee CHANGE that adds a new
 * server we have not been told about is invisible here, because there is nothing to read it from.
 * That remains an operator action and an env change, and `refreshAfterMs` on the manifest is the
 * mitigation — a client is told not to cache the committee, so the next read after the env changes
 * is correct.
 *
 * One unreadable server does not fail the others. Each is its own `getObject`, and a failure is
 * recorded against that entry with the node's own text.
 */
export async function resolveKeyServers(
  client: SuiGrpcClient,
  servers: readonly { objectId: string; weight: number; aggregatorUrl?: string }[],
): Promise<KeyServerState[]> {
  return Promise.all(
    servers.map(async (server): Promise<KeyServerState> => {
      const base = {
        objectId: server.objectId,
        weight: server.weight,
        ...(server.aggregatorUrl === undefined ? {} : { aggregatorUrl: server.aggregatorUrl }),
      };
      try {
        const response = await client.getObject({ objectId: server.objectId });
        const object = (response as { object?: { type?: unknown } }).object;
        if (object === undefined || object === null) {
          return { ...base, onChain: 'absent', objectType: null, detail: 'no object at that id' };
        }
        return {
          ...base,
          onChain: 'present',
          objectType: typeof object.type === 'string' ? object.type : null,
          detail: null,
        };
      } catch (error) {
        const failure = classify(error, `key server ${server.objectId}`);
        /*
          `not-found` is an answer, not a fault. The distinction is the whole of `Reading`'s
          argument applied here: a node that says "there is nothing there" has told us the committee
          member is gone, and reporting that as `unreadable` would hide a real, actionable state
          behind a transient-looking one.
        */
        return failure.kind === 'not-found'
          ? { ...base, onChain: 'absent', objectType: null, detail: failure.detail }
          : { ...base, onChain: 'unreadable', objectType: null, detail: failure.detail };
      }
    }),
  );
}

/* ------------------------------------------------------------------------------------------------
   The served document: the exact bytes, their digest, and the signature over them.
   ------------------------------------------------------------------------------------------------ */

/** Everything the route needs, produced together so the bytes signed are the bytes served. */
export interface ServedManifest {
  /** The document, for anything that wants the object rather than the bytes. */
  manifest: AgentManifest;
  /**
   * The exact response body, and the exact signed payload.
   *
   * A string rather than an object handed to `NextResponse.json`, and that is load-bearing. A
   * signature is over bytes; if the route serialised the object a second time, any difference at
   * all between the two serialisations — a key order, a number's formatting, a runtime's
   * `JSON.stringify` changing between versions — would produce a document whose own signature does
   * not verify. **Sign what you serve** is the only version of this that cannot drift, and it costs
   * one string.
   */
  body: string;
  /**
   * RFC 7515 detached compact JWS: `<protected>..<signature>`, with the payload segment empty.
   *
   * Detached because the payload is the response body, which the caller already has; including it
   * would double the transfer and create a second copy that could disagree with the first. To
   * verify: base64url-encode the body, splice it into the middle segment, and hand the result to
   * any compact-JWS verifier.
   *
   * Null when no key is configured — an unsigned document, plainly labelled, rather than a
   * signature nobody can trust.
   */
  jws: string | null;
  /** `sha-256=:<base64>:` — RFC 9530 `Content-Digest` over {@link body}. */
  contentDigest: string;
  /** A strong RFC 9110 `ETag` over {@link body}, quoted and ready to send. */
  etag: string;
}

/**
 * Serialise, digest and sign — in that order, over one set of bytes.
 *
 * # Why the ETag moves on nearly every request, and why that is correct
 *
 * An `ETag` identifies an entity, and this entity genuinely changes: it carries `observedAtMs` and
 * a live reading of the platform's economic terms. So two requests a second apart legitimately
 * produce two different documents, and two different tags. That makes conditional requests rarely
 * succeed, which is a real cost and the honest one — the alternative is a tag computed over a
 * subset of the body, which would claim two different documents were the same entity and hand a
 * caller a `304` for bytes they do not have. The 60-second `cache-control` is what actually buys
 * the caching here; the tag is for integrity, and it is a strong validator because it is a digest
 * of exactly what was sent.
 */
export async function signManifest(
  manifest: AgentManifest,
  signer: Reading<LoadedSigner>,
): Promise<ServedManifest> {
  const body = JSON.stringify(manifest);
  const bytes = new TextEncoder().encode(body);
  const digest = createHash('sha256').update(bytes).digest();

  const base = {
    manifest,
    body,
    contentDigest: `sha-256=:${digest.toString('base64')}:`,
    // Strong, and quoted per RFC 9110. Hex rather than base64 so it survives a header-mangling
    // proxy that decides `+` and `/` need escaping.
    etag: `"${digest.toString('hex')}"`,
  };

  if (!signer.ok) return { ...base, jws: null };

  /*
    The protected header is signed, and carries the two facts that make replay detectable.

    `ver` repeats the body's `version` and `iat` says when this was signed. Both are inside the
    signature, so an attacker replaying an old document cannot age it forward, and a consumer that
    keeps the highest `ver` it has seen from an origin — and refuses a stale `iat` — has closed the
    only attack a signature alone leaves open. `kid` is the signer's Sui address, so a verifier can
    pick the right key without parsing the body first.
  */
  const compact = await new CompactSign(bytes)
    .setProtectedHeader({
      alg: signer.value.identity.algorithm,
      typ: 'JOSE',
      kid: signer.value.identity.address,
      ver: manifest.version,
      iat: Math.floor(manifest.observedAtMs / 1000),
    })
    .sign(signer.value.key);

  const [header, , signature] = compact.split('.');
  // Detached: the middle segment is dropped, not blanked out of laziness. The verifier puts the
  // body back where it was — see {@link ServedManifest.jws}.
  return { ...base, jws: `${header ?? ''}..${signature ?? ''}` };
}

/**
 * The signed, digested document for this deployment, right now.
 *
 * The one function the route calls. Everything it composes is separately testable, and the
 * composition itself is deliberately dull.
 */
export async function servedManifest(origin: string): Promise<ServedManifest> {
  const env = process.env as Record<string, string | undefined>;
  return signManifest(await agentManifest(origin), loadManifestSigner(env));
}

/**
 * The capability ids from configuration and their holders from chain.
 *
 * Absent configuration is `unconfigured`, calmly — a deployment that has not named its caps
 * publishes no custody claim rather than a guessed one. A holder that cannot be read is reported
 * per capability, so one unreadable object does not erase the other.
 */
async function readCustody(
  env: Record<string, string | undefined>,
  client: ReturnType<typeof createClient> | null,
): Promise<Reading<CustodyReading>> {
  const upgradeCapId = (env['PROJECTX_SOCIAL_UPGRADE_CAP_ID'] ?? '').trim();
  const platformCapId = (env['PROJECTX_SOCIAL_PLATFORM_CAP_ID'] ?? '').trim();
  if (upgradeCapId === '' || platformCapId === '') {
    return fail('unconfigured', 'custody', 'PROJECTX_SOCIAL_UPGRADE_CAP_ID and PROJECTX_SOCIAL_PLATFORM_CAP_ID are not both set');
  }
  if (client === null) {
    return fail('unconfigured', 'custody', 'this deployment is not configured');
  }
  const holderOf = async (objectId: string): Promise<Reading<string>> => {
    try {
      const response = await client.getObject({ objectId });
      const object = (response as { object?: { owner?: { address?: unknown; kind?: unknown } | null } }).object;
      if (object === undefined || object === null) return fail('not-found', `owner of ${objectId}`, 'no object at that id');
      const address = object.owner?.address;
      if (typeof address !== 'string' || address === '') {
        return fail('malformed', `owner of ${objectId}`, `the object is not address-owned (owner kind ${String(object.owner?.kind ?? 'unknown')})`);
      }
      return ok(address);
    } catch (error) {
      const failure = classify(error, `owner of ${objectId}`);
      return fail(failure.kind, `owner of ${objectId}`, failure.detail);
    }
  };
  const [upgradeHolder, platformHolder] = await Promise.all([holderOf(upgradeCapId), holderOf(platformCapId)]);
  return ok({
    upgradeCap: { objectId: upgradeCapId, holder: upgradeHolder },
    platformCap: { objectId: platformCapId, holder: platformHolder },
  });
}
