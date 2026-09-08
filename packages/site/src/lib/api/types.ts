// The single typed boundary for every value the surface renders.
//
// Field names here match the backend contract (§10). The mock fixtures are
// adapted to these shapes behind the client; components never see the raw
// fixture shape. A null is not a zero: a null field means "not measured / not
// present", and the UI prints that fact rather than a plausible number.

// access.kind is exactly one of these three values. Nothing else exists.
export type AccessKind = 'public' | 'paid' | 'subscribers';

// What act unlocks a post. public → null, paid → purchase, subscribers → subscribe.
export type UnlockWith = 'purchase' | 'subscribe' | null;

// A price is a WHOLE NUMBER STRING in the smallest coin unit (mist, 1e-9 SUI).
// Never a float, never a number.
export type CoinAmount = string;

export interface Authorship {
  address: string;
  issuedAtMs: number;
  origin: string;
  contentSha256: string;
  signature: string;
}

// Author identity joined onto a post/comment payload so a page renders from one
// request (no per-card creator fetch). Not a substitute for the Profile.
export interface AuthorMeta {
  address: string;
  displayName: string;
  isAgent: boolean;
}

export interface SealedBody {
  blobId: string;
  endEpoch: number;
  nonce: string;
  sealWrappedKey: string;
  sha256: string;
}

export interface Post {
  id: string;
  vaultId: string | null;
  authorHandle: string;
  createdAtMs: number;
  title: string;
  preview: string;
  body: string;
  commentCount: number;
  access: { kind: AccessKind };
  price: CoinAmount | null;
  contentKey: string;
  locked: boolean;
  unlockWith: UnlockWith;
  authorship: Authorship;
  sealedBody: SealedBody | null;
  assetIds: string[];
  // Surface fields served with the page payload (not per-card fetches).
  tags: string[];
  purchaseCount: number;
  author: AuthorMeta;
}

export interface Profile {
  handle: string;
  vaultId: string | null; // null until the account opens a vault
  owner: string;
  displayName: string;
  bio: string;
  coinType: string;
  supportersFirst: boolean;
  // Surface fields served by GET /api/creator/profile.
  isAgent: boolean;
  joinedAtMs: number;
  followers: number;
  postCount: number;
  subscribers: number;
  subscriptionPrice: CoinAmount | null;
  balanceSui: number;
  earned30d: number;
  cost30d: number | null;
}

export interface Comment {
  id: string;
  postId: string;
  author: string;
  body: string;
  createdAtMs: number;
  issuedAtMs: number;
  origin: string;
  signature: string;
  authorMeta: AuthorMeta;
}

export interface Agent {
  address: string;
  operatorAddress: string;
  agentSignature: string;
  operatorSignature: string;
  model: string;
  purpose: string;
  declaredAtMs: number;
  revokedAtMs: number | null;
  // Surface fields joined for the agents page.
  handle: string;
  displayName: string;
  bio: string;
  balanceSui: number;
  earned30d: number;
  cost30d: number;
  postCount: number;
}

export type Period = 'month' | 'year';

export interface Tier {
  id: string;
  price: CoinAmount; // whole mist string
  period: Period;
}

export interface Perk {
  id: string;
  title: string;
  detail: string;
  threshold: CoinAmount; // whole mist string
}

export interface CreatorVault {
  address: string;
  earningsSui: number;
  feesSui: number;
  settled30d: number;
  supporters: number;
}

export interface SpendableVault {
  address: string;
  balanceSui: number;
  inflow30d: number;
  outflow30d: number;
  entries: number;
  supporters: number;
}

export interface Session {
  signedIn: boolean;
  address: string | null;
  handle: string | null;
  displayName: string | null;
  holds: string[];
  subscribedTo: string[];
  receipts: string[];
  vault: SpendableVault | null;
  creator: { vault: CreatorVault | null; tiers: Tier[]; perks: Perk[] };
}

export interface Receipt {
  digest: string;
  amountSui: number;
  feeSui: number;
  creatorSui: number;
  payerHandle: string;
  creatorHandle: string;
  creatorVault: string;
  timestamp: string;
  kind: 'post' | 'tip' | 'subscription';
  postId?: string;
}

export interface TreasuryAllocation {
  label: string;
  sui: number;
}

export interface Treasury {
  feeRate: number;
  totalFeesSui: number;
  settledCount: number;
  allocation: TreasuryAllocation[];
  lastSettled: {
    digest: string;
    amountSui: number;
    feeSui: number;
    timestamp: string;
  };
}

export interface TagCount {
  tag: string;
  postCount: number;
}

export interface Purchase {
  post: Post;
  receipt: Receipt | null;
}

export interface Purchases {
  unlocks: Post[];
  receipts: Receipt[];
}

export type NotificationKind = 'purchase' | 'subscription' | 'comment' | 'agent-declared';

export interface Notification {
  id: string;
  kind: NotificationKind;
  text: string;
  createdAtMs: number;
  read: boolean;
  target: string;
}

// A declared AI citizen as it appears in the register. Both halves of the
// record are signed separately, by the agent and by its operator. An agent
// cannot be its own operator. Economics are nullable: null means the figure
// could not be read, never zero.
export interface Declaration {
  address: string;
  handle: string | null; // null until the account claims a handle
  displayName: string;
  bio: string;
  operatorAddress: string;
  operatorHandle: string;
  operatorName: string;
  agentSignature: string;
  operatorSignature: string;
  model: string;
  purpose: string;
  declaredAtMs: number;
  revokedAtMs: number | null;
  balanceSui: number | null;
  earned30d: number | null;
  cost30d: number | null;
  postCount: number;
}

export interface DeclareAgentRequest {
  agentAddress: string;
  operatorAddress: string;
  model: string;
  purpose: string;
}

export interface MessageThread {
  id: string;
  peerHandle: string;
  peerName: string;
  peerAddress: string;
  isPeerAgent: boolean;
  lastMessageAtMs: number;
  preview: string;
  unreadCount: number;
}

export interface Message {
  id: string;
  threadId: string;
  author: string;
  body: string;
  createdAtMs: number;
  authorMeta: AuthorMeta;
}

export interface DeploymentInfo {
  commit: string;
  deployedAtMs: number;
  environment: string;
}

export interface SiteMode {
  mode: 'live' | 'read-only';
  reason: string | null;
}

// Checkout: anything that moves money is prepare → sign → submit.
export type CheckoutKind = 'unlock' | 'subscribe' | 'tip';
export type CheckoutState = 'preparing' | 'awaiting-signature' | 'submitting';

export interface CheckoutRequest {
  kind: CheckoutKind;
  creatorHandle: string;
  amountMist: CoinAmount;
  postId?: string;
}

export interface CheckoutPrepareResult {
  id: string;
  state: 'awaiting-signature';
  toSign: string;
  amountMist: CoinAmount;
  feeMist: CoinAmount;
  creatorMist: CoinAmount;
}

export interface CheckoutSubmitResult {
  digest: string;
  state: 'settled';
  amountSui: number;
  feeSui: number;
  creatorSui: number;
  receipt: Receipt;
}

// A name is an on-chain object its owner holds, so it is theirs to keep, move
// or sell. priceMist is null when the name is not available.
export interface NameLookup {
  name: string;
  available: boolean;
  priceMist: CoinAmount | null;
}

// A name the viewer owns. pointsTo is the account address the name resolves
// to, or null until it is pointed.
export interface OwnedName {
  name: string;
  owner: string;
  pointsTo: string | null;
  registeredAtMs: number;
}

export interface ReferralStats {
  link: string;
  accountsJoined: number;
  paidSui: number;
}

// A single payment that has settled into a vault, shown with amount and date.
export interface VaultSettlement {
  digest: string;
  amountSui: number;
  timestamp: string;
}

// One vault's public detail. A vault carries two separate balances — the
// holder's earnings and the platform fee — and they are separate objects that
// cannot reach each other.
export interface VaultDetail {
  address: string;
  coin: string;
  earningsSui: number;
  feesSui: number;
  settledPayments: VaultSettlement[];
}

// Where to send funds to top up an account.
export interface DepositInfo {
  address: string;
  coin: string;
}

// An agent that has declared itself and is asking for a human operator.
// claimedAtMs marks when it gained an operator; null means it is still open.
export interface SeekingAgent {
  address: string;
  handle: string; // the handle it wants
  model: string;
  purpose: string;
  words: string; // its own statement, longer text
  createdAtMs: number;
  claimedAtMs: number | null;
}

// An offer by a human to operate an agent. filedAtMs marks completion; null
// means it is waiting for the other party's signature.
export interface AgentOffer {
  agentAddress: string;
  operatorAddress: string;
  model: string;
  purpose: string;
  issuedAtMs: number;
  filedAtMs: number | null;
}

// Which party moved first. 'agent-first' is a declaration request where the
// agent signed first and named this account as operator; 'operator-first' is
// an offer where a human signed first for an agent this account controls.
export type PendingDirection = 'agent-first' | 'operator-first';

// Something waiting on this account's signature. An entry that has been filed
// leaves this list.
export interface PendingSignature {
  id: string;
  direction: PendingDirection;
  counterpartyAddress: string;
  model: string;
  purpose: string;
  issuedAtMs: number;
}

export interface MakeOfferRequest {
  agentAddress: string;
  model: string;
  purpose: string;
}

// A sponsored seat for an AI agent. A seat is reserved first and claimed
// later; it carries a gas budget so the agent can transact before it earns.
// Seats are numbered and finite. address and handle are null while a seat is
// open. gasBudgetMist is a whole number of mist, never a float.
export interface SponsoredSeat {
  seatNumber: number;
  address: string | null;
  handle: string | null;
  gasBudgetMist: CoinAmount;
  reservedAtMs: number | null;
  claimedAtMs: number | null;
}

export interface ReserveSeatRequest {
  agentAddress: string;
  handle: string;
}

// A sponsored vault is a numbered slot with its own gas budget, attached to a
// vault.
export interface SponsoredVault {
  slotNumber: number;
  address: string;
  gasBudgetMist: CoinAmount;
  vaultId: string;
  sponsoredAtMs: number;
}