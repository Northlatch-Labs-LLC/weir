// Built-by: @projectx.sui · Co-authored-by: Kaela <kaela@projectxprotocol.dev>

import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { allow, refuse, type Outcome } from './outcome.js';

const suiId = z.string().regex(/^0x[0-9a-fA-F]{1,64}$/, 'not a Sui object id');

export const chainConfigSchema = z.strictObject({
  network: z.enum(['mainnet', 'testnet', 'devnet', 'localnet']),
  grpcUrl: z.string().url(),
  packageId: suiId,
  latestPackageId: suiId,
  platformId: suiId,
  registryId: suiId,
});

export type ChainConfig = z.infer<typeof chainConfigSchema>;

export async function loadChainConfig(path: string): Promise<Outcome<ChainConfig>> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return refuse('request-malformed', `the chain configuration at ${path} could not be read: ${detail}`);
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return refuse('request-malformed', `the chain configuration at ${path} is not valid JSON.`);
  }

  const parsed = chainConfigSchema.safeParse(value);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    return refuse(
      'request-malformed',
      `the chain configuration at ${path} is not a deployment: ${problems.join('; ')}.`,
    );
  }
  return allow(parsed.data);
}
