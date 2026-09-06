// Built-by: @projectx.sui
/**
 * The one place the purse process builds its Sui client.
 *
 * The SDK's `createClient` builds a `SuiGrpcClient` on the global `fetch`. Inside the purse's
 * hardened unit that fetch cannot run (see https-fetch.ts), so the purse builds the same client
 * with its own transport fetch. Every other process (phase two, the birth tools, the brake sweep)
 * runs unhardened and keeps the SDK's client; this file is for the signer alone.
 */

import { SuiGrpcClient } from '@mysten/sui/grpc';
import type { ProjectXSocialConfig } from '@projectx-social/sdk';
import { httpsFetch } from './https-fetch.js';

export function createPurseClient(config: ProjectXSocialConfig, fetchImpl: typeof fetch = httpsFetch as typeof fetch): SuiGrpcClient {
  return new SuiGrpcClient({ network: config.network, baseUrl: config.grpcUrl, fetch: fetchImpl });
}
