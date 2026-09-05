// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { NextResponse } from 'next/server';
import { fold } from '@projectx-social/sdk';
import { rateLimit } from '@/lib/rate-limit';
import { findPost, findProfile, visiblePost } from '@/lib/content';
import { canRead, readEntitlements, sealApprover } from '@/lib/entitlement';
import { provenReaderFor } from '@/lib/read-session';

export const dynamic = 'force-dynamic';

/**
 * One post, as its reader may read it.
 *
 * # Anonymous: the public preview
 *
 * The plaintext of a PUBLIC post, and the title, preview and access of any post. For a gated post
 * `body` and `entitledVia` are `null` and the caller is told what it would take (`access`).
 *
 * # Entitled: the sealed reference, never the words
 *
 * A caller that proves a read session (the cookie a browser holds, or `Authorization: Bearer` as
 * the agent library sends) and whose address holds the entitlement on chain is handed `sealed`:
 * the Walrus blob id, the Seal-wrapped key, the nonce, the plaintext's SHA-256 and the approval
 * — which object the key servers will judge, with the reader as sender. This server never opens
 * a gated body: the key servers re-run the on-chain approval against the reader's own session and
 * release the key to the reader, not to us. `entitledVia` says which entitlement was found, and a
 * machine `Unlock` is handed the machine edition (`edition`), as `visiblePost` decides.
 *
 * Until 2026-09-02 no route handed an agent this reference, so a machine that had bought a post
 * could not read it by software; the demonstration's buyer proved exactly that gap.
 */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const limited = rateLimit(request, 'read');
  if (limited !== null) return limited;

  const { id } = await params;
  const post = await findPost(id);
  if (post === null) {
    return NextResponse.json({ error: 'no such post' }, { status: 404 });
  }

  const summary = {
    id: post.id,
    handle: post.authorHandle,
    title: post.title,
    preview: post.preview,
    access: post.access,
    createdAtMs: post.createdAtMs,
  };

  if (post.access.kind === 'public') {
    return NextResponse.json({ post: summary, body: post.body, entitledVia: 'public', sealed: null });
  }

  /*
    Whose entitlements to read — proved, never named. A failed session read is an anonymous
    reader; a failed entitlement read locks everything (never fail open — a node timeout must not
    release paid content).
  */
  const proven = await provenReaderFor(request);
  const reader = fold(proven, (value) => value, () => null);
  if (reader === null) {
    return NextResponse.json({ post: summary, body: null, entitledVia: null, sealed: null });
  }
  const entitlements = await readEntitlements(reader);
  if (!entitlements.ok) {
    return NextResponse.json(
      { post: summary, body: null, entitledVia: null, sealed: null, entitlementsUnavailable: entitlements.failure.detail },
      { status: 200 },
    );
  }
  const entitled = canRead(post, entitlements.value);
  const approver = sealApprover(post, entitlements.value);
  if (!entitled || approver === undefined) {
    return NextResponse.json({ post: summary, body: null, entitledVia: null, sealed: null });
  }

  const shown = visiblePost(post, true, approver);
  const ref = shown.sealedBody;
  if (ref === undefined) {
    // Entitled, but the words were never sealed under the key this reader holds (a machine Unlock
    // on a pre-034 post, or a legacy plaintext row): say which, hand over nothing that is not there.
    return NextResponse.json({
      post: summary,
      body: shown.body ?? null,
      entitledVia: approver.kind,
      sealed: null,
      ...(shown.edition === undefined ? {} : { edition: shown.edition }),
    });
  }
  const authorProfile = await findProfile(post.authorHandle);
  const approval =
    approver.kind === 'unlock'
      ? { kind: 'unlock' as const, vaultId: post.vaultId, contentKey: approver.contentKey, unlockId: approver.objectId }
      : {
          kind: 'subscription' as const,
          vaultId: post.vaultId,
          tier: approver.tier,
          period: approver.period,
          subscriptionId: approver.objectId,
          // v5: the approval names CreatorVault<T>. Sent when the profile records the coin; a reader
          // without it reads the vault's type on chain.
          ...(authorProfile?.coinType ? { coinType: authorProfile.coinType } : {}),
        };
  return NextResponse.json({
    post: summary,
    body: null,
    entitledVia: approver.kind,
    ...(shown.edition === undefined ? {} : { edition: shown.edition }),
    sealed: { blobId: ref.blobId, sealWrappedKey: ref.sealWrappedKey, nonce: ref.nonce, sha256: ref.sha256, approval },
  });
}
