// Built-by: @projectx.sui /|\ · Co-authored-by: Claude
import { rateLimit } from '@/lib/rate-limit';
import { readAsset, isValidAssetId } from '@/lib/media';
import { canRead, NO_ENTITLEMENTS, readEntitlements } from '@/lib/entitlement';
import { provenReaderFor } from '@/lib/read-session';
import { findAsset, findPost } from '@/lib/content';
import { fold } from '@projectx-social/sdk';

export const dynamic = 'force-dynamic';

/**
 * Serve one asset, and only to a reader entitled to the post that owns it.
 *
 * # Why the post id is in the path and is actually used
 *
 * # The check happens here, on every request
 *
 * Not at upload, not at render, and not once per session. `canRead` is the same predicate the feed
 * uses — there is no second copy that could drift from it, which is precisely how the original
 * broke: one copy checked and another did not.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ postId: string; assetId: string }> },
) {
  const limited = rateLimit(request, 'read');
  if (limited !== null) return limited;

  const { postId, assetId } = await params;

  if (!isValidAssetId(assetId)) {
    return new Response('not found', { status: 404 });
  }

  const post = await findPost(postId);
  if (post === null) return new Response('not found', { status: 404 });

  // The asset must belong to this post. Without this, a reader entitled to any one post could
  // fetch every asset in the system by pairing their post id with someone else's asset id.
  if (!(post.assetIds ?? []).includes(assetId)) {
    return new Response('not found', { status: 404 });
  }

  /*
    The reader is proved, not named.

    This read `?reader=` out of the URL and resolved entitlements for whatever address it found.
    Nothing proved the caller *was* that address, and buyers are enumerable from public chain
    events — so naming one returned their decrypted media. The encryption at rest did not help:
    this server holds the key and decrypts below, so this handler was the only gate there was.

    The mistake was believing that because an address cannot forge ownership, naming one grants
    nothing. The attacker never forged ownership; they borrowed the entitlement of somebody who
    genuinely had it.
  */
  const readerReading = await provenReaderFor(request);
  const reader = fold(
    readerReading,
    (v) => v,
    () => null,
  );
  const entitlementReading = await readEntitlements(reader);

  // A failed read locks. It never releases bytes on the strength of a node being unreachable.
  const entitlements = fold(
    entitlementReading,
    (v) => v,
    () => ({ ...NO_ENTITLEMENTS, truncated: false }),
  );

  if (!canRead(post, entitlements)) {
    /*
      "We did not find it" is not "you do not have it", and only one of those is a paywall.

      `readEntitlements` reads one page of each object type — 50 subscriptions, 50 unlocks — and
      sets `truncated` when there were more. That flag was discarded here, so a reader holding 51
      unlocks was told 403 "not entitled" about content they had paid for, in the words a paywall
      uses. It fails closed, so nothing leaked; it charged a real customer twice instead.

      503 while the answer is incomplete: the reader can retry, and the client can say "checking"
      rather than "buy this". Note the ordering — this must sit inside the `!canRead` branch, since
      a truncated read that *did* find the entitlement is a complete enough answer to release bytes.
    */
    /*
      A session we could not read joins `truncated` here rather than being treated as anonymity.

      Both mean the same thing — the answer is incomplete — and the reason they must share this
      branch is that the alternative is a paywall shown to somebody who already paid. `readerFrom‐
      Token` distinguishes "there is no session" (a complete answer: anonymous) from "the session
      could not be read" (no answer at all), and this is the only place that distinction can be
      spent. Collapsing it here would have made the type's care pointless.
    */
    if (entitlements.truncated || !readerReading.ok) {
      return new Response('entitlements incomplete', {
        status: 503,
        headers: { 'x-entitlements-truncated': 'true', 'cache-control': 'no-store' },
      });
    }

    // 403 rather than 404: the post is real and the reader may be able to buy it. Pretending it
    // does not exist would make a paywall indistinguishable from a broken link.
    return new Response('not entitled', { status: 403 });
  }

  // The stored type, sniffed from the bytes at upload. Never derived from a filename or echoed
  // back from the uploader — a browser renders whatever this header claims, so a client-supplied
  // value is how an HTML file gets served as an image and runs as a page on this origin.
  const record = await findAsset(assetId);
  if (record === null) return new Response('not found', { status: 404 });

  /*
    The bytes come from Walrus now, and every way that read can fail is a fact about storage rather
    than about this reader: an expired lease, an unreachable aggregator, a blob that no longer
    decrypts. None of them is the reader's fault and none is a 403 — the entitlement question was
    already answered above, in their favour.

    502 rather than 404 deliberately. "Gone" and "we cannot reach it right now" look identical to a
    browser and mean opposite things to whoever has to fix it.
  */
  const read = await readAsset(record);
  if (!read.ok) {
    return new Response('this media could not be retrieved from storage', { status: 424 });
  }

  /*
    A sealed asset leaves here as ciphertext, and the reader's browser opens it.

    This is the visible half of the custody change. This server no longer holds the key and cannot
    produce one: the key servers release it only against a `SessionKey` the reader signed and an
    on-chain entitlement the reader holds. So what is served is exactly what is already public on
    Walrus, plus the wrapped key — which is safe to hand to anybody, because it is useless without a
    threshold of key servers first executing `entitlement::seal_approve_*`.

    That has a consequence worth being precise about: for sealed media the paywall no longer depends
    on the check above being correct. The check stays — it is defence in depth, it keeps blob ids
    and wrapped keys off the open internet, and it is the same one predicate the feed uses — but a
    bug in it can no longer release a creator's paid media, because there is no plaintext here to
    release. That is the property Creator Terms §4.3 describes.

    The metadata rides in headers rather than in a JSON envelope so the body stays raw bytes: base64
    in JSON would inflate an 8 MB image by a third for no gain, and the browser wants an
    `ArrayBuffer` at the end of it either way.
  */
  if (read.value.kind === 'sealed') {
    const { ciphertext, wrappedKey, nonce } = read.value;
    return new Response(ciphertext as unknown as BodyInit, {
      headers: {
        // Not `record.contentType`. These bytes are not an image and must never be rendered as one
        // — the real type is announced separately, for after the browser has decrypted.
        'content-type': 'application/octet-stream',
        'content-length': String(ciphertext.length),
        'x-encryption': 'seal',
        'x-seal-wrapped-key': wrappedKey,
        'x-blob-nonce': nonce,
        /*
          The integrity check follows the plaintext.

          `readAsset` verifies this hash for anything it can open; it cannot open this, so the
          browser verifies it after decrypting. Sent rather than dropped, because the bytes still
          travelled through storage nobody here operates.
        */
        'x-plaintext-sha256': record.sha256,
        'x-plaintext-content-type': record.contentType,
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  }

  const bytes = read.value.bytes;

  return new Response(bytes as unknown as BodyInit, {
    headers: {
      'content-type': record.contentType,
      'content-length': String(bytes.length),
      // Private: a shared cache must never hold a body that was released against one reader's
      // entitlement and serve it to another.
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
