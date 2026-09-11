// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { verifyAction } from '@/lib/identity';
import { createClient, periodOf, readCreatorVault } from '@projectx-social/sdk';
import { attachAsset, findPost, findProfile } from '@/lib/content';
import { MAX_BYTES, storeAsset, type AssetGate } from '@/lib/media';
import { tierForAccess } from '@/lib/storage-retention';
import { tooLarge } from '@/lib/body-limit';
import { siteConfig } from '@/lib/chain';

export const dynamic = 'force-dynamic';
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

export async function POST(request: Request) {
  const limited = rateLimit(request, 'write');
  if (limited !== null) return limited;

  const oversized = tooLarge(request, MAX_BYTES + MULTIPART_OVERHEAD_BYTES);
  if (oversized !== null) return oversized;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json(
      { error: 'this endpoint takes a multipart/form-data body' },
      { status: 400 },
    );
  }

  const postId = form.get('postId');
  const author = form.get('author');
  const file = form.get('file');

  if (typeof postId !== 'string' || typeof author !== 'string' || !(file instanceof File)) {
    return NextResponse.json({ error: 'postId, author and file are required' }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `file exceeds ${MAX_BYTES} bytes` }, { status: 413 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());

  const signature = form.get('signature');
  const timestampMs = Number(form.get('timestampMs'));
  const fileSha256 = createHash('sha256').update(Buffer.from(bytes)).digest('hex');

  const proof = await verifyAction({
    origin: new URL(request.url).origin,
    address: author,
    signature: typeof signature === 'string' ? signature : '',
    timestampMs: Number.isFinite(timestampMs) ? timestampMs : 0,
    action: { kind: 'upload', postId, fileSha256 },
  });
  if (!proof.ok) {
    return NextResponse.json({ error: proof.failure.detail }, { status: 401 });
  }

  const post = await findPost(postId);
  if (post === null) return NextResponse.json({ error: 'no such post' }, { status: 404 });

  const profile = await findProfile(post.authorHandle);
  if (profile === null) return NextResponse.json({ error: 'no such creator' }, { status: 404 });

  const config = siteConfig();
  if (!config.ok) return NextResponse.json({ error: config.failure.detail }, { status: 503 });

  if (profile.vaultId === null) {
    return NextResponse.json(
      { error: 'this profile has no vault yet, so uploads cannot be attributed' },
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
    return NextResponse.json({ error: 'only the vault owner may attach media' }, { status: 403 });
  }

  const gated: AssetGate | null =
    post.access.kind === 'paid'
      ? { kind: 'unlock', vaultId: post.vaultId, contentKey: post.access.contentKey }
      : post.access.kind === 'subscribers'
        ? {
            kind: 'period',
            vaultId: post.vaultId,
            tier: 0n,
            period: periodOf(BigInt(post.createdAtMs)),
          }
        : null;
  const stored = await storeAsset({
    postId,
    label: file.name,
    bytes,
    owner: vault.value.owner,
    tier: tierForAccess(post.access.kind),
    gated,
  });

  if (!stored.ok) {
    const status =
      stored.failure.kind === 'malformed' ? 400 : stored.failure.kind === 'unconfigured' ? 503 : 502;
    return NextResponse.json({ error: stored.failure.detail }, { status });
  }

  const attached = await attachAsset(stored.value);
  if (!attached) {
    return NextResponse.json(
      { error: 'no such post — the blob was stored but could not be attached' },
      { status: 404 },
    );
  }

  return NextResponse.json({
    assetId: stored.value.id,
    contentType: stored.value.contentType,
    blobId: stored.value.blobId,
    endEpoch: stored.value.endEpoch,
  });
}
