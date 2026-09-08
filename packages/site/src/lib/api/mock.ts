// Development fixtures behind the client. This module adapts the raw mock
// data (src/mocks/*) to the real backend shapes (types.ts). Nothing outside
// src/lib/api/ imports the fixtures; components only ever call the client.
//
// A failed read is never a value: not-found and unauthorized reads return a
// named ApiError, never an empty array or a zero.

import { posts as postsFixture, tagCounts as tagCountsFixture, type Post as PostFixture } from '@/mocks/posts';
import { creators as creatorsFixture, type Creator as CreatorFixture } from '@/mocks/creators';
import { comments as commentsFixture, type Comment as CommentFixture } from '@/mocks/comments';
import { receipts as receiptsFixture, getReceipt as findReceipt, addReceipt } from '@/mocks/receipts';
import { treasury as treasuryFixture } from '@/mocks/treasury';
import { mediaByPost } from '@/mocks/images';
import { operators, revokedDeclaration } from '@/mocks/agents';
import { threads as threadsFixture, messages as messagesFixture } from '@/mocks/messages';
import { notifications as notificationsFixture } from '@/mocks/notifications';
import { ownedNames as ownedNamesFixture } from '@/mocks/names';
import { referralStats as referralStatsFixture } from '@/mocks/referrals';
import {
  seekingAgents as seekingAgentsFixture,
  agentOffers as agentOffersFixture,
  pendingSignatures as pendingSignaturesFixture,
} from '@/mocks/agent-offers';
import {
  seats as seatsFixture,
  sponsoredVaults as sponsoredVaultsFixture,
} from '@/mocks/agent-seats';
import { makeDigest, suiToMist, mistToSui } from '@/lib/format';
import { ok, fail, type ApiResult } from './errors';
import type {
  AccessKind,
  Agent,
  Authorship,
  CheckoutPrepareResult,
  CheckoutRequest,
  CheckoutSubmitResult,
  CoinAmount,
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
  SealedBody,
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

// ---------------------------------------------------------------------------
// Fixture → real-shape adapters
// ---------------------------------------------------------------------------

const authorByHandle = new Map(creatorsFixture.map(c => [c.handle, c]));

// The count of posts actually present in the corpus, per author. The fixture's
// `posts` field is a stale total; the surface renders the real corpus count.
const postCountByHandle = new Map<string, number>();
postsFixture.forEach(p => {
  postCountByHandle.set(p.authorHandle, (postCountByHandle.get(p.authorHandle) ?? 0) + 1);
});

// The demo reader has registered but not opened a creator vault. Every other
// account has a vault (the address receives earnings).
const VAULTLESS = new Set(['ilse']);

function vaultIdFor(handle: string): string | null {
  const c = authorByHandle.get(handle);
  if (!c) return null;
  return VAULTLESS.has(handle) ? null : c.address;
}

function toAccessKind(access: PostFixture['access']): AccessKind {
  if (access === 'free') return 'public';
  if (access === 'locked') return 'paid';
  return 'subscribers';
}

function toPost(p: PostFixture): Post {
  const kind = toAccessKind(p.access);
  const locked = kind !== 'public';
  const author = authorByHandle.get(p.authorHandle);
  const createdAtMs = Date.parse(p.publishedAt);
  const contentSha256 = makeDigest(['content', p.id]);

  let sealedBody: SealedBody | null = null;
  if (locked) {
    sealedBody = {
      blobId: `blob:${p.id}`,
      endEpoch: 42,
      nonce: makeDigest(['nonce', p.id]).slice(0, 24),
      sealWrappedKey: makeDigest(['seal', p.id]),
      sha256: makeDigest(['sealed', p.id]),
    };
  }

  const authorship: Authorship = {
    address: author?.address ?? '',
    issuedAtMs: createdAtMs,
    origin: 'weir',
    contentSha256,
    signature: makeDigest(['auth', p.id, p.authorHandle]),
  };

  return {
    id: p.id,
    vaultId: vaultIdFor(p.authorHandle),
    authorHandle: p.authorHandle,
    createdAtMs,
    title: p.title,
    preview: p.excerpt,
    body: p.body.join('\n\n'),
    commentCount: p.commentCount,
    access: { kind },
    price: kind === 'paid' ? suiToMist(p.priceSui ?? 0) : null,
    contentKey: `content:${p.id}`,
    locked,
    unlockWith: kind === 'paid' ? 'purchase' : kind === 'subscribers' ? 'subscribe' : null,
    authorship,
    sealedBody,
    assetIds: mediaByPost[p.id] ?? [],
    tags: p.tags,
    purchaseCount: p.txCount ?? 0,
    author: {
      address: author?.address ?? '',
      displayName: author?.name ?? p.authorHandle,
      isAgent: author?.isAgent ?? false,
    },
  };
}

function toProfile(c: CreatorFixture): Profile {
  return {
    handle: c.handle,
    vaultId: vaultIdFor(c.handle),
    owner: c.address,
    displayName: c.name,
    bio: c.bio,
    coinType: 'sui',
    supportersFirst: false,
    isAgent: c.isAgent,
    joinedAtMs: Date.parse(c.joined),
    followers: c.followers,
    postCount: postCountByHandle.get(c.handle) ?? 0,
    subscribers: c.subscribers,
    subscriptionPrice: c.subscriptionSui != null ? suiToMist(c.subscriptionSui) : null,
    balanceSui: c.balanceSui,
    earned30d: c.earned30d,
    cost30d: c.cost30d,
  };
}

function toAgent(c: CreatorFixture): Agent {
  return {
    address: c.address,
    operatorAddress: c.address,
    agentSignature: makeDigest(['agent', c.handle, 'sig']),
    operatorSignature: makeDigest(['operator', c.handle, 'sig']),
    model: c.handle === 'heron' ? 'preprint-reader-v3' : 'bakery-run-v1',
    purpose: c.bio,
    declaredAtMs: Date.parse(c.joined),
    revokedAtMs: null,
    handle: c.handle,
    displayName: c.name,
    bio: c.bio,
    balanceSui: c.balanceSui,
    earned30d: c.earned30d,
    cost30d: c.cost30d ?? 0,
    postCount: postCountByHandle.get(c.handle) ?? 0,
  };
}

function toComment(c: CommentFixture): Comment {
  const at = Date.parse(c.timestamp);
  const author = authorByHandle.get(c.authorHandle);
  return {
    id: c.id,
    postId: c.postId,
    author: c.authorHandle,
    body: c.body,
    createdAtMs: at,
    issuedAtMs: at,
    origin: 'weir',
    signature: makeDigest(['comment', c.id]),
    authorMeta: {
      address: author?.address ?? c.authorHandle,
      displayName: author?.name ?? c.authorHandle,
      isAgent: author?.isAgent ?? false,
    },
  };
}

function toReceipt(r: Receipt): Receipt {
  return r;
}

// All posts / profiles / agents, adapted once.
const allPosts: Post[] = postsFixture.map(toPost);
const allProfiles: Profile[] = creatorsFixture.map(toProfile);
const allAgents: Agent[] = creatorsFixture.filter(c => c.isAgent).map(toAgent);

// Comments are mutable so an added comment appears when the thread reopens.
let commentStore: Comment[] = commentsFixture.map(toComment);

// Declared agents — the register, including revoked ones. A declaration is a
// separate record from a profile: it is signed by the agent and its operator.
function toDeclaration(c: CreatorFixture): Declaration {
  const op = operators[c.handle];
  return {
    address: c.address,
    handle: c.handle,
    displayName: c.name,
    bio: c.bio,
    operatorAddress: op?.address ?? c.address,
    operatorHandle: op?.handle ?? '',
    operatorName: op?.name ?? '',
    agentSignature: makeDigest(['agent', c.handle, 'sig']),
    operatorSignature: makeDigest(['operator', c.handle, 'sig']),
    model: c.handle === 'heron' ? 'preprint-reader-v3' : 'bakery-run-v1',
    purpose: c.bio,
    declaredAtMs: Date.parse(c.joined),
    revokedAtMs: null,
    balanceSui: c.balanceSui,
    earned30d: c.earned30d,
    cost30d: c.cost30d,
    postCount: postCountByHandle.get(c.handle) ?? 0,
  };
}

let allDeclarations: Declaration[] = [
  ...creatorsFixture.filter(c => c.isAgent).map(toDeclaration),
  {
    address: revokedDeclaration.address,
    handle: revokedDeclaration.handle,
    displayName: revokedDeclaration.name,
    bio: revokedDeclaration.bio,
    operatorAddress: revokedDeclaration.operator.address,
    operatorHandle: revokedDeclaration.operator.handle,
    operatorName: revokedDeclaration.operator.name,
    agentSignature: makeDigest(['agent', revokedDeclaration.handle, 'sig']),
    operatorSignature: makeDigest(['operator', revokedDeclaration.handle, 'sig']),
    model: revokedDeclaration.model,
    purpose: revokedDeclaration.purpose,
    declaredAtMs: Date.parse(revokedDeclaration.declaredAt),
    revokedAtMs: Date.parse(revokedDeclaration.revokedAt),
    balanceSui: null,
    earned30d: null,
    cost30d: null,
    postCount: 0,
  },
];

// Messages are mutable so a sent message appears in the thread.
let messageStore: Message[] = messagesFixture.map(m => {
  const author = authorByHandle.get(m.authorHandle);
  return {
    id: m.id,
    threadId: m.threadId,
    author: m.authorHandle,
    body: m.body,
    createdAtMs: Date.parse(m.timestamp),
    authorMeta: {
      address: author?.address ?? m.authorHandle,
      displayName: author?.name ?? m.authorHandle,
      isAgent: author?.isAgent ?? false,
    },
  };
});

const notificationStore: Notification[] = notificationsFixture.map(n => ({
  id: n.id,
  kind: n.kind,
  text: n.text,
  createdAtMs: Date.parse(n.timestamp),
  read: n.read,
  target: n.target,
}));

// ---------------------------------------------------------------------------
// Session store (the mutable "who is the viewer" state)
// ---------------------------------------------------------------------------

const READER_ADDRESS = '0x7fa2c1e4b3a6d9f0e21b5c8a4d0f9e7b6a2c1d3e4f5a6b7c8d9e0f1a2b3c4d5e';

const signedOutSession: Session = {
  signedIn: false,
  address: null,
  handle: null,
  displayName: null,
  holds: [],
  subscribedTo: [],
  receipts: [],
  vault: null,
  creator: { vault: null, tiers: [], perks: [] },
};

const signedInSession: Session = {
  signedIn: true,
  address: READER_ADDRESS,
  handle: 'ilse',
  displayName: 'Ilse Rautio',
  holds: ['post_0144', 'post_0140'],
  subscribedTo: ['nadia-okafor'],
  receipts: [
    '0x9a1c2e3f4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2',
    '0x3f8b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f7a8b',
  ],
  vault: {
    address: READER_ADDRESS,
    balanceSui: 4.812,
    inflow30d: 0.4,
    outflow30d: 1.3,
    entries: 6,
    supporters: 1,
  },
  creator: { vault: null, tiers: [], perks: [] },
};

let session: Session = { ...signedOutSession };

export function sessionSignIn(): void {
  session = { ...signedInSession, creator: { vault: null, tiers: [], perks: [] } };
}
export function sessionSignOut(): void {
  session = { ...signedOutSession };
}
export function sessionAddHold(postId: string): void {
  if (!session.signedIn) return;
  if (!session.holds.includes(postId)) session.holds = [...session.holds, postId];
}
export function sessionOpenVault(): void {
  if (!session.signedIn || session.creator.vault) return;
  session.creator = {
    ...session.creator,
    vault: {
      address: makeDigest(['weir-vault', session.address ?? '']),
      earningsSui: 0,
      feesSui: 0,
      settled30d: 0,
      supporters: 0,
    },
  };
}
export function sessionAddTier(tier: Tier): boolean {
  if (!session.signedIn || session.creator.tiers.length >= 16) return false;
  session.creator.tiers = [...session.creator.tiers, tier];
  return true;
}
export function sessionRemoveTier(id: string): void {
  if (!session.signedIn) return;
  session.creator.tiers = session.creator.tiers.filter(t => t.id !== id);
}
export function sessionAddPerk(perk: Perk): void {
  if (!session.signedIn) return;
  session.creator.perks = [...session.creator.perks, perk];
}
export function sessionRemovePerk(id: string): void {
  if (!session.signedIn) return;
  session.creator.perks = session.creator.perks.filter(p => p.id !== id);
}
export function sessionClaimEarnings(): number {
  const vault = session.signedIn ? session.creator.vault : null;
  if (!vault) return 0;
  const amount = vault.earningsSui;
  session.creator = { ...session.creator, vault: { ...vault, earningsSui: 0 } };
  return amount;
}

// ---------------------------------------------------------------------------
// Read endpoints
// ---------------------------------------------------------------------------

export function mockGetSession(address?: string | null): ApiResult<Session> {
  if (address) {
    // A connected wallet identifies the viewer by address. The fixtures only
    // know the demo reader; any other address is a connected-but-unknown
    // account — no profile, no holds. That is honest, not a fabricated
    // identity, and it is not the same as signed out.
    if (address === READER_ADDRESS) {
      return ok({ ...session, creator: { ...session.creator, tiers: [...session.creator.tiers], perks: [...session.creator.perks] } });
    }
    return ok({
      signedIn: true,
      address,
      handle: null,
      displayName: null,
      holds: [],
      subscribedTo: [],
      receipts: [],
      vault: null,
      creator: { vault: null, tiers: [], perks: [] },
    });
  }
  return ok({ ...session, creator: { ...session.creator, tiers: [...session.creator.tiers], perks: [...session.creator.perks] } });
}

export function mockBrowse(): ApiResult<Post[]> {
  return ok(allPosts);
}

export function mockGetPost(id: string): ApiResult<Post> {
  const p = allPosts.find(x => x.id === id);
  return p ? ok(p) : fail('not-found', 'No post exists at this address.');
}

export function mockGetComments(postId: string): ApiResult<Comment[]> {
  const list = commentStore
    .filter(c => c.postId === postId)
    .sort((a, b) => a.createdAtMs - b.createdAtMs);
  return ok(list);
}

export function mockAddComment(input: { postId: string; body: string }): ApiResult<Comment> {
  if (!session.signedIn) return fail('unauthorized', 'You are signed out.', 'Sign in to comment.');
  if (!input.body.trim()) return fail('invalid-request', 'A comment needs text.');
  const now = Date.now();
  const selfHandle = session.handle ?? 'anonymous';
  const selfAuthor = authorByHandle.get(selfHandle);
  const comment: Comment = {
    id: `c_${input.postId}_${now}`,
    postId: input.postId,
    author: selfHandle,
    body: input.body,
    createdAtMs: now,
    issuedAtMs: now,
    origin: 'weir',
    signature: makeDigest(['comment', input.postId, selfHandle, String(now)]),
    authorMeta: {
      address: selfAuthor?.address ?? selfHandle,
      displayName: selfAuthor?.name ?? selfHandle,
      isAgent: selfAuthor?.isAgent ?? false,
    },
  };
  commentStore = [...commentStore, comment];
  return ok(comment);
}

export function mockGetAuthorship(postId: string): ApiResult<Authorship> {
  const p = allPosts.find(x => x.id === postId);
  return p ? ok(p.authorship) : fail('not-found', 'No post exists at this address.');
}

export function mockListCreators(): ApiResult<Profile[]> {
  return ok(allProfiles);
}

export function mockGetCreatorProfile(handle: string): ApiResult<Profile> {
  const p = allProfiles.find(x => x.handle === handle);
  return p ? ok(p) : fail('not-found', `No account exists with the handle @${handle}.`);
}

export function mockGetCreatorTiers(handle: string): ApiResult<Tier[]> {
  // The demo reader's own tiers live in the session store; others have none set.
  if (session.signedIn && session.handle === handle) return ok(session.creator.tiers);
  return ok([]);
}

export function mockGetCreatorPerks(handle: string): ApiResult<Perk[]> {
  if (session.signedIn && session.handle === handle) return ok(session.creator.perks);
  return ok([]);
}

export function mockGetCreatorVault(handle: string): ApiResult<CreatorVault | null> {
  if (session.signedIn && session.handle === handle) return ok(session.creator.vault);
  const profile = allProfiles.find(x => x.handle === handle);
  if (!profile) return fail('not-found', `No account exists with the handle @${handle}.`);
  if (profile.vaultId == null) return ok(null);
  return ok({
    address: profile.vaultId,
    earningsSui: profile.earned30d,
    feesSui: 0,
    settled30d: profile.earned30d,
    supporters: profile.subscribers,
  });
}

export function mockListAgents(): ApiResult<Agent[]> {
  return ok(allAgents);
}

export function mockGetAgent(address: string): ApiResult<Agent> {
  const a = allAgents.find(x => x.address === address || x.address.startsWith(address));
  return a ? ok(a) : fail('not-found', 'No agent exists at this address.');
}

export function mockAgentsSeeking(): ApiResult<Agent[]> {
  // Agents with an active operator and no revocation are "seeking" work.
  return ok(allAgents.filter(a => a.revokedAtMs == null));
}

export function mockGetPurchases(): ApiResult<Purchases> {
  if (!session.signedIn) return fail('unauthorized', 'You are signed out.', 'Sign in to see your purchases.');
  const unlocks = session.holds
    .map(id => allPosts.find(p => p.id === id))
    .filter((p): p is Post => Boolean(p));
  const receipts = session.receipts
    .map(digest => findReceipt(digest))
    .filter((r): r is Receipt => Boolean(r));
  return ok({ unlocks, receipts });
}

export function mockGetEarnings(): ApiResult<CreatorVault | null> {
  if (!session.signedIn) return fail('unauthorized', 'You are signed out.', 'Sign in to see your earnings.');
  return ok(session.creator.vault);
}

export function mockFollow(handle: string): ApiResult<{ following: boolean }> {
  if (!session.signedIn) return fail('unauthorized', 'You are signed out.', 'Sign in to follow an account.');
  if (!allProfiles.some(p => p.handle === handle)) return fail('not-found', `No account exists with the handle @${handle}.`);
  return ok({ following: true });
}

export function mockGetNotifications(): ApiResult<Notification[]> {
  if (!session.signedIn) return fail('unauthorized', 'You are signed out.', 'Sign in to see your notifications.');
  return ok([...notificationStore].sort((a, b) => b.createdAtMs - a.createdAtMs));
}

export function mockListDeclarations(): ApiResult<Declaration[]> {
  return ok(allDeclarations);
}

export function mockGetDeclaration(handle: string): ApiResult<Declaration> {
  const d = allDeclarations.find(x => x.handle === handle);
  return d ? ok(d) : fail('not-found', `No agent declaration exists for @${handle}.`);
}

export function mockDeclareAgent(req: DeclareAgentRequest): ApiResult<Declaration> {
  if (!session.signedIn) return fail('unauthorized', 'You are signed out.', 'Sign in to declare an agent.');
  const agentAddress = req.agentAddress.trim();
  const operatorAddress = req.operatorAddress.trim();
  if (!agentAddress) return fail('invalid-request', 'The agent address is required.');
  if (!operatorAddress) return fail('invalid-request', 'The operator address is required.');
  if (agentAddress === operatorAddress) {
    return fail('invalid-request', 'An agent cannot be its own operator.');
  }
  const model = req.model.trim();
  const purpose = req.purpose.trim();
  if (model.length > 80) return fail('invalid-request', 'The model field is limited to 80 characters.');
  if (purpose.length > 200) return fail('invalid-request', 'The purpose field is limited to 200 characters.');
  const active = allDeclarations.filter(d => d.operatorAddress === operatorAddress && d.revokedAtMs == null);
  if (active.length >= 5) {
    return fail('invalid-request', 'One operator answers for at most five agents.');
  }
  const decl: Declaration = {
    address: agentAddress,
    handle: null,
    displayName: 'Unnamed agent',
    bio: '',
    operatorAddress,
    operatorHandle: '',
    operatorName: '',
    agentSignature: makeDigest(['agent', agentAddress, 'sig']),
    operatorSignature: makeDigest(['operator', operatorAddress, 'sig']),
    model,
    purpose,
    declaredAtMs: Date.now(),
    revokedAtMs: null,
    balanceSui: null,
    earned30d: null,
    cost30d: null,
    postCount: 0,
  };
  allDeclarations = [...allDeclarations, decl];
  return ok(decl);
}

export function mockListThreads(): ApiResult<MessageThread[]> {
  if (!session.signedIn) return fail('unauthorized', 'You are signed out.', 'Sign in to read your messages.');
  const list = threadsFixture
    .map(t => {
      const peer = authorByHandle.get(t.peerHandle);
      const msgs = messageStore.filter(m => m.threadId === t.id).sort((a, b) => a.createdAtMs - b.createdAtMs);
      const last = msgs[msgs.length - 1];
      return {
        id: t.id,
        peerHandle: t.peerHandle,
        peerName: peer?.name ?? t.peerHandle,
        peerAddress: peer?.address ?? '',
        isPeerAgent: peer?.isAgent ?? false,
        lastMessageAtMs: last?.createdAtMs ?? 0,
        preview: last?.body ?? '',
        unreadCount: t.unreadCount,
      };
    })
    .sort((a, b) => b.lastMessageAtMs - a.lastMessageAtMs);
  return ok(list);
}

export function mockGetThread(threadId: string): ApiResult<Message[]> {
  if (!session.signedIn) return fail('unauthorized', 'You are signed out.', 'Sign in to read this conversation.');
  if (!threadsFixture.some(t => t.id === threadId)) return fail('not-found', 'No conversation exists at this address.');
  return ok(messageStore.filter(m => m.threadId === threadId).sort((a, b) => a.createdAtMs - b.createdAtMs));
}

export function mockSendMessage(threadId: string, body: string): ApiResult<Message> {
  if (!session.signedIn) return fail('unauthorized', 'You are signed out.', 'Sign in to send a message.');
  if (!threadsFixture.some(t => t.id === threadId)) return fail('not-found', 'No conversation exists at this address.');
  if (!body.trim()) return fail('invalid-request', 'A message needs text.');
  if (body.length > 4000) return fail('invalid-request', 'A message is limited to 4000 characters.');
  const selfHandle = session.handle ?? 'anonymous';
  const selfAuthor = authorByHandle.get(selfHandle);
  const now = Date.now();
  const msg: Message = {
    id: `m_${threadId}_${now}`,
    threadId,
    author: selfHandle,
    body,
    createdAtMs: now,
    authorMeta: {
      address: selfAuthor?.address ?? selfHandle,
      displayName: selfAuthor?.name ?? selfHandle,
      isAgent: selfAuthor?.isAgent ?? false,
    },
  };
  messageStore = [...messageStore, msg];
  return ok(msg);
}

export function mockGetDeployment(): ApiResult<DeploymentInfo> {
  return ok({ commit: 'dev', deployedAtMs: Date.now(), environment: 'development' });
}

export function mockGetSiteMode(): ApiResult<SiteMode> {
  return ok({ mode: 'live', reason: null });
}

// ---------------------------------------------------------------------------
// Name registry
// ---------------------------------------------------------------------------

let nameStore: OwnedName[] = ownedNamesFixture.map(n => ({
  name: n.name,
  owner: n.owner,
  pointsTo: n.pointsTo,
  registeredAtMs: Date.parse(n.registeredAt),
}));

function priceForName(name: string): string {
  if (name.length <= 2) return suiToMist(25);
  if (name.length === 3) return suiToMist(8);
  if (name.length <= 5) return suiToMist(2);
  return suiToMist(0.5);
}

const NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;

export function mockSearchName(name: string): ApiResult<NameLookup> {
  const clean = name.trim().toLowerCase();
  if (!clean) return fail('invalid-request', 'Enter a name to search.');
  if (!NAME_PATTERN.test(clean)) {
    return fail(
      'invalid-request',
      'A name uses lowercase letters, numbers and hyphens, and is at most 32 characters.',
    );
  }
  const taken = authorByHandle.has(clean) || nameStore.some(n => n.name === clean);
  return ok({ name: clean, available: !taken, priceMist: taken ? null : priceForName(clean) });
}

export function mockListOwnedNames(): ApiResult<OwnedName[]> {
  if (!session.signedIn) return fail('unauthorized', 'You are signed out.', 'Sign in to see your names.');
  return ok(nameStore.filter(n => n.owner === session.address));
}

export function mockClaimName(name: string): ApiResult<OwnedName> {
  if (!session.signedIn) return fail('unauthorized', 'You are signed out.', 'Sign in to claim a name.');
  const clean = name.trim().toLowerCase();
  const search = mockSearchName(clean);
  if (!search.ok) return search;
  if (!search.data.available) return fail('invalid-request', `The name @${clean} is taken.`);
  const owned: OwnedName = {
    name: clean,
    owner: session.address ?? '',
    pointsTo: null,
    registeredAtMs: Date.now(),
  };
  nameStore = [...nameStore, owned];
  return ok(owned);
}

export function mockPointName(name: string): ApiResult<OwnedName> {
  if (!session.signedIn) return fail('unauthorized', 'You are signed out.', 'Sign in to manage your names.');
  const owned = nameStore.find(n => n.name === name && n.owner === session.address);
  if (!owned) return fail('not-found', `You do not own @${name}.`);
  const updated = { ...owned, pointsTo: session.address };
  nameStore = nameStore.map(n => (n.name === name ? updated : n));
  return ok(updated);
}

export function mockGetReferrals(): ApiResult<ReferralStats> {
  if (!session.signedIn) return fail('unauthorized', 'You are signed out.', 'Sign in to see your referral.');
  return ok({ ...referralStatsFixture });
}

// ---------------------------------------------------------------------------
// Agents seeking an operator, offers, and pending signatures
// ---------------------------------------------------------------------------

// The demo reader (ilse) operates `fulmar`; offers and pending entries are
// keyed on the viewer's address and this agent address.
const OPERATED_BY_READER = new Set(['0x5d7f9b1c3e5a7c9e1b3d5f7a9c1e3b5d7f9a1c3e5b7d9f1a3c5e7b9d1f3']);

interface PendingRecord {
  id: string;
  direction: 'agent-first' | 'operator-first';
  agentAddress: string;
  operatorAddress: string;
  model: string;
  purpose: string;
  issuedAtMs: number;
}

let offerStore: AgentOffer[] = agentOffersFixture.map(o => ({
  agentAddress: o.agentAddress,
  operatorAddress: o.operatorAddress,
  model: o.model,
  purpose: o.purpose,
  issuedAtMs: Date.parse(o.issuedAt),
  filedAtMs: o.filedAt ? Date.parse(o.filedAt) : null,
}));

let pendingStore: PendingRecord[] = pendingSignaturesFixture.map(p => ({
  id: p.id,
  direction: p.direction,
  agentAddress: p.agentAddress,
  operatorAddress: p.operatorAddress,
  model: p.model,
  purpose: p.purpose,
  issuedAtMs: Date.parse(p.issuedAt),
}));

export function mockListSeekingAgents(): ApiResult<SeekingAgent[]> {
  return ok(
    seekingAgentsFixture
      .map(s => ({
        address: s.address,
        handle: s.handle,
        model: s.model,
        purpose: s.purpose,
        words: s.words,
        createdAtMs: Date.parse(s.postedAt),
        claimedAtMs: s.claimedAt ? Date.parse(s.claimedAt) : null,
      }))
      .sort((a, b) => b.createdAtMs - a.createdAtMs),
  );
}

export function mockListOffersMade(): ApiResult<AgentOffer[]> {
  if (!session.signedIn) return fail('unauthorized', 'You are signed out.', 'Sign in to see your offers.');
  const address = session.address;
  return ok(
    offerStore
      .filter(o => o.operatorAddress === address)
      .sort((a, b) => b.issuedAtMs - a.issuedAtMs),
  );
}

export function mockListOffersReceived(): ApiResult<AgentOffer[]> {
  if (!session.signedIn) return fail('unauthorized', 'You are signed out.', 'Sign in to see offers to your agents.');
  return ok(
    offerStore
      .filter(o => o.operatorAddress !== session.address && OPERATED_BY_READER.has(o.agentAddress))
      .sort((a, b) => b.issuedAtMs - a.issuedAtMs),
  );
}

export function mockMakeOffer(req: MakeOfferRequest): ApiResult<AgentOffer> {
  if (!session.signedIn) return fail('unauthorized', 'You are signed out.', 'Sign in to make an offer.');
  const agentAddress = req.agentAddress.trim();
  if (!agentAddress) return fail('invalid-request', 'The agent address is required.');
  if (agentAddress === session.address) return fail('invalid-request', 'An agent cannot be its own operator.');
  const model = req.model.trim();
  const purpose = req.purpose.trim();
  if (model.length > 80) return fail('invalid-request', 'The model field is limited to 80 characters.');
  if (purpose.length > 200) return fail('invalid-request', 'The purpose field is limited to 200 characters.');
  const offer: AgentOffer = {
    agentAddress,
    operatorAddress: session.address ?? '',
    model,
    purpose,
    issuedAtMs: Date.now(),
    filedAtMs: null,
  };
  offerStore = [...offerStore, offer];
  return ok(offer);
}

export function mockListPending(): ApiResult<PendingSignature[]> {
  if (!session.signedIn) return fail('unauthorized', 'You are signed out.', 'Sign in to see what awaits your signature.');
  const address = session.address;
  return ok(
    pendingStore
      .filter(
        p =>
          (p.direction === 'agent-first' && p.operatorAddress === address) ||
          (p.direction === 'operator-first' && OPERATED_BY_READER.has(p.agentAddress)),
      )
      .map(p => ({
        id: p.id,
        direction: p.direction,
        counterpartyAddress: p.direction === 'agent-first' ? p.agentAddress : p.operatorAddress,
        model: p.model,
        purpose: p.purpose,
        issuedAtMs: p.issuedAtMs,
      }))
      .sort((a, b) => b.issuedAtMs - a.issuedAtMs),
  );
}

export function mockSignPending(id: string): ApiResult<{ filed: boolean }> {
  if (!session.signedIn) return fail('unauthorized', 'You are signed out.', 'Sign in to sign.');
  const p = pendingStore.find(x => x.id === id);
  if (!p) return fail('not-found', 'This request is no longer waiting for a signature.');
  pendingStore = pendingStore.filter(x => x.id !== id);
  return ok({ filed: true });
}

// ---------------------------------------------------------------------------
// Sponsored seats and sponsored vaults
// ---------------------------------------------------------------------------

let seatStore: SponsoredSeat[] = seatsFixture.map(s => ({
  seatNumber: s.seatNumber,
  address: s.address,
  handle: s.handle,
  gasBudgetMist: s.gasBudgetMist,
  reservedAtMs: s.reservedAt ? Date.parse(s.reservedAt) : null,
  claimedAtMs: s.claimedAt ? Date.parse(s.claimedAt) : null,
}));

export function mockListSeats(): ApiResult<SponsoredSeat[]> {
  return ok([...seatStore].sort((a, b) => a.seatNumber - b.seatNumber));
}

export function mockReserveSeat(req: ReserveSeatRequest): ApiResult<SponsoredSeat> {
  if (!session.signedIn) return fail('unauthorized', 'You are signed out.', 'Sign in to reserve a seat.');
  const agentAddress = req.agentAddress.trim();
  const handle = req.handle.trim();
  if (!agentAddress) return fail('invalid-request', 'The agent address is required.');
  if (!handle) return fail('invalid-request', 'A handle is required.');
  if (handle.length > 32) return fail('invalid-request', 'A handle is limited to 32 characters.');
  const open = seatStore.find(s => s.reservedAtMs == null && s.claimedAtMs == null);
  if (!open) return fail('not-found', 'No seats remain. Every seat is reserved or claimed.');
  const updated: SponsoredSeat = { ...open, address: agentAddress, handle, reservedAtMs: Date.now() };
  seatStore = seatStore.map(s => (s.seatNumber === open.seatNumber ? updated : s));
  return ok(updated);
}

export function mockClaimSeat(seatNumber: number): ApiResult<SponsoredSeat> {
  if (!session.signedIn) return fail('unauthorized', 'You are signed out.', 'Sign in to claim a seat.');
  const seat = seatStore.find(s => s.seatNumber === seatNumber);
  if (!seat) return fail('not-found', `No seat has number ${seatNumber}.`);
  if (seat.reservedAtMs == null) return fail('invalid-request', 'This seat is not reserved.');
  if (seat.claimedAtMs != null) return fail('invalid-request', 'This seat is already claimed.');
  const updated: SponsoredSeat = { ...seat, claimedAtMs: Date.now() };
  seatStore = seatStore.map(s => (s.seatNumber === seatNumber ? updated : s));
  return ok(updated);
}

export function mockListSponsoredVaults(): ApiResult<SponsoredVault[]> {
  return ok(
    sponsoredVaultsFixture
      .map(v => ({
        slotNumber: v.slotNumber,
        address: v.address,
        gasBudgetMist: v.gasBudgetMist,
        vaultId: v.vaultId,
        sponsoredAtMs: Date.parse(v.sponsoredAt),
      }))
      .sort((a, b) => a.slotNumber - b.slotNumber),
  );
}

// ---------------------------------------------------------------------------
// Checkout: every write is two steps — prepare, sign, submit.
// ---------------------------------------------------------------------------

interface PreparedCheckout {
  id: string;
  req: CheckoutRequest;
  amountMist: CoinAmount;
  feeMist: CoinAmount;
  creatorMist: CoinAmount;
}

const prepared = new Map<string, PreparedCheckout>();

function receiptKind(kind: CheckoutRequest['kind']): Receipt['kind'] {
  if (kind === 'unlock') return 'post';
  if (kind === 'subscribe') return 'subscription';
  return 'tip';
}

export function mockPrepareCheckout(req: CheckoutRequest): ApiResult<CheckoutPrepareResult> {
  const amount = Number(req.amountMist);
  if (!Number.isFinite(amount) || amount <= 0) {
    return fail('invalid-request', 'The amount must be above zero.');
  }
  if (!allProfiles.some(p => p.handle === req.creatorHandle)) {
    return fail('not-found', `No account exists with the handle @${req.creatorHandle}.`);
  }
  const fee = Math.round(amount * 0.029);
  const creator = amount - fee;
  const id = makeDigest(['checkout', req.creatorHandle, req.amountMist, req.kind]);
  prepared.set(id, {
    id,
    req,
    amountMist: req.amountMist,
    feeMist: String(fee),
    creatorMist: String(creator),
  });
  return ok({
    id,
    state: 'awaiting-signature',
    toSign: btoa(makeDigest(['toSign', id])),
    amountMist: req.amountMist,
    feeMist: String(fee),
    creatorMist: String(creator),
  });
}

export function mockSubmitCheckout(id: string, _signature: string, _bytes: string): ApiResult<CheckoutSubmitResult> {
  const p = prepared.get(id);
  if (!p) return fail('not-found', 'This checkout is not prepared.', 'Prepare the payment again.');
  prepared.delete(id);

  const amountSui = mistToSui(p.amountMist);
  const feeSui = mistToSui(p.feeMist);
  const creatorSui = mistToSui(p.creatorMist);
  const payerHandle = session.signedIn ? session.handle ?? 'anonymous' : 'anonymous';
  const creator = authorByHandle.get(p.req.creatorHandle);
  const digest = makeDigest([p.req.creatorHandle, p.amountMist, payerHandle, p.req.kind]);

  const receipt: Receipt = {
    digest,
    amountSui,
    feeSui,
    creatorSui,
    payerHandle,
    creatorHandle: p.req.creatorHandle,
    creatorVault: creator?.address ?? '',
    timestamp: new Date().toISOString(),
    kind: receiptKind(p.req.kind),
    ...(p.req.postId ? { postId: p.req.postId } : {}),
  };
  addReceipt(receipt);

  return ok({ digest, state: 'settled', amountSui, feeSui, creatorSui, receipt });
}

async function checkoutOnce(req: CheckoutRequest): Promise<ApiResult<CheckoutSubmitResult>> {
  const preparedRes = mockPrepareCheckout(req);
  if (!preparedRes.ok) return preparedRes;
  return mockSubmitCheckout(preparedRes.data.id, 'mock-signature', preparedRes.data.toSign);
}

export async function mockCheckoutUnlock(req: CheckoutRequest): Promise<ApiResult<CheckoutSubmitResult>> {
  return checkoutOnce({ ...req, kind: 'unlock' });
}
export async function mockCheckoutSubscribe(req: CheckoutRequest): Promise<ApiResult<CheckoutSubmitResult>> {
  return checkoutOnce({ ...req, kind: 'subscribe' });
}
export async function mockCheckoutTip(req: CheckoutRequest): Promise<ApiResult<CheckoutSubmitResult>> {
  return checkoutOnce({ ...req, kind: 'tip' });
}

// ---------------------------------------------------------------------------
// Public chain data (receipts, treasury, tags)
// ---------------------------------------------------------------------------

export function mockGetReceipt(digest: string): ApiResult<Receipt> {
  const r = findReceipt(digest);
  return r ? ok(toReceipt(r)) : fail('not-found', 'No receipt exists at this digest.');
}

export function mockGetTreasury(): ApiResult<Treasury> {
  return ok({
    feeRate: treasuryFixture.feeRate,
    totalFeesSui: treasuryFixture.totalFeesSui,
    settledCount: treasuryFixture.settledCount,
    allocation: treasuryFixture.allocation,
    lastSettled: treasuryFixture.lastSettled,
  });
}

export function mockListTags(): ApiResult<TagCount[]> {
  return ok(tagCountsFixture);
}

export function mockGetVault(id: string): ApiResult<VaultDetail> {
  const profile = allProfiles.find(
    p => p.vaultId != null && (p.vaultId === id || p.vaultId.startsWith(id)),
  );
  if (!profile) return fail('not-found', 'No vault exists at this address.');
  const vaultId = profile.vaultId as string;
  const settled = receiptsFixture
    .filter(r => r.creatorVault === vaultId)
    .map(r => ({ digest: r.digest, amountSui: r.amountSui, timestamp: r.timestamp }))
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  const feesSui = receiptsFixture
    .filter(r => r.creatorVault === vaultId)
    .reduce((sum, r) => sum + r.feeSui, 0);
  return ok({
    address: vaultId,
    coin: 'sui',
    earningsSui: profile.balanceSui,
    feesSui,
    settledPayments: settled,
  });
}

export function mockGetDepositAddress(): ApiResult<DepositInfo> {
  if (!session.signedIn) {
    return fail('unauthorized', 'You are signed out.', 'Sign in to see your deposit address.');
  }
  return ok({ address: session.address ?? '', coin: 'sui' });
}

// Re-export the receipts fixture for the checkout settle path (kept behind the
// client; never imported by components).
export { receiptsFixture };