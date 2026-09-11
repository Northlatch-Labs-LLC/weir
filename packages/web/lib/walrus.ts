// Built-by: @projectx.sui · Co-authored-by: Claude <noreply@anthropic.com>
import 'server-only';
import { opaqueDetail } from './opaque';

import { fail, ok, type Reading } from '@projectx-social/sdk';

export const MAX_EPOCHS = 53;

const BLOB_ID = /^[A-Za-z0-9_-]{43}$/;

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

export function isBlobId(value: string): boolean {
  return BLOB_ID.test(value);
}

export interface WalrusConfig {
  aggregatorUrl: string;
  publisherUrl: string | null;
}

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

export interface BlobRef {
  blobId: string;
  size: number;
  endEpoch: number;
  alreadyExisted: boolean;
}

interface PublisherResponse {
  newlyCreated?: {
    blobObject?: { blobId?: string; size?: number; storage?: { endEpoch?: number } };
  };
  alreadyCertified?: { blobId?: string; endEpoch?: number };
}

export interface StoreOptions {
  epochs: number;
  permanent?: boolean;
  token: string;
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
      headers: { authorization: `Bearer ${options.token}` },
      body: bytes as BodyInit,
    });
    if (!response.ok) {
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

const READ_TIMEOUT_MS = 15_000;

const MAX_BLOB_BYTES = 16 * 1024 * 1024;

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
