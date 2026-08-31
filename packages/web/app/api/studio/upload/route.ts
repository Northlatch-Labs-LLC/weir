// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { rateLimit } from '@/lib/rate-limit';
import { verifyAction } from '@/lib/identity';
import { createClient, periodOf, readCreatorVault } from '@projectx-social/sdk';
import { attachAsset, findPost, findProfile } from '@/lib/content';
import { MAX_BYTES, storeAsset, type AssetGate } from '@/lib/media';
import { siteConfig } from '@/lib/chain';

export const dynamic = 'force-dynamic';

/**
 * Attach an image to a post.
 *
 * Authorship is read from chain, exactly as publishing is — the vault's owner is the only address
 * allowed to add media to that creator's post. The uploader's claim about who they are buys
 * nothing, and neither does their claim about what the file is: the type is sniffed from the bytes
 * in `storeAsset`, and anything that is not a real image is refused.
 */
export async function POST(request: Request) {
  const limited = rateLimit(request, 'write');
  if (limited !== null) return limited;

  /*
    A body that is not multipart makes `formData()` throw, and an uncaught throw here is a 500 —
    which says "this server is broken" about a request that was simply malformed. Found by probing
    the deployed route with an empty POST.

    The composer always sends multipart, so nothing legitimate reaches this branch; it exists so
    that anything else gets an answer that is true.
  */
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

  const post = await findPost(postId);
  if (post === null) return NextResponse.json({ error: 'no such post' }, { status: 404 });

  const profile = await findProfile(post.authorHandle);
  if (profile === null) return NextResponse.json({ error: 'no such creator' }, { status: 404 });

  const config = siteConfig();
  if (!config.ok) return NextResponse.json({ error: config.failure.detail }, { status: 503 });

  // Authorship is checked against the vault, so a profile without one has nothing to attribute an
  // upload to. Refused rather than read against a null object id.
  if (profile.vaultId === null) {
    return NextResponse.json(
      { error: 'this profile has no vault yet, so uploads cannot be attributed' },
      { status: 409 },
    );
  }

  const vault = await readCreatorVault(createClient(config.value), profile.vaultId);
  if (!vault.ok) {
    // Cannot verify authorship, so nothing is stored. Writing bytes we could not attribute is how
    // one creator's media ends up on another's post.
    return NextResponse.json(
      { error: `could not read the vault: ${vault.failure.detail}` },
      { status: 503 },
    );
  }
  if (author.toLowerCase() !== vault.value.owner.toLowerCase()) {
    return NextResponse.json({ error: 'only the vault owner may attach media' }, { status: 403 });
  }

  /*
    Prove the caller controls `author`.

    The check above reads the vault's owner from chain and compares it to a form field, which
    authorises nothing on its own: the owner is public, so anybody could send it and attach bytes
    to somebody else's post. The signature binds the post and a hash of the file, so it cannot be
    reused to attach a different file to the same post.

    Nothing in the interface calls this route today. That makes it surface with no purpose, and a
    closed door is the right state for it until something needs to open it.
  */
  const signature = form.get('signature');
  const timestampMs = Number(form.get('timestampMs'));
  const fileSha256 = createHash('sha256')
    .update(Buffer.from(await file.arrayBuffer()))
    .digest('hex');

  const proof = await verifyAction({
    address: author,
    signature: typeof signature === 'string' ? signature : '',
    timestampMs: Number.isFinite(timestampMs) ? timestampMs : 0,
    action: { kind: 'upload', postId, fileSha256 },
  });
  if (!proof.ok) {
    return NextResponse.json({ error: proof.failure.detail }, { status: 401 });
  }

  /*
    Storage terms follow the post's own access, and are decided here rather than accepted from the
    request. A body that could name its own tier could ask for two years of storage on a free post,
    and the bill would be ours.

    Gating and duration are read from the same fact but passed separately, because they answer
    different questions: `gated` decides whether the bytes are encrypted before they leave, `tier`
    decides how long the lease runs. Changing the free tier's duration must not quietly change
    whether free content is encrypted.
  */
  /*
    Every gated post's media is sealed. Only an open post's bytes go up in the clear.

    This line used to read `post.access.kind === 'paid'`, and it was older than this storage layer.
    It was written when media lived on `/app/media`, a private volume served by a route that checked
    entitlement, where "not encrypted" honestly meant "only our server can read it". Storage then
    moved to Walrus — **a Walrus blob is public** — and the line did not change, so subscriber media
    went from a private file to a public one with no edit to mark the moment.

    A paid post seals to `unlock_identity(vault, content_key)`; a subscriber post has no content key
    and seals to `period_identity(vault, tier, period)` instead, which is what its words already
    use, so one `Subscription` opens the picture and the sentence under it.
  */
  const gated: AssetGate | null =
    post.access.kind === 'paid'
      ? { kind: 'unlock', vaultId: post.vaultId, contentKey: post.access.contentKey }
      : post.access.kind === 'subscribers'
        ? {
            kind: 'period',
            vaultId: post.vaultId,
            /*
              Tier 0, and the period the POST was published in — never `periodOf(now)`.

              Media is uploaded after its post exists, sometimes much later, and a key sealed to the
              month of the upload would be unopenable by exactly the subscribers the post was
              written for. `createdAtMs` is the same instant the body was sealed against, so the
              picture and the words land on one identity.

              Tier 0 because `seal_approve_subscription` compares `subscription.tier >= tier`, so
              tier 0 is readable by every subscriber at any tier — which is what "subscribers only"
              means in the product today.
            */
            tier: 0n,
            period: periodOf(BigInt(post.createdAtMs)),
          }
        : null;
  const stored = await storeAsset({
    postId,
    label: file.name,
    bytes: new Uint8Array(await file.arrayBuffer()),
    // Not the form's `author` field: this is the address the vault reports as owner, already
    // checked above. It decides who ends up owning the `Blob` object we are about to pay for.
    owner: vault.value.owner,
    tier: gated !== null ? 'durable' : 'ephemeral',
    gated,
  });

  if (!stored.ok) {
    /*
      Separated by kind, because these need different responses. An unconfigured or refused
      publisher is ours to fix and the creator can do nothing about it — 503, and it must not read
      as "your file was wrong". A malformed upload is theirs — 400.
    */
    const status =
      stored.failure.kind === 'malformed' ? 400 : stored.failure.kind === 'unconfigured' ? 503 : 502;
    return NextResponse.json({ error: stored.failure.detail }, { status });
  }

  const attached = await attachAsset(stored.value);
  if (!attached) {
    // The blob is stored and paid for but belongs to no post. Reported rather than swallowed: the
    // WAL is spent either way, and a silent success here would leave an orphan nobody can find.
    return NextResponse.json(
      { error: 'no such post — the blob was stored but could not be attached' },
      { status: 404 },
    );
  }

  // The id, not a URL. There is no URL that reaches this without the entitlement gate.
  return NextResponse.json({
    assetId: stored.value.id,
    contentType: stored.value.contentType,
    // Storage is a lease. A caller that cannot see when it ends cannot warn anybody it is ending.
    blobId: stored.value.blobId,
    endEpoch: stored.value.endEpoch,
  });
}
