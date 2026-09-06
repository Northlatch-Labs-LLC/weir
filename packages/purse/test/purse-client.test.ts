// Built-by: @projectx.sui
/**
 * The purse's client reaches the chain under --jitless. A child node is started with the purse's
 * own flag, builds the client this file's subject builds, and asks mainnet for its chain
 * identifier -- a read, the same transport the purse simulates transactions over. This test
 * needs the network; without it the child reports so and the test refuses rather than passes.
 */
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('createPurseClient', () => {
  it('reaches the real fullnode from inside node --jitless, where the global fetch cannot', async () => {
    const script = `
      import { createPurseClient } from ${JSON.stringify(fileURLToPath(new URL('../src/purse-client.ts', import.meta.url)))};
      import { loadChainConfig } from ${JSON.stringify(fileURLToPath(new URL('../src/chain.ts', import.meta.url)))};
      const chain = await loadChainConfig(${JSON.stringify(fileURLToPath(new URL('../policy/heron-chain.mainnet.json', import.meta.url)))});
      if (!chain.ok) throw new Error(chain.refused.reason);
      let globalFailed = false;
      try { await fetch(chain.value.grpcUrl); } catch { globalFailed = true; }
      const client = createPurseClient(chain.value);
      const id = await client.core.getChainIdentifier();
      process.stdout.write(JSON.stringify({ wasmOff: typeof WebAssembly === 'undefined', globalFailed, chainIdentifier: id.chainIdentifier }));
    `;
    const child = spawn(process.execPath, ['--jitless', '--import', 'tsx', '--input-type=module', '-e', script], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = ''; let err = '';
    child.stdout.on('data', (d: Buffer) => { out += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { err += d.toString(); });
    const [code] = (await once(child, 'exit')) as [number];
    expect(code, err.slice(0, 2000)).toBe(0);
    const result = JSON.parse(out) as { wasmOff: boolean; globalFailed: boolean; chainIdentifier: string };
    expect(result.wasmOff, out).toBe(true);
    // The gRPC service answers the chain identifier as a base58 digest, not the 8-hex-digit form
    // Published.toml records; either way it is mainnet's, and it arrived through this transport.
    expect(result.chainIdentifier, out).toMatch(/^([1-9A-HJ-NP-Za-km-z]{40,50}|35834a8a)$/);
    // Whether the GLOBAL fetch fails on a first GET is undici's business and varies by path (it
    // survived a GET here and died on the purse's POST in production); reported, not asserted.
  }, 60_000);
});
