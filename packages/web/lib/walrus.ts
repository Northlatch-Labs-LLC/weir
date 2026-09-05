// Built-by: @projectx.sui · Co-authored-by: Claude
import 'server-only';
import { opaqueDetail } from './opaque';

/**
 * Blob storage on Walrus.
 *
 * # Why this exists
 *
 * Media was written with `writeFile` to a path on local disk. On a serverless host that disk is
 * per-instance and discarded when the instance is, so an upload landed on a container that then
 * vanished and no other instance could read it. There was no working blob storage in this product
 * at all — which is also why nothing in the interface calls the upload route.
 *
 * The interesting reason to choose Walrus over a bucket is not durability, it is custody. A paid
 * post whose bytes sit in storage this platform controls means the entitlement is on chain and the
 * goods are not: if we disappear, a buyer keeps a receipt for something they can no longer read.
 *
 * # Three facts that decide how this may be used
 *
 * **Blobs are public.** Anyone with a blob id can read one from any aggregator. Putting a paid
 * post's body here unencrypted does not weaken the paywall, it removes it. Gated content must be
 * encrypted before it is stored, and only public content may go up as plaintext.
 *
 * **Storage is a lease, not permanence.** It is bought for a number of epochs, at most 53, and a
 * mainnet epoch is two weeks — so roughly two years is the longest that can be purchased at once.
 * After that the blob is deleted unless somebody extends it. Nothing here may promise "for ever".
 *
 * **Writing costs WAL, and there is no public mainnet publisher.** Walrus's own documentation says
 * so plainly: "Walrus has no public unauthenticated publisher on Mainnet. There are no plans to
 * create one." Reading is free through community aggregators; writing means our own publisher, an
 * upload relay, or the SDK — and in every case an address holding WAL.
 *
 * # Who pays, decided
 *
 * **The creator pays for their own content, and owns the blob.** Not the platform. It follows from
 * everything else here: an address you own, a vault you own, a capability the contract checks. A
 * platform that paid for storage would be a platform that can stop paying, which is custody by
 * another name — and the whole reason to leave Postgres was to stop being the party that can make
 * somebody's content disappear.
 *
 * The consequence is that the primary write path is **not this module**. Walrus has no gas
 * sponsorship primitive — there is no way for a creator to sign a store while somebody else pays —
 * so a creator paying means a creator signing, in their own browser, with their own WAL and SUI.
 * That is an upload relay: the client registers and certifies on chain, and the relay only
 * distributes slivers so a browser need not connect to a thousand storage nodes. The relay holds
 * no funds and needs none from us.
 *
 * `storeBlob` below therefore remains a **server-side path for content this platform genuinely
 * owns** — its own images, its own pages — and is not the route a creator's post takes. It stays
 * because it is real and tested, not because it is the plan.
 */

import { fail, ok, type Reading } from '@projectx-social/sdk';

/** Walrus caps a single purchase at 53 epochs; on mainnet an epoch is two weeks. */
export const MAX_EPOCHS = 53;

/**
 * A blob id is URL-safe base64 of a 32-byte hash — `M4hsZGQ1oCktdzegB6HnI6Mi28S2nqOPHxK-W7_4BUk`.
 *
 * Validated before it is ever put in a URL. An id taken from the store and interpolated unchecked
 * is a path traversal against somebody else's aggregator, and the fact that we wrote it earlier is
 * not a reason to trust it on the way back out.
 */
const BLOB_ID = /^[A-Za-z0-9_-]{43}$/;

/** Hosts with no network between us and them, and so the only ones where plain HTTP is safe. */
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export function isBlobId(value: string): boolean {
  return BLOB_ID.test(value);
}

export interface WalrusConfig {
  /** Reads. A public community aggregator is fine here — blobs are public anyway. */
  aggregatorUrl: string;
  /** Writes. `null` when none is configured, which is the ordinary state until WAL is funded. */
  publisherUrl: string | null;
}

/**
 * Endpoints, with no defaults.
 *
 * A default aggregator would silently send this deployment's reads through somebody else's
 * infrastructure, and a default publisher cannot exist at all.
 */
export function walrusConfig(
  env: Record<string, string | undefined> = process.env as Record<string, string | undefined>,
): Reading<WalrusConfig> {
  const source = 'Walrus configuration';
  const aggregatorUrl = (env['PROJECTX_WALRUS_AGGREGATOR_URL'] ?? '').trim();
  if (aggregatorUrl === '') {
    return fail('unconfigured', source, 'PROJECTX_WALRUS_AGGREGATOR_URL is not set');
  }
  if (!/^https:\/\//.test(aggregatorUrl)) {
    return fail('malformed', source, 'PROJECTX_WALRUS_AGGREGATOR_URL must be https');
  }

  /*
    The publisher may be plain HTTP, but only on loopback.

    The request carries a bearer token that authorises spending our storage wallet, so sending it
    over unencrypted HTTP across any real network hands that authority to whoever is listening.
    Loopback is the one case where there is no network to listen on — and it is the ordinary
    deployment, since `walrus publisher` binds 127.0.0.1 and is reached from the same host.

    Matched on the host rather than by looking for "localhost" anywhere in the string: a URL like
    `http://localhost.example.com` contains it and is not loopback at all.
  */
  const publisher = (env['PROJECTX_WALRUS_PUBLISHER_URL'] ?? '').trim();
  if (publisher !== '') {
    let host = '';
    try {
      const parsed = new URL(publisher);
      host = parsed.hostname;
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        return fail('malformed', source, 'PROJECTX_WALRUS_PUBLISHER_URL must be http or https');
      }
      if (parsed.protocol === 'http:' && !LOOPBACK.has(host)) {
        return fail(
          'malformed',
          source,
          'PROJECTX_WALRUS_PUBLISHER_URL may only be http on loopback — the upload token it ' +
            'carries authorises spending the storage wallet, and http off-host publishes it',
        );
      }
    } catch {
      return fail('malformed', source, 'PROJECTX_WALRUS_PUBLISHER_URL is not a URL');
    }
  }

  return ok({
    aggregatorUrl: aggregatorUrl.replace(/\/+$/, ''),
    publisherUrl: publisher === '' ? null : publisher.replace(/\/+$/, ''),
  });
}

/** What a stored blob is, and when the lease on it runs out. */
export interface BlobRef {
  blobId: string;
  size: number;
  /** The epoch after which Walrus deletes it unless the storage is extended. */
  endEpoch: number;
  /** True when the blob was already on Walrus and this write only certified it again. */
  alreadyExisted: boolean;
}

/**
 * The publisher's answer, which has two shapes.
 *
 * Identical content produces the same blob id, so storing something already there returns
 * `alreadyCertified` instead of `newlyCreated`. Treating that as a failure would make re-publishing
 * unchanged content an error, when it is the deduplication working.
 */
interface PublisherResponse {
  newlyCreated?: {
    blobObject?: { blobId?: string; size?: number; storage?: { endEpoch?: number } };
  };
  alreadyCertified?: { blobId?: string; endEpoch?: number };
}

export interface StoreOptions {
  /** How many epochs of storage to buy. Capped at {@link MAX_EPOCHS} by Walrus itself. */
  epochs: number;
  /**
   * Permanent blobs cannot be deleted before their lease ends; deletable ones can.
   *
   * Defaulted to permanent here, against Walrus's own default of deletable. Content somebody paid
   * to read must not be removable by whoever uploaded it — the entitlement is on chain and outlives
   * any change of mind.
   */
  permanent?: boolean;
  /**
   * The bearer token from `grantUpload`, authorising this one store.
   *
   * Required in practice. Our publisher runs with `--jwt-decode-secret`, because an open publisher
   * on mainnet can be drained by anybody who finds it — so a request without this is refused at the
   * publisher rather than served.
   */
  token: string;
  /**
   * Sui address to receive the resulting `Blob` object.
   *
   * The creator's, always. We pay the WAL; they end up owning the object. It must equal the
   * `send_object_to` claim in the token or the publisher rejects the request, which is the point:
   * the destination was decided when the upload was authorised, not when it was performed.
   */
  sendObjectTo: string;
}

export async function storeBlob(
  bytes: Uint8Array,
  options: StoreOptions,
): Promise<Reading<BlobRef>> {
  const source = 'Walrus store';
  const config = walrusConfig();
  if (!config.ok) return config;

  if (config.value.publisherUrl === null) {
    return fail(
      'unconfigured',
      source,
      'PROJECTX_WALRUS_PUBLISHER_URL is not set. Walrus has no public unauthenticated publisher ' +
        'on mainnet, so writing needs our own publisher or upload relay, funded with WAL. Reading ' +
        'works without one.',
    );
  }
  if (bytes.length === 0) return fail('malformed', source, 'refusing to store an empty blob');
  if (options.epochs < 1 || options.epochs > MAX_EPOCHS) {
    return fail(
      'malformed',
      source,
      `epochs must be between 1 and ${MAX_EPOCHS}; Walrus refuses a longer purchase`,
    );
  }

  const url =
    `${config.value.publisherUrl}/v1/blobs` +
    `?epochs=${options.epochs}&${options.permanent === false ? 'deletable=true' : 'permanent=true'}` +
    `&send_object_to=${encodeURIComponent(options.sendObjectTo)}`;

  try {
    const response = await fetch(url, {
      method: 'PUT',
      // The publisher checks this against `--jwt-decode-secret` and, with `--jwt-verify-upload`,
      // checks that the epochs and destination above match what the token authorised.
      headers: { authorization: `Bearer ${options.token}` },
      body: bytes as BodyInit,
    });
    if (!response.ok) {
      /*
        A refused token arrives as **400**, not 401 or 403 — measured against a running publisher,
        having first assumed otherwise. It carries a structured body naming the reason:

          {"error":{"code":400,"message":"the JWT token is invalid: …",
                    "details":[{"reason":"INVALID_TOKEN","domain":"auth.publisher.walrus.space"}]}}

        A missing header is plain text instead ("Header of type `authorization` was missing"), so
        both shapes are checked. This matters because the two failures need opposite responses: a
        rejected token is our misconfiguration and retrying never fixes it, while a genuine 400 is
        a bad request. Reading only the status code would merge them.
      */
      const body = await response.text().catch(() => '');
      const rejected =
        /INVALID_TOKEN|auth\.publisher\.walrus\.space|JWT token is invalid/i.test(body) ||
        /`authorization` was missing/i.test(body);

      if (rejected) {
        return fail(
          'unconfigured',
          source,
          'the publisher refused this upload token; check that ' +
            'PROJECTX_WALRUS_PUBLISHER_JWT_SECRET matches the publisher --jwt-decode-secret, and ' +
            'that the epochs and destination sent match what the token authorised',
        );
      }
      return fail('transport', source, `the publisher answered ${response.status}`);
    }

    const body = (await response.json()) as PublisherResponse;
    const created = body.newlyCreated?.blobObject;
    const existing = body.alreadyCertified;

    const blobId = created?.blobId ?? existing?.blobId;
    if (typeof blobId !== 'string' || !isBlobId(blobId)) {
      // Never a silent success. A store that cannot name what it stored has stored nothing usable.
      return fail('malformed', source, 'the publisher returned no usable blob id');
    }

    const endEpoch = created?.storage?.endEpoch ?? existing?.endEpoch;
    if (typeof endEpoch !== 'number') {
      return fail('malformed', source, 'the publisher returned no expiry for this blob');
    }

    return ok({
      blobId,
      size: created?.size ?? bytes.length,
      endEpoch,
      alreadyExisted: created === undefined,
    });
  } catch (error) {
    return fail('transport', source, opaqueDetail(source, error));
  }
}

/**
 * Read a blob's bytes.
 *
 * Free, and it needs no publisher: community aggregators serve mainnet reads. A missing blob is
 * `not-found` rather than a transport failure, because those need different responses — one is a
 * lease that expired, the other is a node that is unreachable right now.
 */
/**
 * How long a community aggregator has to answer.
 *
 * Generous, because a cold blob genuinely takes seconds to serve and a deadline that fires on
 * healthy reads is worse than none: it turns a slow success into a failure the caller retries,
 * which is more load on the thing that was already slow.
 */
const READ_TIMEOUT_MS = 15_000;

/**
 * The largest blob this application will hold in memory.
 *
 * Sixteen megabytes — twice `media.MAX_BYTES`, the largest thing this application will ever have
 * PUT there, so no blob we wrote can fail this. The headroom is deliberate: a cap set exactly at the
 * write limit turns any future encoding overhead into an unreadable post.
 *
 * A blob id is a hash of content this deployment did not necessarily create, served by an
 * aggregator that is not ours. Without a cap, `arrayBuffer()` allocates whatever arrives.
 */
const MAX_BLOB_BYTES = 16 * 1024 * 1024;

/**
 * Read a response body, refusing anything over `limit`.
 *
 * # Why `content-length` is not the control
 *
 * It is checked first because it is free and refuses before a byte of body is read. But it is a
 * claim made by a server nobody here operates: it can be absent under chunked encoding, it can be
 * wrong, and a hostile one can simply understate it. An early exit, not a guard.
 *
 * The guard is the streaming count, which measures what actually arrives and stops mid-transfer.
 * `arrayBuffer()` cannot do that — by the time it returns the allocation has already happened, and
 * refusing afterwards refuses nothing.
 */
async function readAtMost(response: Response, limit: number): Promise<Reading<Uint8Array>> {
  const source = 'Walrus blob';
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) {
    return fail(
      'malformed',
      source,
      `the aggregator declares ${declared} bytes; the limit is ${limit}`,
    );
  }

  const body = response.body;
  if (body === null) return fail('transport', source, 'the aggregator returned no body');

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        /*
          Cancelled rather than merely abandoned, so the socket is released now instead of when the
          aggregator finishes sending something already refused.
        */
        await reader.cancel();
        return fail('malformed', source, `this blob exceeds ${limit} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return ok(out);
}

export async function readBlob(blobId: string): Promise<Reading<Uint8Array>> {
  const source = `Walrus blob ${blobId}`;
  if (!isBlobId(blobId)) return fail('malformed', source, 'that is not a Walrus blob id');

  const config = walrusConfig();
  if (!config.ok) return config;

  try {
    /*
      A deadline, because an aggregator that never answers otherwise holds this request for ever.

      These are COMMUNITY aggregators — chosen deliberately, since reads need no publisher and cost
      nothing — which also means nobody here operates them, nobody is paged when one degrades, and a
      slow one is indistinguishable from a stopped one. `fetch` has no default timeout, so without
      this the request lives as long as the socket does: a serverless invocation billed to its own
      ceiling, holding a connection nothing will close.
    */
    const response = await fetch(`${config.value.aggregatorUrl}/v1/blobs/${blobId}`, {
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    });
    if (response.status === 404) {
      return fail(
        'not-found',
        source,
        'no aggregator holds this blob. Its storage lease may have expired.',
      );
    }
    if (!response.ok) return fail('transport', source, `the aggregator answered ${response.status}`);

    const body = await readAtMost(response, MAX_BLOB_BYTES);
    if (!body.ok) return fail(body.failure.kind, source, body.failure.detail);
    return ok(body.value);
  } catch (error) {
    return fail('transport', source, opaqueDetail(source, error));
  }
}
