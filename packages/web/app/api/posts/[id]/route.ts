// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>
import { NextResponse } from 'next/server';
import { fold } from '@projectx-social/sdk';
import { rateLimit } from '@/lib/rate-limit';
import { findPost, findProfile, visiblePost } from '@/lib/content';
import { canRead, readEntitlements, sealApprover } from '@/lib/entitlement';
import { provenReaderFor } from '@/lib/read-session';

export const dynamic = 'force-dynamic';

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
