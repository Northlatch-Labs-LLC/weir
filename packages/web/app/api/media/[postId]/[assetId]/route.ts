// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import { rateLimit } from '@/lib/rate-limit';
import { readAsset, isValidAssetId } from '@/lib/media';
import {
  canRead,
  subscriptionForPeriod,
  NO_ENTITLEMENTS,
  readEntitlements,
  unlockKey,
} from '@/lib/entitlement';
import { provenReaderFor } from '@/lib/read-session';
import { findAsset, findPost, findProfile } from '@/lib/content';
import { createClient, fold, readVaultCoinType } from '@projectx-social/sdk';
import { siteConfig } from '@/lib/chain';

export const dynamic = 'force-dynamic';

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
  const vaultCoinType = await (async () => {
    if (post === null) return null;
    const recorded = (await findProfile(post.authorHandle))?.coinType ?? null;
    if (recorded !== null) return recorded;
    const config = siteConfig();
    if (!config.ok) return null;
    const read = await readVaultCoinType(createClient(config.value), post.vaultId);
    return read.ok ? read.value : null;
  })();
  if (post === null) return new Response('not found', { status: 404 });

  if (!(post.assetIds ?? []).includes(assetId)) {
    return new Response('not found', { status: 404 });
  }

  const readerReading = await provenReaderFor(request);
  const reader = fold(
    readerReading,
    (v) => v,
    () => null,
  );
  const entitlementReading = await readEntitlements(reader);

  const entitlements = fold(
    entitlementReading,
    (v) => v,
    () => ({ ...NO_ENTITLEMENTS, truncated: false }),
  );

  if (!canRead(post, entitlements)) {
    if (entitlements.truncated || !readerReading.ok) {
      return new Response('entitlements incomplete', {
        status: 503,
        headers: { 'x-entitlements-truncated': 'true', 'cache-control': 'no-store' },
      });
    }

    return new Response('not entitled', { status: 403 });
  }

  const record = await findAsset(assetId);
  if (record === null) return new Response('not found', { status: 404 });

  const read = await readAsset(record);
  if (!read.ok) {
    return new Response('this media could not be retrieved from storage', { status: 424 });
  }

  if (read.value.kind === 'sealed') {
    const { ciphertext, wrappedKey, nonce } = read.value;

    const descriptor = ((): Record<string, string> => {
      if (post.access.kind === 'paid') {
        const unlockId = entitlements.unlockIds?.get(
          unlockKey(post.vaultId, post.access.contentKey),
        );
        return unlockId === undefined
          ? {}
          : {
              'x-seal-entitlement': 'unlock',
              'x-seal-vault': post.vaultId,
              'x-seal-object': unlockId,
              'x-seal-content-key': post.access.contentKey,
            };
      }

      const sealed = record.encryption;
      if (
        post.access.kind === 'subscribers'
        && sealed?.scheme === 'seal'
        && sealed.tier !== undefined
        && sealed.period !== undefined
      ) {
        const held = subscriptionForPeriod(
          entitlements,
          post.vaultId,
          BigInt(sealed.tier),
          BigInt(sealed.period),
        );
        return held === null
          ? {}
          : {
              'x-seal-entitlement': 'subscription',
              'x-seal-vault': post.vaultId,
              'x-seal-object': held.objectId,
              'x-seal-tier': sealed.tier,
              'x-seal-period': sealed.period,
              ...(vaultCoinType === null ? {} : { 'x-seal-coin-type': vaultCoinType }),
            };
      }

      return {};
    })();

    return new Response(ciphertext as unknown as BodyInit, {
      headers: {
        ...descriptor,
        'content-type': 'application/octet-stream',
        'content-length': String(ciphertext.length),
        'x-encryption': 'seal',
        'x-seal-wrapped-key': wrappedKey,
        'x-blob-nonce': nonce,
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
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
