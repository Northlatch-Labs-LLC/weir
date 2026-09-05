/**
 * Which deployment this purse signs against.
 *
 * Read from a file named on the command line, not from the environment. The values are public —
 * a package id and a fullnode URL are on chain and on the website — so this is not about secrecy.
 * It is about the environment being the wrong place for anything the purse depends on: the key
 * loader refuses to start if a private key is found in the environment, and a process that reads
 * *some* of its configuration from there invites the next person to put the key there too.
 *
 * The file is validated rather than trusted. A `latestPackageId` that is one character short would
 * otherwise produce a move call against an address that does not exist and a refusal from the
 * node, three steps later and pointing at the wrong thing.
 */
import { z } from 'zod';
import { type Outcome } from './outcome.js';
export declare const chainConfigSchema: z.ZodObject<{
    network: z.ZodEnum<{
        devnet: "devnet";
        localnet: "localnet";
        mainnet: "mainnet";
        testnet: "testnet";
    }>;
    grpcUrl: z.ZodString;
    packageId: z.ZodString;
    latestPackageId: z.ZodString;
    platformId: z.ZodString;
    registryId: z.ZodString;
}, z.core.$strict>;
/**
 * Structurally the SDK's `ProjectXSocialConfig`. Declared here rather than imported so that the
 * validation and the type come from one place; assignability to the SDK's interface is asserted by
 * the builder that consumes it, which takes the SDK type.
 */
export type ChainConfig = z.infer<typeof chainConfigSchema>;
export declare function loadChainConfig(path: string): Promise<Outcome<ChainConfig>>;
//# sourceMappingURL=chain.d.ts.map