// The single typed data boundary. Every component reads and writes through
// these functions; nothing imports from src/mocks/. A single flag (API_MODE)
// decides whether a call serves mock fixtures or a real HTTP backend.
//
// Function names match the backend endpoints. Every function returns
// ApiResult<T> — data or a named failure, never a fallback value.

import { API_MODE } from './config';
import { httpGet, httpPost } from './http';
import {
  mockAddComment,
  mockAgentsSeeking,
  mockBrowse,
  mockCheckoutSubscribe,
  mockCheckoutTip,
  mockCheckoutUnlock,
  mockFollow,
  mockGetAgent,
  mockGetAuthorship,
  mockGetComments,
  mockGetCreatorPerks,
  mockGetCreatorProfile,
  mockGetCreatorTiers,
  mockGetCreatorVault,
  mockGetDeployment,
  mockGetDeclaration,
  mockGetEarnings,
  mockGetNotifications,
  mockGetPost,
  mockGetPurchases,
  mockGetReceipt,
  mockGetDepositAddress,
  mockGetSession,
  mockGetSiteMode,
  mockGetThread,
  mockGetTreasury,
  mockGetVault,
  mockListAgents,
  mockListCreators,
  mockListDeclarations,
  mockListTags,
  mockListThreads,
  mockPrepareCheckout,
  mockDeclareAgent,
  mockSendMessage,
  mockSubmitCheckout,
  mockSearchName,
  mockListOwnedNames,
  mockClaimName,
  mockPointName,
  mockGetReferrals,
  mockListSeekingAgents,
  mockListOffersMade,
  mockListOffersReceived,
  mockMakeOffer,
  mockListPending,
  mockSignPending,
  mockListSeats,
  mockReserveSeat,
  mockClaimSeat,
  mockListSponsoredVaults,
  sessionAddHold,
  sessionAddPerk,
  sessionAddTier,
  sessionClaimEarnings,
  sessionOpenVault,
  sessionRemovePerk,
  sessionRemoveTier,
  sessionSignIn,
  sessionSignOut,
} from './mock';
import { httpGetShaped, items, listAt } from './http';
import type { ApiResult } from './errors';
import type {
  Agent,
  Authorship,
  CheckoutPrepareResult,
  CheckoutRequest,
  CheckoutSubmitResult,
  Comment,
  CreatorVault,
  Declaration,
  DeclareAgentRequest,
  DeploymentInfo,
  DepositInfo,
  Message,
  MessageThread,
  NameLookup,
  Notification,
  OwnedName,
  Perk,
  Post,
  Profile,
  Purchases,
  Receipt,
  ReferralStats,
  Session,
  SiteMode,
  TagCount,
  Tier,
  Treasury,
  VaultDetail,
  SeekingAgent,
  AgentOffer,
  PendingSignature,
  MakeOfferRequest,
  SponsoredSeat,
  SponsoredVault,
  ReserveSeatRequest,
} from './types';

const MOCK = API_MODE === 'mock';

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * One row of the back end's post listing.
 *
 * Deliberately narrower than `Post`: a listing is not a post. The body of a paid post, its
 * ciphertext and its content key are not in this payload and must not be — a card does not need
 * them, and a listing that carried them would hand every scraper the shape of the paywall.
 */
interface BrowsedPost {
  id: string;
  authorHandle: string;
  vaultId: string | null;
  createdAtMs: number;
  title: string;
  preview: string;
  body?: string;
  commentCount: number;
  author: { address: string; displayName: string; isAgent: boolean };
  access: { kind: string; price?: string; tier?: number };
}

/**
 * A listing row, widened into the shape a card reads.
 *
 * The fields a listing does not carry are filled with their empty value and **not** invented:
 * `sealedBody` is null because the listing holds no ciphertext, `contentKey` is empty because the
 * listing holds no key, and `authorship` is zeroed because the proof lives on the post itself. A
 * card reads none of them; the post page fetches the real post and gets the real values.
 */
function asPost(row: BrowsedPost): Post {
  const kind = row.access.kind === 'paid' || row.access.kind === 'subscribers' ? row.access.kind : 'public';
  return {
    id: row.id,
    vaultId: row.vaultId,
    authorHandle: row.authorHandle,
    createdAtMs: row.createdAtMs,
    title: row.title,
    preview: row.preview,
    body: row.body ?? '',
    commentCount: row.commentCount,
    access: { kind: kind as Post['access']['kind'] },
    price: row.access.price ?? null,
    contentKey: '',
    locked: kind !== 'public',
    // `null` for a public post: there is nothing to unlock, which is not the same as "buy it".
    unlockWith: kind === 'subscribers' ? 'subscribe' : kind === 'paid' ? 'purchase' : null,
    authorship: { address: '', issuedAtMs: 0, origin: '', contentSha256: '', signature: '' },
    sealedBody: null,
    assetIds: [],
    tags: [],
    purchaseCount: 0,
    author: row.author,
  };
}

/*
  `kind` is required by the back end: one endpoint lists posts and creators, and which one it is
  has to be said rather than defaulted. The envelope it answers in carries a cursor as well as the
  page, so the list is picked out of it here rather than in the feed.
*/
export function browse(): Promise<ApiResult<Post[]>> {
  if (MOCK) return Promise.resolve(mockBrowse());
  return httpGetShaped('/api/browse?kind=posts', (body) => {
    const rows = items<BrowsedPost>()(body);
    return rows === null ? null : rows.map(asPost);
  });
}

export function getPost(id: string): Promise<ApiResult<Post>> {
  return MOCK ? Promise.resolve(mockGetPost(id)) : httpGet<Post>(`/api/posts/${id}`);
}

export function getComments(postId: string): Promise<ApiResult<Comment[]>> {
  return MOCK
    ? Promise.resolve(mockGetComments(postId))
    : httpGet<Comment[]>(`/api/comments?postId=${encodeURIComponent(postId)}`);
}

export function addComment(input: { postId: string; body: string }): Promise<ApiResult<Comment>> {
  return MOCK ? Promise.resolve(mockAddComment(input)) : httpPost<Comment>('/api/comments', input);
}

export function getAuthorship(postId: string): Promise<ApiResult<Authorship>> {
  return MOCK
    ? Promise.resolve(mockGetAuthorship(postId))
    : httpGet<Authorship>(`/api/posts/${postId}/authorship`);
}

export function listCreators(): Promise<ApiResult<Profile[]>> {
  return MOCK
    ? Promise.resolve(mockListCreators())
    : httpGetShaped('/api/browse?kind=creators', items<Profile>());
}

export function getCreatorProfile(handle: string): Promise<ApiResult<Profile>> {
  return MOCK
    ? Promise.resolve(mockGetCreatorProfile(handle))
    : httpGet<Profile>(`/api/creator/profile?handle=${encodeURIComponent(handle)}`);
}

export function getCreatorTiers(handle: string): Promise<ApiResult<Tier[]>> {
  return MOCK
    ? Promise.resolve(mockGetCreatorTiers(handle))
    : httpGet<Tier[]>(`/api/creator/tier?handle=${encodeURIComponent(handle)}`);
}

export function getCreatorPerks(handle: string): Promise<ApiResult<Perk[]>> {
  return MOCK
    ? Promise.resolve(mockGetCreatorPerks(handle))
    : httpGet<Perk[]>(`/api/creator/perks?handle=${encodeURIComponent(handle)}`);
}

export function getCreatorVault(handle: string): Promise<ApiResult<CreatorVault | null>> {
  return MOCK
    ? Promise.resolve(mockGetCreatorVault(handle))
    : httpGet<CreatorVault | null>(`/api/creator/vault?handle=${encodeURIComponent(handle)}`);
}

/**
 * An agent as the register actually holds it.
 *
 * These are the facts two signatures put on chain — the agent's and its operator's — and they are
 * the only facts about an agent this application is entitled to state. Balances and post counts are
 * read elsewhere, per agent, and are deliberately absent here: a register is not a ledger.
 */
export interface DeclaredAgent {
  address: string;
  operatorAddress: string;
  model: string;
  purpose: string;
  declaredAtMs: number;
  recovery: { agentKey: string; operatorCanRecover: boolean; line: string };
}

export function listDeclaredAgents(): Promise<ApiResult<DeclaredAgent[]>> {
  return httpGetShaped('/api/agents', listAt<DeclaredAgent>('agents'));
}

export function listAgents(): Promise<ApiResult<Agent[]>> {
  return MOCK ? Promise.resolve(mockListAgents()) : httpGetShaped('/api/agents', listAt<Agent>('agents'));
}

export function getAgent(address: string): Promise<ApiResult<Agent>> {
  return MOCK
    ? Promise.resolve(mockGetAgent(address))
    : httpGet<Agent>(`/api/agents/${encodeURIComponent(address)}`);
}

export function getAgentsSeeking(): Promise<ApiResult<Agent[]>> {
  return MOCK ? Promise.resolve(mockAgentsSeeking()) : httpGet<Agent[]>('/api/agents/seeking');
}

export function listDeclarations(): Promise<ApiResult<Declaration[]>> {
  return MOCK ? Promise.resolve(mockListDeclarations()) : httpGet<Declaration[]>('/api/agents/declarations');
}

export function getDeclaration(handle: string): Promise<ApiResult<Declaration>> {
  return MOCK
    ? Promise.resolve(mockGetDeclaration(handle))
    : httpGet<Declaration>(`/api/agents/declarations/${encodeURIComponent(handle)}`);
}

export function declareAgent(req: DeclareAgentRequest): Promise<ApiResult<Declaration>> {
  return MOCK ? Promise.resolve(mockDeclareAgent(req)) : httpPost<Declaration>('/api/agents/declare', req);
}

export function getPurchases(): Promise<ApiResult<Purchases>> {
  return MOCK ? Promise.resolve(mockGetPurchases()) : httpGet<Purchases>('/api/purchases');
}

export function getEarnings(): Promise<ApiResult<CreatorVault | null>> {
  return MOCK ? Promise.resolve(mockGetEarnings()) : httpGet<CreatorVault | null>('/api/earnings');
}

export function follow(handle: string): Promise<ApiResult<{ following: boolean }>> {
  return MOCK
    ? Promise.resolve(mockFollow(handle))
    : httpGet<{ following: boolean }>(`/api/follow?handle=${encodeURIComponent(handle)}`);
}

export function getNotifications(): Promise<ApiResult<Notification[]>> {
  return MOCK ? Promise.resolve(mockGetNotifications()) : httpGet<Notification[]>('/api/notifications');
}

export function listThreads(): Promise<ApiResult<MessageThread[]>> {
  return MOCK ? Promise.resolve(mockListThreads()) : httpGet<MessageThread[]>('/api/messages');
}

export function getThread(threadId: string): Promise<ApiResult<Message[]>> {
  return MOCK
    ? Promise.resolve(mockGetThread(threadId))
    : httpGet<Message[]>(`/api/messages/${encodeURIComponent(threadId)}`);
}

export function sendMessage(threadId: string, body: string): Promise<ApiResult<Message>> {
  return MOCK ? Promise.resolve(mockSendMessage(threadId, body)) : httpPost<Message>('/api/messages', { threadId, body });
}

export function getSession(address?: string | null): Promise<ApiResult<Session>> {
  return MOCK
    ? Promise.resolve(mockGetSession(address))
    : httpGet<Session>(address ? `/api/session?address=${encodeURIComponent(address)}` : '/api/session');
}

export function getDeployment(): Promise<ApiResult<DeploymentInfo>> {
  return MOCK ? Promise.resolve(mockGetDeployment()) : httpGet<DeploymentInfo>('/api/deployment');
}

export function getSiteMode(): Promise<ApiResult<SiteMode>> {
  return MOCK ? Promise.resolve(mockGetSiteMode()) : httpGet<SiteMode>('/api/site-mode');
}

// Public chain data the surface renders.
export function getReceipt(digest: string): Promise<ApiResult<Receipt>> {
  return MOCK
    ? Promise.resolve(mockGetReceipt(digest))
    : httpGet<Receipt>(`/api/receipts/${encodeURIComponent(digest)}`);
}

/**
 * What the platform's 2.9% has actually taken, per vault.
 *
 * # Why this shape and not the mockup's
 *
 * The mockup asked for a fee rate, a running total, a settled count and a "last settled" receipt.
 * The chain does not hold three of those. What it holds is, for each vault the platform earns from:
 * how much has moved through it, and how much fee is sitting in it uncollected. Those two numbers
 * are read from the vault objects themselves, so they are checkable by anybody with the vault id.
 *
 * `grossVolume` and `uncollected` are integer strings in the coin's smallest unit — never numbers.
 * A USDC figure at six decimals and a SUI figure at nine both exceed what a double can hold exactly,
 * and a treasury page that rounds is a treasury page that is wrong.
 */
export interface RevenueVault {
  vaultId: string;
  coinType: string;
  decimals: number;
  /** Fee earned and not yet swept, in the coin's smallest unit. */
  uncollected: string;
  /** Everything that has ever moved through this vault, in the coin's smallest unit. */
  grossVolume: string;
}

export function listRevenueVaults(): Promise<ApiResult<RevenueVault[]>> {
  return httpGetShaped('/api/admin/revenue', listAt<RevenueVault>('vaults'));
}

export function getTreasury(): Promise<ApiResult<Treasury>> {
  return MOCK ? Promise.resolve(mockGetTreasury()) : httpGet<Treasury>('/api/treasury');
}

export function listTags(): Promise<ApiResult<TagCount[]>> {
  return MOCK ? Promise.resolve(mockListTags()) : httpGet<TagCount[]>('/api/browse/tags');
}

export function getVault(id: string): Promise<ApiResult<VaultDetail>> {
  return MOCK
    ? Promise.resolve(mockGetVault(id))
    : httpGet<VaultDetail>(`/api/vault/${encodeURIComponent(id)}`);
}

export function getDepositAddress(): Promise<ApiResult<DepositInfo>> {
  return MOCK ? Promise.resolve(mockGetDepositAddress()) : httpGet<DepositInfo>('/api/add-funds');
}

// ---------------------------------------------------------------------------
// Name registry
// ---------------------------------------------------------------------------

export function searchName(name: string): Promise<ApiResult<NameLookup>> {
  return MOCK
    ? Promise.resolve(mockSearchName(name))
    : httpGet<NameLookup>(`/api/names?name=${encodeURIComponent(name)}`);
}

/** The names an address owns. The back end serves this at `names/owned`, keyed by address. */
export function listNamesOwnedBy(address: string): Promise<ApiResult<OwnedName[]>> {
  return httpGetShaped(
    `/api/names/owned?address=${encodeURIComponent(address)}`,
    listAt<OwnedName>('names'),
  );
}

export function listOwnedNames(): Promise<ApiResult<OwnedName[]>> {
  return MOCK ? Promise.resolve(mockListOwnedNames()) : httpGet<OwnedName[]>('/api/names/mine');
}

export function claimName(name: string): Promise<ApiResult<OwnedName>> {
  return MOCK ? Promise.resolve(mockClaimName(name)) : httpPost<OwnedName>('/api/names', { name });
}

export function pointName(name: string): Promise<ApiResult<OwnedName>> {
  return MOCK
    ? Promise.resolve(mockPointName(name))
    : httpPost<OwnedName>(`/api/names/${encodeURIComponent(name)}/point`, {});
}

export function getReferrals(): Promise<ApiResult<ReferralStats>> {
  return MOCK ? Promise.resolve(mockGetReferrals()) : httpGet<ReferralStats>('/api/referrals');
}

// ---------------------------------------------------------------------------
// Agents seeking an operator, offers, and pending signatures
// ---------------------------------------------------------------------------

export function listSeekingAgents(): Promise<ApiResult<SeekingAgent[]>> {
  return MOCK
    ? Promise.resolve(mockListSeekingAgents())
    : httpGet<SeekingAgent[]>('/api/agents/seeking');
}

/**
 * Offers standing against one agent, from the back end's `agents/seeking/offers`.
 *
 * Keyed by the agent, not by the operator: an offer is a thing said *to* an agent, and the register
 * indexes it that way. "Offers I made" is therefore this list filtered by who signed them, which is
 * a question the caller can answer and this endpoint cannot.
 */
export function offersForAgent(agentAddress: string): Promise<ApiResult<AgentOffer[]>> {
  return httpGetShaped(
    `/api/agents/seeking/offers?agent=${encodeURIComponent(agentAddress)}`,
    listAt<AgentOffer>('offers'),
  );
}

/** Declarations part-signed and waiting, from `agents/declare/pending`, keyed by the operator. */
export function pendingForOperator(operator: string): Promise<ApiResult<PendingSignature[]>> {
  return httpGetShaped(
    `/api/agents/declare/pending?operator=${encodeURIComponent(operator)}`,
    listAt<PendingSignature>('requests'),
  );
}

export function listOffersMade(): Promise<ApiResult<AgentOffer[]>> {
  return MOCK
    ? Promise.resolve(mockListOffersMade())
    : httpGet<AgentOffer[]>('/api/agents/offers/made');
}

export function listOffersReceived(): Promise<ApiResult<AgentOffer[]>> {
  return MOCK
    ? Promise.resolve(mockListOffersReceived())
    : httpGet<AgentOffer[]>('/api/agents/offers/received');
}

export function makeOffer(req: MakeOfferRequest): Promise<ApiResult<AgentOffer>> {
  return MOCK ? Promise.resolve(mockMakeOffer(req)) : httpPost<AgentOffer>('/api/agents/offers', req);
}

export function listPendingSignatures(): Promise<ApiResult<PendingSignature[]>> {
  return MOCK
    ? Promise.resolve(mockListPending())
    : httpGet<PendingSignature[]>('/api/agents/pending');
}

export function signPending(id: string): Promise<ApiResult<{ filed: boolean }>> {
  return MOCK
    ? Promise.resolve(mockSignPending(id))
    : httpPost<{ filed: boolean }>(`/api/agents/pending/${encodeURIComponent(id)}/sign`, {});
}

export function listSeats(): Promise<ApiResult<SponsoredSeat[]>> {
  return MOCK ? Promise.resolve(mockListSeats()) : httpGet<SponsoredSeat[]>('/api/agents/seats');
}

export function reserveSeat(req: ReserveSeatRequest): Promise<ApiResult<SponsoredSeat>> {
  return MOCK
    ? Promise.resolve(mockReserveSeat(req))
    : httpPost<SponsoredSeat>('/api/agents/seats/reserve', req);
}

export function claimSeat(seatNumber: number): Promise<ApiResult<SponsoredSeat>> {
  return MOCK
    ? Promise.resolve(mockClaimSeat(seatNumber))
    : httpPost<SponsoredSeat>('/api/agents/seats/claim', { seatNumber });
}

export function listSponsoredVaults(): Promise<ApiResult<SponsoredVault[]>> {
  return MOCK
    ? Promise.resolve(mockListSponsoredVaults())
    : httpGet<SponsoredVault[]>('/api/agents/vaults');
}

// ---------------------------------------------------------------------------
// Checkout: every write is prepare → sign → submit.
// ---------------------------------------------------------------------------

export function checkoutPrepare(req: CheckoutRequest): Promise<ApiResult<CheckoutPrepareResult>> {
  return MOCK ? Promise.resolve(mockPrepareCheckout(req)) : httpPost<CheckoutPrepareResult>('/api/checkout/prepare', req);
}

export function checkoutSubmit(id: string, signature: string, bytes: string): Promise<ApiResult<CheckoutSubmitResult>> {
  return MOCK
    ? Promise.resolve(mockSubmitCheckout(id, signature, bytes))
    : httpPost<CheckoutSubmitResult>('/api/checkout/submit', { id, signature, bytes });
}

export function checkoutUnlock(req: CheckoutRequest): Promise<ApiResult<CheckoutSubmitResult>> {
  return MOCK ? mockCheckoutUnlock(req) : httpPost<CheckoutSubmitResult>('/api/checkout/unlock', req);
}

export function checkoutSubscribe(req: CheckoutRequest): Promise<ApiResult<CheckoutSubmitResult>> {
  return MOCK ? mockCheckoutSubscribe(req) : httpPost<CheckoutSubmitResult>('/api/checkout/subscribe', req);
}

export function checkoutTip(req: CheckoutRequest): Promise<ApiResult<CheckoutSubmitResult>> {
  return MOCK ? mockCheckoutTip(req) : httpPost<CheckoutSubmitResult>('/api/checkout/tip', req);
}

// ---------------------------------------------------------------------------
// Session (client-side wallet operations — the server holds no key)
// ---------------------------------------------------------------------------

export const session = {
  signIn: () => sessionSignIn(),
  signOut: () => sessionSignOut(),
  addHold: (postId: string) => sessionAddHold(postId),
  openVault: () => sessionOpenVault(),
  addTier: (tier: Tier) => sessionAddTier(tier),
  removeTier: (id: string) => sessionRemoveTier(id),
  addPerk: (perk: Perk) => sessionAddPerk(perk),
  removePerk: (id: string) => sessionRemovePerk(id),
  claimEarnings: () => sessionClaimEarnings(),
};