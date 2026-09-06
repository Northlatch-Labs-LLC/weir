// Built-by: @projectx.sui
/**
 * The one place the purse process builds its Sui client.
 *
 * The SDK's `createClient` builds a `SuiGrpcClient` on the global `fetch`. Inside the purse's
 * hardened unit that fetch cannot run (see https-fetch.ts), so the purse builds the same client
 * on its own transport. Note the shape: `SuiGrpcClient` does NOT forward a `fetch` option -- it
 * constructs its own `GrpcWebFetchTransport` from `baseUrl` and `fetchInit` and ignores the rest
 * (read in @mysten/sui 2.27.1, dist/grpc/client.mjs). Only a ready-made `transport` is honoured,
 * so the transport is made here, with the WebAssembly-free fetch, and handed over whole. The
 * first cut of this file passed `fetch` and changed nothing; the purse died at its next network
 * call exactly as before. test/purse-client.test.ts starts a child under --jitless and reaches the
 * real fullnode through this client, so that mistake cannot come back unnoticed.
 *
 * Every other process (phase two, the birth tools, the brake sweep) runs unhardened and keeps the
 * SDK's client; this file is for the signer alone.
 */

import { SuiGrpcClient } from '@mysten/sui/grpc';
import { GrpcWebFetchTransport } from '@protobuf-ts/grpcweb-transport';
import type { ProjectXSocialConfig } from '@projectx-social/sdk';
import { httpsFetch } from './https-fetch.js';

export function createPurseClient(config: ProjectXSocialConfig, fetchImpl: typeof fetch = httpsFetch as typeof fetch): SuiGrpcClient {
  const transport = new GrpcWebFetchTransport({ baseUrl: config.grpcUrl, fetch: fetchImpl });
  return new SuiGrpcClient({ network: config.network, transport });
}
