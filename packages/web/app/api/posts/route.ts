// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { createHash } from 'node:crypto';
import { newId } from '@/lib/ids';
import { NextResponse } from 'next/server';
import { quotaLimit, rateLimit } from '@/lib/rate-limit';
import { createClient, periodOf, readContentPrice, readCreatorVault } from '@projectx-social/sdk';
import {
  addPost,
  findProfile,
  MAX_POST_BODY_LENGTH,
  MAX_POST_PREVIEW_LENGTH,
  MAX_POST_TITLE_LENGTH,
  type PostAccess,
} from '@/lib/content';
import { siteConfig } from '@/lib/chain';
import { storeBody, type SealedBody } from '@/lib/body-storage';
import { sealBothEditions } from '@/lib/machine-pricing';
import { spendSignature, sweepUsedSignatures, verifyActionDeferringSpend } from '@/lib/identity';
import { refuseWithdrawnDeclaration } from '@/lib/agent-standing';
import { idempotently } from '@/lib/idempotent-route';
import { accessStatement } from '@projectx-social/sdk';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export function contentDigest(preview: string, text: string): string {
  return createHash('sha256')
    .update(`${preview.length}:${preview}${text.length}:${text}`)
    .digest('hex');
}

export async function POST(request: Request): Promise<Response> {
  return idempotently(
    request,
    '/api/posts',
    (body) => (typeof (body as { author?: unknown })?.author === 'string' ? (body as { author: string }).author : null),
    publishOnce,
  );
}

async function publishOnce(request: Request) {
  const limited = rateLimit(request, 'write');
  if (limited !== null) return limited;

  const body = (await request.json()) as {
    handle?: string;
    author?: string;
    title?: string;
    preview?: string;
    text?: string;
    access?: string;
    tier?: string | number;
    price?: string;
    contentKey?: string;
    signature?: string;
    timestampMs?: number;
  };

  const { handle, author, title, preview, text, access, signature, timestampMs } = body;
  if (!handle || !author || !title || !preview || !text || !access) {
    return NextResponse.json(
      { error: 'handle, author, title, preview, text and access are required' },
      { status: 400 },
    );
  }

  const tooLong =
    title.length > MAX_POST_TITLE_LENGTH
      ? `title exceeds ${MAX_POST_TITLE_LENGTH} characters`
      : preview.length > MAX_POST_PREVIEW_LENGTH
        ? `preview exceeds ${MAX_POST_PREVIEW_LENGTH} characters`
        : text.length > MAX_POST_BODY_LENGTH
          ? `body exceeds ${MAX_POST_BODY_LENGTH} characters`
          : null;
  if (tooLong !== null) return NextResponse.json({ error: tooLong }, { status: 400 });

  if (access === 'paid' && body.contentKey !== undefined && body.contentKey !== body.contentKey.trim()) {
    return NextResponse.json(
      { error: 'a paid contentKey must carry no leading or trailing whitespace' },
      { status: 400 },
    );
  }

  const profile = await findProfile(handle);
  if (profile === null) {
    return NextResponse.json(
      {
        error:
          'no such creator: no named vault is linked to this handle. Name the vault once with ' +
          'POST /api/creator/profile (a signed name-vault statement), then publish.',
      },
      { status: 404 },
    );
  }

  const config = siteConfig();
  if (!config.ok) {
    return NextResponse.json({ error: config.failure.detail }, { status: 503 });
  }

  if (profile.vaultId === null) {
    return NextResponse.json(
      { error: 'this profile has no vault yet, so there is nothing to publish under' },
      { status: 409 },
    );
  }

  const vault = await readCreatorVault(createClient(config.value), profile.vaultId);
  if (!vault.ok) {
    return NextResponse.json(
      { error: `could not read the vault: ${vault.failure.detail}` },
      { status: 503 },
    );
  }

  if (author.toLowerCase() !== vault.value.owner.toLowerCase()) {
    return NextResponse.json(
      { error: 'only the vault owner may publish to this profile' },
      { status: 403 },
    );
  }

  const requestedTier = access === 'subscribers' && body.tier !== undefined ? Number(body.tier) : 0;
  if (!Number.isInteger(requestedTier) || requestedTier < 0 || requestedTier > 9_999) {
    return NextResponse.json({ error: `tier must be a small non-negative integer; received ${JSON.stringify(body.tier)}` }, { status: 400 });
  }

  const origin = new URL(request.url).origin;
  const contentSha256 = contentDigest(preview, text);

  const proof = await verifyActionDeferringSpend({
    origin,
    address: author,
    signature: signature ?? '',
    timestampMs: timestampMs ?? 0,
    action: {
      kind: 'publish',
      handle,
      title,
      access: accessStatement(access as 'public' | 'paid' | 'subscribers', requestedTier),
      contentSha256,
      contentKey: body.contentKey ?? '',
      price: body.price ?? '',
    },
  });
  if (!proof.ok) {
    return NextResponse.json({ error: proof.failure.detail }, { status: 401 });
  }

  const overQuota = await quotaLimit(author, 'publish');
  if (overQuota !== null) return overQuota;

  const withdrawn = await refuseWithdrawnDeclaration(author);
  if (withdrawn !== null) return withdrawn;

  let postAccess: PostAccess;
  if (access === 'public') {
    postAccess = { kind: 'public' };
  } else if (access === 'subscribers') {
    const rawTier = requestedTier;
    if (rawTier >= vault.value.tiers.length) {
      return NextResponse.json(
        { error: `tier must be an index into this vault's ${vault.value.tiers.length} tier(s); received ${JSON.stringify(body.tier)}` },
        { status: 400 },
      );
    }
    if (!vault.value.tiers[rawTier]!.active) {
      return NextResponse.json({ error: `tier ${rawTier} is retired; a post sealed to it could never be renewed into` }, { status: 400 });
    }
    postAccess = { kind: 'subscribers', tier: rawTier };
  } else if (access === 'paid') {
    if (!body.contentKey || !body.price) {
      return NextResponse.json(
        { error: 'a paid post needs a contentKey and a price' },
        { status: 400 },
      );
    }

    const priced = await readContentPrice(
      createClient(config.value),
      vault.value.contentPricesTableId,
      body.contentKey,
    );

    if (!priced.ok) {
      return NextResponse.json(
        { error: `could not read the price for this content: ${priced.failure.detail}`,
          kind: priced.failure.kind },
        { status: 503 },
      );
    }

    if (priced.value === null) {
      return NextResponse.json(
        { error:
            `"${body.contentKey}" has no price on this vault, so nothing could buy it. ` +
            `Set the content price on chain first, then publish.` },
        { status: 409 },
      );
    }

    if (priced.value.toString() !== String(body.price)) {
      return NextResponse.json(
        { error:
            `this post claims a price of ${body.price}, but the vault prices ` +
            `"${body.contentKey}" at ${priced.value.toString()}.` },
        { status: 409 },
      );
    }

    postAccess = { kind: 'paid', price: body.price, contentKey: body.contentKey };
  } else {
    return NextResponse.json({ error: `unknown access "${access}"` }, { status: 400 });
  }

  const postId = newId('p');

  const publishedAtMs = Date.now();

  let sealedBody: SealedBody | null = null;
  let machineBody: (SealedBody & { contentKey: string }) | null = null;

  if (postAccess.kind === 'paid') {
    const both = await sealBothEditions({ humanKey: postAccess.contentKey, body: text }, (gate) =>
      storeBody({
        body: gate.body,
        vaultId: profile.vaultId!,
        gate: { kind: 'unlock', contentKey: gate.contentKey },
        owner: vault.value.owner,
      }),
    );
    if (!both.ok) {
      return NextResponse.json(
        { error: `the body could not be sealed: ${both.failure.detail}` },
        { status: 503 },
      );
    }
    sealedBody = both.value.human.sealed;
    machineBody = { ...both.value.machine.sealed, contentKey: both.value.machine.contentKey };
  } else if (postAccess.kind === 'subscribers') {
    const stored = await storeBody({
      body: text,
      vaultId: profile.vaultId,
      gate: { kind: 'period', tier: BigInt(postAccess.tier), period: periodOf(BigInt(publishedAtMs)) },
      owner: vault.value.owner,
    });
    if (!stored.ok) {
      return NextResponse.json(
        { error: `the body could not be sealed: ${stored.failure.detail}` },
        { status: 503 },
      );
    }
    sealedBody = stored.value;
  }

  const post = {
    id: postId,
    vaultId: profile.vaultId,
    authorHandle: handle,
    createdAtMs: publishedAtMs,
    title,
    preview,
    body: text,
    access: postAccess,
    commentCount: 0,
    ...(sealedBody === null ? {} : { sealedBody }),
    ...(machineBody === null ? {} : { machineBody }),
    authorship: {
      address: author,
      issuedAtMs: timestampMs ?? 0,
      origin,
      contentSha256,
      signature: signature ?? '',
    },
  };

  const client = await db().connect();
  try {
    await client.query('BEGIN');

    if (proof.value !== null) {
      const spent = await spendSignature(client, proof.value);
      if (!spent.ok) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: spent.failure.detail }, { status: 401 });
      }
    }

    await addPost(post, client);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  await sweepUsedSignatures();

  return NextResponse.json({ post: { id: post.id, access: post.access } });
}
