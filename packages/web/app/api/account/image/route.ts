// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { verifyAction } from '@/lib/identity';
import { accountHandle } from '@/lib/accounts';
import { findProfile, setProfileImage } from '@/lib/content';
import { detectType } from '@/lib/media';
import { grantUpload } from '@/lib/publisher-token';
import { storeBlob } from '@/lib/walrus';
import { tooLarge } from '@/lib/body-limit';
import { AVATAR_MAX_BYTES, AVATAR_TYPES, avatarUrl } from '@/lib/avatar';

export const dynamic = 'force-dynamic';
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

/*
  The picture on a page. The signature binds the handle and the sha256 of the bytes, so a
  captured signature cannot put a different image on the page; the address must hold that handle
  on chain; the bytes go to Walrus under the account's own storage grant; then the row names the
  blob. Nothing is written until every one of those has answered.
*/
export async function POST(request: Request) {
  const limited = rateLimit(request, 'write');
  if (limited !== null) return limited;

  const oversized = tooLarge(request, AVATAR_MAX_BYTES + MULTIPART_OVERHEAD_BYTES);
  if (oversized !== null) return oversized;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'this endpoint takes a multipart/form-data body' }, { status: 400 });
  }

  const address = form.get('address');
  const handle = form.get('handle');
  const file = form.get('file');
  if (typeof address !== 'string' || typeof handle !== 'string' || !(file instanceof File)) {
    return NextResponse.json({ error: 'address, handle and file are required' }, { status: 400 });
  }
  if (file.size > AVATAR_MAX_BYTES) {
    return NextResponse.json({ error: `the picture exceeds ${AVATAR_MAX_BYTES} bytes` }, { status: 413 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length === 0) {
    return NextResponse.json({ error: 'the picture is empty' }, { status: 400 });
  }
  const contentType = detectType(bytes);
  if (contentType === null || !AVATAR_TYPES.has(contentType)) {
    return NextResponse.json({ error: 'a picture is png, jpeg or webp' }, { status: 415 });
  }

  const signature = form.get('signature');
  const timestampMs = Number(form.get('timestampMs'));
  const imageSha256 = createHash('sha256').update(Buffer.from(bytes)).digest('hex');
  const proof = await verifyAction({
    origin: new URL(request.url).origin,
    address,
    signature: typeof signature === 'string' ? signature : '',
    timestampMs: Number.isFinite(timestampMs) ? timestampMs : 0,
    action: { kind: 'set-image', handle, imageSha256 },
  });
  if (!proof.ok) {
    return NextResponse.json({ error: proof.failure.detail }, { status: 401 });
  }

  const onChain = await accountHandle(address);
  if (!onChain.ok) {
    return NextResponse.json(
      { error: onChain.failure.detail, kind: onChain.failure.kind },
      { status: onChain.failure.kind === 'unconfigured' ? 503 : 502 },
    );
  }
  if (onChain.value === null) {
    return NextResponse.json({ error: 'this address does not hold an account yet' }, { status: 409 });
  }
  if (onChain.value !== handle) {
    return NextResponse.json({ error: `this address holds @${onChain.value}, not @${handle}` }, { status: 403 });
  }
  if ((await findProfile(handle)) === null) {
    return NextResponse.json({ error: 'this handle has no page yet' }, { status: 404 });
  }

  const grant = await grantUpload({ owner: address, size: bytes.length, tier: 'durable' });
  if (!grant.ok) {
    return NextResponse.json(
      { error: grant.failure.detail, kind: grant.failure.kind },
      { status: grant.failure.kind === 'unconfigured' ? 503 : 502 },
    );
  }
  const stored = await storeBlob(bytes, {
    epochs: grant.value.epochs,
    token: grant.value.token,
    sendObjectTo: address,
  });
  if (!stored.ok) {
    const status =
      stored.failure.kind === 'malformed' ? 400 : stored.failure.kind === 'unconfigured' ? 503 : 502;
    return NextResponse.json({ error: stored.failure.detail, kind: stored.failure.kind }, { status });
  }

  const named = await setProfileImage(handle, stored.value.blobId);
  if (!named) {
    return NextResponse.json({ error: 'the picture was stored but the page could not be updated' }, { status: 500 });
  }

  return NextResponse.json({
    blobId: stored.value.blobId,
    url: avatarUrl(stored.value.blobId),
    endEpoch: stored.value.endEpoch,
  });
}
